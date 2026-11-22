import { Database } from "bun:sqlite";
import { parseArgs } from "node:util";
import {
	BaseError,
	createPublicClient,
	custom,
	type GetProofReturnType,
	getAbiItem,
	http,
	type PublicClient,
	toHex,
} from "viem";
import { EthStorage } from "../src/eth.js";
import { toBytes, toWord } from "../src/utils.js";
import {
	determineChain,
	determineProvider,
	getPrimarySlot,
	getRegistrarAddress,
	KNOWN_ADDRS,
	REGISTRAR_ABI,
	setOwner,
} from "./registrar.js";

const args = parseArgs({
	options: {
		chain: { type: "string", short: "c" },
		noSync: { type: "boolean" },
	},
	strict: true,
});

const chainInfo = determineChain(args.values.chain);
const registrarAddress = getRegistrarAddress(chainInfo.testnet);
const NAME_CHANGED = getAbiItem({ abi: REGISTRAR_ABI, name: "NameForAddrChanged" });
const realRPC = determineProvider(chainInfo);

console.log(`Chain: ${chainInfo.name.toUpperCase()} (${chainInfo.id})`);
console.log(`Contract: ${chainInfo.explorer}/address/${registrarAddress}`);
console.log(`Public RPC: ${chainInfo.publicRPC}`);
console.log(`Prover RPC: ${realRPC}`);

const db = new Database(`${import.meta.dir}/${chainInfo.name}.sqlite`);
db.run(`CREATE TABLE IF NOT EXISTS state (
	key STRING PRIMARY KEY, 
	value STRING
)`);
db.run(`CREATE TABLE IF NOT EXISTS names (
	block INTEGER,
	addr BLOB,
	name BLOB
)`);

const insertName = db.prepare<unknown, [number, Uint8Array, Uint8Array]>(
	"INSERT INTO names (block,addr,name) VALUES(?,?,?)",
);
const updateState = db.prepare<unknown, [string, string]>(
	"REPLACE INTO state (key,value) VALUES(?,?)",
);

const storage = new EthStorage();
let block0 = chainInfo.createdAtBlock;

// restore
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
	console.log(`Blocks: [${chainInfo.createdAtBlock}, ${block0})`);
	printNamesCount();
	console.time("rebuildTrie");
	for (const row of db
		.query<
			{ addr: Uint8Array; name: Uint8Array },
			number
		>("SELECT * FROM names WHERE block < ? ORDER BY rowid")
		.iterate(block0)) {
		storage.setBytes(getPrimarySlot(toHex(row.addr)), row.name);
	}
	console.timeEnd("rebuildTrie");
}

process.once("SIGINT", () => {
	console.log("\nStopping...");
	db.close();
	process.exit();
});

if (!args.values.noSync) {
	await sync();
}

const realClient = createPublicClient({ transport: http(realRPC) });

const blockNumber = BigInt(block0 - 1);

if (chainInfo.ownable) {
	const owner = await realClient.readContract({
		address: registrarAddress,
		abi: REGISTRAR_ABI,
		functionName: "owner",
		blockNumber,
	});
	console.log(`Owner: ${owner}`);
	setOwner(storage, owner);
}

console.time("getRootHash");
const { storageHash } = storage;
console.timeEnd("getRootHash");
console.log(`StorageHash: ${storageHash}`);

const fakeClient = createPublicClient({
	transport: custom({
		async request({ method, params }) {
			switch (method) {
				case "eth_getProof": {
					console.time("getProof");
					const storageProof = params[1].map((hex: string) =>
						storage.getProof(toBytes(hex, 32)),
					);
					console.timeEnd("getProof");
					return {
						address: registrarAddress.toLowerCase(),
						storageHash,
						storageProof,
					};
				}
				case "eth_getStorageAt": {
					console.time("getStorage");
					const word = toWord(storage.getStorage(toBytes(params[1], 32)));
					console.timeEnd("getStorage");
					return toHex(word);
				}
				default: {
					throw new Error(`unsupported method: ${method}`);
				}
			}
		},
	}),
});

const slots = KNOWN_ADDRS.map(getPrimarySlot);

for (const slot of slots) {
	const [realStorage, fakeStorage] = await Promise.all(
		[realClient, fakeClient].map((c) =>
			c.getStorageAt({ address: registrarAddress, slot: toHex(slot), blockNumber }),
		),
	);
	console.log(
		`eth_getStorageAt(${toHex(slot)}) Match:`,
		realStorage === fakeStorage,
	);
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
console.log(
	`eth_getProof[${slots.length}] Match:`,
	extract(realProof) === extract(fakeProof),
);

db.close();
process.exit(0);

function extract({ storageHash, storageProof }: GetProofReturnType) {
	return JSON.stringify({ storageHash, storageProof }, (_, x) =>
		typeof x === "bigint" ? toHex(x) : x,
	);
}

async function sync() {
	console.time("sync");
	let calls = 0;
	const client = createPublicClient({
		transport: http(chainInfo.publicRPC ?? realRPC, {
			onFetchRequest: () => void calls++,
		}),
	});
	while (true) {
		const t0 = Date.now();
		const block = await client.getBlock({
			blockTag: chainInfo.unfinalized ? "latest" : "finalized",
		});
		const block1 = Number(block.number);
		console.log(`New Blocks: (${block0}, ${block1}]`);
		while (block0 < block1) {
			const { logs, lastBlock, status } = await getLogs(
				client,
				block0,
				Math.min(block1, block0 + (chainInfo.logStep ?? 10000) - 1),
			);
			db.transaction(() => {
				for (const log of logs) {
					const { addr, name } = log.args;
					const nameBuf = Buffer.from(name);
					const blockNumber = Number(log.blockNumber);
					storage.setBytes(getPrimarySlot(addr), nameBuf);
					console.log(`[${blockNumber}] ${addr} = ${name}`);
					insertName.run(blockNumber, toBytes(addr, 20), nameBuf);
				}
				if (logs.length > 20) {
					console.log(status); // repeat message
				}
				block0 = lastBlock + 1;
				updateState.run("block0", String(block0));
			})();
		}
		if (Date.now() - t0 < 1000) break;
	}
	console.log(`Calls: ${calls}`);
	console.timeEnd("sync");
	printNamesCount();
}

async function getLogs(client: PublicClient, block0: number, block1: number) {
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
			const status = `getLogs: [${block0}, ${block1}] (${count}) = ${logs.length}`;
			console.log(status);
			if (logs.length > 100) {
				const lastBlock = Number(logs[logs.length - 1].blockNumber);
				if (Number(logs[0].blockNumber) !== lastBlock) {
					block1 = lastBlock - 1; // rewind incase it was truncated (not sure this happens)
					const i = logs.findLastIndex((x) => Number(x.blockNumber) <= block1);
					logs.splice(i + 1, logs.length - i);
				}
			}
			return { logs, lastBlock: block1, status };
		} catch (err: unknown) {
			// this error is thrown by drpc
			const match =
				err instanceof BaseError &&
				err.details?.match(
					/query exceeds max results (\d+), retry with the range (\d+)-(\d+)/,
				);
			if (match && parseInt(match[2], 10) === block0) {
				block1 = parseInt(match[3], 10);
				continue;
			} else if (count > 1) {
				const less = Math.ceil(count / 5);
				console.log(`getLogs: ${count} => ${less} (retry)`);
				block1 = block0 + less - 1;
				continue;
			}
			throw err;
		}
	}
}

function printNamesCount() {
	console.log(
		`Names: ${db.query("SELECT count(block) FROM names").values()[0][0]}`,
	);
}
