import { Database } from "bun:sqlite";
import { parseArgs, styleText } from "node:util";
import {
	BaseError,
	createPublicClient,
	custom,
	type GetProofReturnType,
	getAbiItem,
	hexToBytes,
	http,
	type PublicClient,
	toHex,
} from "viem";
import { EthRowStorage } from "../src/rows.js";
import { toBytes, toWord } from "../src/utils.js";
import { determineChain, determineRPC } from "./chains.js";
import {
	getDatabasePath,
	getPrimarySlot,
	getRegistrar,
	KNOWN_ADDRS,
	REGISTRAR_ABI,
	setOwner,
} from "./ens-registrar.js";

const args = parseArgs({
	options: {
		chain: { type: "string", short: "c" },
		noSync: { type: "boolean" },
		rebuild: { type: "boolean" }, // rebuild the trie rows from the names table
	},
	strict: true,
});

const dim = (s: string) => styleText("dim", s);
const bold = (s: string) => styleText("bold", s);
const cyan = (s: string) => styleText("cyan", s);
const green = (s: string) => styleText("green", s);
const yellow = (s: string) => styleText("yellow", s);
const red = (s: string) => styleText("red", s);
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const SEP = dim(" · ");

// the sync progress line is redrawn in place (the demo is run from a terminal)
let progressShown = false;
function log(line: string) {
	if (progressShown) {
		process.stdout.write("\r\x1b[2K");
		progressShown = false;
	}
	console.log(line);
}
function progress(line: string) {
	process.stdout.write(`\r\x1b[2K${line}`);
	progressShown = true;
}

function info(label: string, value: string) {
	console.log(`${dim(`${label}:`)} ${value}`);
}

function matched(label: string, ok: boolean) {
	console.log(`${ok ? green("✓ match") : red("✗ MISMATCH")} ${label}`);
}

// wait time for a rate limited response (retry-after / x-ratelimit-reset)
function rateLimitDelay(headers: Headers | undefined): number {
	const seconds =
		Number(headers?.get("retry-after")) || Number(headers?.get("x-ratelimit-reset"));
	return (seconds || 1) * 1000;
}

