import { parseArgs } from "node:util";
import { Database } from "bun:sqlite";
import {
	Contract,
	EventLog,
	Interface,
	isError,
	JsonRpcProvider,
} from "ethers";
import {
	findLeaf,
	getProof,
	getRootHash,
	toNibblePath,
	type MaybeNode,
} from "../src/trie.js";
import { insertBytes } from "../src/kv.js";
import { keccak256, toBytes, toHex } from "../src/utils.js";
import {
	ethGetProof,
	ethGetStorage,
	type EthGetProof,
	type RawProvider,
} from "../test/rpc.js";
import {
	determineChain,
	determineProvider,
	getPrimarySlot,
	getRegistrarAddress,
	KNOWN_ADDRS,
	setOwner,
} from "./registrar.js";

const REGISTRAR_ABI = new Interface([
	`function owner() view returns (address)`,
	`event NameForAddrChanged(address indexed addr, string name)`,
]);

const args = parseArgs({
	options: {
		chain: { type: "string", short: "c" },
	},
	strict: true,
});

const chainInfo = determineChain(args.values.chain);
const registrarAddress = getRegistrarAddress(chainInfo.testnet);
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
	"INSERT INTO names (block,addr,name) VALUES(?,?,?)"
);
const updateState = db.prepare<unknown, [string, string]>(
	"REPLACE INTO state (key,value) VALUES(?,?)"
);

let node: MaybeNode = undefined;
let block0 = chainInfo.createdAtBlock;

if (1) {
	const state = Object.fromEntries(
		db
			.query<{ key: string; value: string }, []>("SELECT * FROM state")
			.all()
			.map((x) => [x.key, x.value])
	);
	if (state.block0) {
		block0 = Math.max(block0, parseInt(state.block0));
	}
	console.log(`Blocks: [${chainInfo.createdAtBlock}, ${block0})`);
	printNamesCount();
	console.time("rebuildTrie");
	for (const row of db
		.query<
			{
				addr: Uint8Array;
				name: Uint8Array;
			},
			number
		>("SELECT * FROM names WHERE block < ? ORDER BY rowid")
		.iterate(block0)) {
		node = insertBytes(node, getPrimarySlot(toHex(row.addr)), row.name);
	}
	console.timeEnd("rebuildTrie");
}

process.once("SIGINT", () => {
	console.log("\nStopping...");
	db.close();
	process.exit();
});

await sync();

const realProvider = new JsonRpcProvider(realRPC, chainInfo.id, {
	staticNetwork: true,
	batchMaxCount: 1,
});

const registrar = new Contract(registrarAddress, REGISTRAR_ABI, realProvider);

const blockTag = `0x${(block0 - 1).toString(16)}`;

if (chainInfo.ownable) {
	const owner = await registrar.owner({ blockTag });
	console.log(`Owner: ${owner}`);
	node = setOwner(node, owner);
}

console.time("getRootHash");
const storageHash = toHex(getRootHash(node));
console.timeEnd("getRootHash");
console.log(`StorageHash: ${storageHash}`);

const fakeProvider: RawProvider = {
	async send(method, params) {
		switch (method) {
			case "eth_getProof": {
				console.time("getProof");
				const storageProof = params[1].map((hex: string) => {
					const slot = toBytes(hex, 32);
					const path = toNibblePath(keccak256(slot));
					const leaf = findLeaf(node, path);
					return {
						key: toHex(slot),
						value: leaf?.data.length ? toHex(leaf.data) : "0x0",
						proof: getProof(node, path).map((v) => toHex(v)),
					};
				});
				console.timeEnd("getProof");
				return {
					address: registrarAddress.toLowerCase() as typeof registrarAddress,
					storageHash,
					storageProof,
				} satisfies EthGetProof;
			}
			case "eth_getStorageAt": {
				const slot = toBytes(params[1], 32);
				const path = toNibblePath(keccak256(slot));
				console.time("getStorage");
				const leaf = findLeaf(node, path);
				console.timeEnd("getStorage");
				const word = new Uint8Array(32);
				if (leaf) word.set(leaf.data, 32 - leaf.data.length);
				return toHex(word);
			}
			default: {
				throw new Error(`unsupported method: ${method}`);
			}
		}
	},
};

const slots = KNOWN_ADDRS.map((x) => getPrimarySlot(x));

const realStorage = await ethGetStorage(
	realProvider,
	registrarAddress,
	slots[0],
	blockTag
);
const fakeStorage = await ethGetStorage(
	fakeProvider,
	registrarAddress,
	slots[0],
	blockTag
);
console.log(
	"eth_getStorageAt Match:",
	JSON.stringify(realStorage) === JSON.stringify(fakeStorage)
);

const realProof = await ethGetProof(
	realProvider,
	registrarAddress,
	slots,
	blockTag
);
const fakeProof = await ethGetProof(
	fakeProvider,
	registrarAddress,
	slots,
	blockTag
);
console.log("eth_getProof Match:", extract(realProof) === extract(fakeProof));

db.close();
process.exit(0);

function extract({ storageHash, storageProof }: EthGetProof) {
	return JSON.stringify({ storageHash, storageProof });
}

async function sync() {
	console.time("sync");
	const p = new JsonRpcProvider(chainInfo.publicRPC ?? realRPC, chainInfo.id, {
		staticNetwork: true,
		batchMaxCount: 1,
	});
	let calls = 0;
	p.on("debug", (x) => {
		if (x.action === "sendRpcPayload") calls++;
	});
	const registrar = new Contract(registrarAddress, REGISTRAR_ABI, p);
	while (true) {
		const t0 = Date.now();
		let block1 = await p.getBlockNumber();
		while (block0 < block1) {
			const { logs, lastBlock, status } = await getLogs(
				registrar,
				block0,
				Math.min(block1, block0 + (chainInfo.logStep ?? 10000) - 1)
			);
			db.transaction(() => {
				for (const log of logs) {
					const { addr, name } = log.args;
					const nameBuf = Buffer.from(name);
					node = insertBytes(node, getPrimarySlot(addr), nameBuf);
					console.log(`[${log.blockNumber}] ${addr} = ${name}`);
					insertName.run(log.blockNumber, toBytes(addr, 20), nameBuf);
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

async function getLogs(registrar: Contract, block0: number, block1: number) {
	const event = registrar.filters.NameForAddrChanged();
	while (true) {
		const count = 1 + block1 - block0;
		try {
			const logs = await registrar.queryFilter(event, block0, block1);
			const status = `getLogs: [${block0}, ${block1}] (${count}) = ${logs.length}`;
			console.log(status);
			if (logs.length > 100) {
				const lastBlock = logs[logs.length - 1].blockNumber;
				if (logs[0].blockNumber !== lastBlock) {
					block1 = lastBlock - 1; // rewind incase it was truncated (not sure this happens)
					const i = logs.findLastIndex((x) => x.blockNumber <= block1);
					logs.splice(i + 1, logs.length - i);
				}
			}
			return { logs: logs as EventLog[], lastBlock: block1, status };
		} catch (err: unknown) {
			if (isError(err, "UNKNOWN_ERROR")) {
				const match = err.message.match(
					// this error is thrown by drpc
					/^query exceeds max results (\d+), retry with the range (\d+)-(\d+)$/
				);
				if (match && parseInt(match[2]) === block0) {
					block1 = parseInt(match[3]);
					continue;
				}
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
		`Names: ${db.query("SELECT count(block) FROM names").values()[0][0]}`
	);
}