function fmtDuration(seconds: number) {
	if (!Number.isFinite(seconds)) return "?";
	const s = Math.round(seconds);
	if (s < 60) return `${s}s`;
	if (s < 3600) return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
	return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

const chainInfo = determineChain(args.values.chain);
const registrar = getRegistrar(chainInfo);
const registrarAddress = registrar.address;
const NAME_CHANGED = getAbiItem({ abi: REGISTRAR_ABI, name: "NameForAddrChanged" });
const realRPC = determineRPC(chainInfo);

info("Chain", bold(`${chainInfo.name.toUpperCase()} (${chainInfo.id})`));
info("Contract", cyan(`${chainInfo.explorer}/address/${registrarAddress}`));
info("Public RPC", chainInfo.publicRPC ?? dim("(none)"));
info("Prover RPC", realRPC);

const db = new Database(getDatabasePath(chainInfo));
db.run(`CREATE TABLE IF NOT EXISTS state (
	key STRING PRIMARY KEY,
	value STRING
)`);
db.run(`CREATE TABLE IF NOT EXISTS names (
	block INTEGER,
	addr BLOB,
	name BLOB
)`);

// storage trie as rows (see EthRowStorage): only the touched paths are read on each update
db.run(`CREATE TABLE IF NOT EXISTS rows (
	path TEXT PRIMARY KEY,
	node BLOB NOT NULL
) WITHOUT ROWID`);

const insertName = db.prepare<unknown, [number, Uint8Array, Uint8Array]>(
	"INSERT INTO names (block,addr,name) VALUES(?,?,?)",
);
const updateState = db.prepare<unknown, [string, string]>(
	"REPLACE INTO state (key,value) VALUES(?,?)",
);

const selectRow = db.prepare<{ node: Uint8Array }, [string]>("SELECT node FROM rows WHERE path = ?");
const upsertRow = db.prepare<unknown, [string, Uint8Array]>("REPLACE INTO rows (path,node) VALUES(?,?)");
const deleteRow = db.prepare<unknown, [string]>("DELETE FROM rows WHERE path = ?");

const storage = new EthRowStorage((path) => selectRow.get(path)?.node);
let block0 = registrar.createdAtBlock;

// apply pending writes to the rows table (call inside a transaction)
function commitRows() {
	const { rows } = storage.commit();
	for (const { path, node } of rows) {
		if (node) upsertRow.run(path, hexToBytes(node));
		else deleteRow.run(path);
	}
}

// restore: the rows hold every name below block0 (state.rowsBlock = block0)
{
	const state = Object.fromEntries(
		db
			.query<{ key: string; value: string }, []>("SELECT * FROM state")
			.all()
			.map((x) => [x.key, x.value]),
	);
	if (state.block0) {
		block0 = Math.max(block0, parseInt(state.block0, 10));
	}
	info("Blocks", `[${fmt(registrar.createdAtBlock)}, ${fmt(block0)})`);
	info("Names", fmt(namesCount()));
	// state values come back numeric (STRING column affinity)
	if (args.values.rebuild || Number(state.rowsBlock) !== block0) {
		rebuildRows();
	}
	info("Rows", fmt(rowsCount()));
}

process.once("SIGINT", () => {
	log(yellow("\nStopping..."));
	db.close();
	process.exit();
});

if (!args.values.noSync) {
	console.log();
	await sync();
}

const realClient = createPublicClient({ transport: http(realRPC) });

const blockNumber = BigInt(block0 - 1);

if (registrar.ownable) {
	const owner = await realClient.readContract({
		address: registrarAddress,
		abi: REGISTRAR_ABI,
		functionName: "owner",
		blockNumber,
	});
	info("Owner", owner);
	setOwner(storage, owner);
	atomically(commitRows);
}

{
	const t = performance.now();
	const { storageHash } = storage;
	info("StorageHash", `${bold(storageHash)} ${dim(`(${fmt(performance.now() - t)}ms)`)}`);
}

const fakeClient = createPublicClient({
	transport: custom({
		async request({ method, params }) {
			switch (method) {
				case "eth_getProof": {
					return {
						address: registrarAddress.toLowerCase(),
						storageHash: storage.storageHash,
						storageProof: params[1].map((hex: string) =>
							storage.getProof(toBytes(hex, 32)),
						),
					};
				}
				case "eth_getStorageAt": {
					return toHex(toWord(storage.getStorage(toBytes(params[1], 32))));
				}
				default: {
					throw new Error(`unsupported method: ${method}`);
				}
			}
		},
	}),
});

console.log(dim(`\nComparing with ${realRPC} at block ${fmt(Number(blockNumber))}`));

const slots = KNOWN_ADDRS.map(getPrimarySlot);

for (const slot of slots) {
	const [realStorage, fakeStorage] = await Promise.all(
		[realClient, fakeClient].map((c) =>
			c.getStorageAt({ address: registrarAddress, slot: toHex(slot), blockNumber }),
		),
	);
	matched(`eth_getStorageAt(${dim(toHex(slot))})`, realStorage === fakeStorage);
}

const [realProof, fakeProof] = await Promise.all(
	[realClient, fakeClient].map((c) =>
		c.getProof({
			address: registrarAddress,
			storageKeys: slots.map((x) => toHex(x)),
			blockNumber,
		}),
	),
);
matched(`eth_getProof(${slots.length} slots)`, extract(realProof) === extract(fakeProof));

db.close();
process.exit(0);

// fixed key order: nodes differ in the order of storageProof fields
function extract({ storageHash, storageProof }: GetProofReturnType) {
	return JSON.stringify({
		storageHash,
		storageProof: storageProof.map(({ key, value, proof }) => ({ key, value: toHex(value), proof })),
	});
}

async function sync() {
	const t0 = performance.now();
	let calls = 0;
	const client = createPublicClient({
		transport: http(chainInfo.publicRPC ?? realRPC, {
			onFetchRequest: () => void calls++,
		}),
	});
	const start = block0;
	let added = 0;
	let total = namesCount();
	while (true) {
		const loop0 = Date.now();
		const block = await client.getBlock({
			blockTag: chainInfo.unfinalized ? "latest" : "finalized",
		});
		const head = Number(block.number);
		if (block0 >= head) {
			log(dim(`Up to date at block ${fmt(head)}`));
		} else {
			log(
				`${bold("Syncing")} ${fmt(block0)} → ${fmt(head)} ${dim(`(${fmt(head - block0 + 1)} blocks)`)}`,
			);
		}
		while (block0 < head) {
			const { logs, lastBlock } = await getLogs(
				client,
				block0,
				Math.min(head, block0 + (chainInfo.logStep ?? 10000) - 1),
			);
			atomically(() => {
				logs.forEach((entry, i) => {
					const { addr, name } = entry.args;
					const nameBuf = Buffer.from(name);
					const blockNumber = Number(entry.blockNumber);
					storage.setBytes(getPrimarySlot(addr), nameBuf);
					insertName.run(blockNumber, toBytes(addr, 20), nameBuf);
					if (i < 5) {
						log(`  ${dim(`[${blockNumber}]`)} ${cyan(addr)} ${dim("=")} ${green(name)}`);
					} else if (i === 5) {
						log(dim(`  … and ${fmt(logs.length - 5)} more`));
					}
				});
				commitRows();
				block0 = lastBlock + 1;
				updateState.run("block0", String(block0));
				updateState.run("rowsBlock", String(block0));
			});
			added += logs.length;
			total += logs.length;
			// progress over this sync session
			const done = block0 - start;
			const todo = head + 1 - start;
			const rate = done / ((performance.now() - t0) / 1000);
			progress(
				[
					cyan(`[${((100 * Math.min(done, todo)) / todo).toFixed(1).padStart(5)}%]`) +
						` ${fmt(lastBlock)} / ${fmt(head)}`,
					`${fmt(rate)} blk/s`,
					`ETA ${fmtDuration(Math.max(0, head + 1 - block0) / rate)}`,
					`${logs.length ? green(`+${fmt(logs.length)}`) : dim("+0")} names ${dim(`(${fmt(total)})`)}`,
				].join(SEP),
			);
		}
		if (Date.now() - loop0 < 1000) break;
	}
	// remember when the last synced block was produced (used by scripts/readme.ts)
	const last = BigInt(block0 - 1);
	const { timestamp } = await client.getBlock({ blockNumber: last });
	updateState.run("timestampBlock", String(last));
	updateState.run("timestamp", String(timestamp));
	log(
		`${green("Synced")} ${fmt(added)} new names` +
			dim(` in ${fmtDuration((performance.now() - t0) / 1000)} (${fmt(calls)} rpc calls)`),
	);
	info("Names", fmt(total));
}

async function getLogs(client: PublicClient, block0: number, block1: number) {
	let rateLimited = 0;
	while (true) {
		const count = 1 + block1 - block0;
		try {
			const logs = await client.getLogs({
				address: registrarAddress,
				event: NAME_CHANGED,
				fromBlock: BigInt(block0),
				toBlock: BigInt(block1),
				strict: true,
			});
			if (logs.length > 100) {
				const lastBlock = Number(logs[logs.length - 1].blockNumber);
				if (Number(logs[0].blockNumber) !== lastBlock) {
					block1 = lastBlock - 1; // rewind incase it was truncated (not sure this happens)
					const i = logs.findLastIndex((x) => Number(x.blockNumber) <= block1);
					logs.splice(i + 1, logs.length - i);
				}
			}
			return { logs, lastBlock: block1 };
		} catch (err: unknown) {
			// rate limited: wait and retry the same range (not a range problem)
			const limited =
				err instanceof BaseError &&
				(err.walk((e) => (e as { status?: number }).status === 429) as
					| { headers?: Headers }
					| null);
			if (limited) {
				if (++rateLimited > 10) {
					throw new Error(`rpc keeps rate limiting eth_getLogs: use a keyed provider`, {
						cause: err,
					});
				}
				const delay = rateLimitDelay(limited.headers);
				log(yellow(`  getLogs: rate limited, waiting ${fmtDuration(delay / 1000)}`));
				await Bun.sleep(delay);
				continue;
			}
			// this error is thrown by drpc
			const match =
				err instanceof BaseError &&
				err.details?.match(
					/query exceeds max results (\d+), retry with the range (\d+)-(\d+)/,
				);
			if (match && parseInt(match[2], 10) === block0) {
				block1 = parseInt(match[3], 10);
				log(yellow(`  getLogs: too many results, retry ${fmt(block0)}-${fmt(block1)}`));
				continue;
			} else if (count > 1) {
				const less = Math.ceil(count / 5);
				log(yellow(`  getLogs: ${fmt(count)} → ${fmt(less)} blocks (retry)`));
				block1 = block0 + less - 1;
				continue;
			}
			throw err;
		}
	}
}

function namesCount(): number {
	return db.query<{ n: number }, []>("SELECT count(*) AS n FROM names").get()?.n ?? 0;
}

function rowsCount(): number {
	return db.query<{ n: number }, []>("SELECT count(*) AS n FROM rows").get()?.n ?? 0;
}

// run fn in a transaction: uncommitted trie writes are discarded if it throws
function atomically(fn: () => void) {
	try {
		db.transaction(fn)();
	} catch (err) {
		storage.rollback();
		throw err;
	}
}

// replay the names table into the rows table (first run, or --rebuild)
function rebuildRows() {
	const t = performance.now();
	const total =
		db
			.query<{ n: number }, [number]>("SELECT count(*) AS n FROM names WHERE block < ?")
			.get(block0)?.n ?? 0;
	const page = db.query<{ id: number; addr: Uint8Array; name: Uint8Array }, [number, number]>(
		"SELECT rowid AS id, addr, name FROM names WHERE block < ? AND rowid > ? ORDER BY rowid LIMIT 10000",
	);
	atomically(() => {
		db.run("DELETE FROM rows");
		db.run("DELETE FROM state WHERE key = 'rowsBlock'");
	});
	let done = 0;
	for (let last = 0; ; ) {
		const names = page.all(block0, last);
		if (!names.length) break;
		atomically(() => {
			for (const row of names) {
				storage.setBytes(getPrimarySlot(toHex(row.addr)), row.name);
			}
			commitRows();
		});
		last = names[names.length - 1].id;
		done += names.length;
		progress(`${bold("Rebuilding rows")} ${fmt(done)} / ${fmt(total)} names`);
	}
	updateState.run("rowsBlock", String(block0)); // the rows are complete
	log(`${green("Rebuilt")} ${fmt(done)} names into rows ${dim(`in ${fmtDuration((performance.now() - t) / 1000)}`)}`);
}
