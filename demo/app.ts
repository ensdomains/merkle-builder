import {
	Contract,
	EventLog,
	Interface,
	isError,
	JsonRpcProvider,
} from "ethers";
import { readFileSync, writeFileSync } from "node:fs";
import {
	EMPTY_BYTES,
	findLeaf,
	getProof,
	getRootHash,
	insertNode,
	toNibblePath,
	type MaybeNode,
} from "../src/trie.js";
import { insertBytes } from "../src/kv.js";
import { followSlot, keccak256, toBytes, toHex } from "../src/utils.js";
import { ethGetProof, type EthGetProof } from "../test/rpc.js";
import { parseArgs } from "node:util";
import { WebSocketProvider } from "ethers";
import { Coder } from "../src/coder.js";

const REGISTRAR = "0x0000000000D8e504002cC26E3Ec46D81971C1664";
const REGISTRAR_ABI = new Interface([
	`function owner() view returns (address)`,
	`event NameForAddrChanged(address indexed addr, string name)`,
]);
const SERVE_PORT = 8000;
const LOG_STEP = 10000;

const args = parseArgs({
	args: process.argv.slice(2),
	options: {
		chain: {
			type: "string",
			short: "c",
		},
	},
	strict: true,
});

type ChainInfo = {
	name: string;
	id: bigint;
	ownable: boolean;
	publicRPC: string;
	drpcSlug?: string;
	alchemySlug?: string;
	explorer: string;
	createdAtBlock: number;
};

function determineChain(name = "op"): ChainInfo {
	switch (name.toLowerCase()) {
		case undefined: // default
		case "op":
			return {
				name: "optimism",
				id: 10n,
				ownable: false,
				explorer: "https://optimistic.etherscan.io",
				publicRPC: "https://mainnet.optimism.io",
				drpcSlug: "optimism",
				alchemySlug: "opt-mainnet",
				createdAtBlock: 137403854,
			};
		case "base":
			return {
				name: "base",
				id: 8453n,
				ownable: true,
				explorer: "https://basescan.org",
				publicRPC: "https://mainnet.base.org",
				drpcSlug: "base",
				alchemySlug: "base-mainnet",
				createdAtBlock: 31808582,
			};
		default:
			throw new Error(`unsupported chain: ${name}`);
	}
}

function determineProvider(info: ChainInfo) {
	let key: string | undefined;
	if (info.drpcSlug && (key = process.env.DRPC_KEY)) {
		return `wss://lb.drpc.live/${info.drpcSlug}/${key}`;
	} else if (info.alchemySlug && (key = process.env.ALCHEMY_KEY)) {
		return `wss://${info.alchemySlug}.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`;
	} else {
		throw new Error(`missing .env`);
	}
}

const chainInfo = determineChain(args.values.chain);
const realProviderURL = determineProvider(chainInfo);

const cacheFile = new URL(`./${chainInfo.name}.json`, import.meta.url);

console.log(`Chain: ${chainInfo.name.toUpperCase()} (${chainInfo.id})`);
console.log(`Contract: ${chainInfo.explorer}/address/${REGISTRAR}`);
console.log(`Public RPC: ${chainInfo.publicRPC}`);
console.log(`Prover RPC: ${realProviderURL}`);

let node: MaybeNode = undefined;
let block0 = chainInfo.createdAtBlock;
const names: [number, string, string][] = [];
try {
	const json = JSON.parse(readFileSync(cacheFile, "utf8")) as {
		block0: number;
		names: typeof names;
	};
	console.log(`Names: ${json.names.length}`);
	console.time("buildTrie");
	block0 = json.block0;
	for (const [block, addr, name] of json.names) {
		register(block, addr, name, false);
	}
	console.timeEnd("buildTrie");
} catch {}

function getPrimarySlot(addr: string) {
	return followSlot(0n, toBytes(addr, 32));
}

function register(block: number, addr: string, name: string, log = true) {
	node = insertBytes(node, getPrimarySlot(addr), Buffer.from(name));
	names.push([block, addr, name]);
	if (log) console.log(`[${block}] ${addr} = ${name}`);
}

process.once("SIGINT", () => {
	console.log("\nStopping...");
	save();
	process.exit();
});

await sync();

const realProvider = new WebSocketProvider(realProviderURL, chainInfo.id, {
	staticNetwork: true,
	batchMaxCount: 1,
});

const registrar = new Contract(REGISTRAR, REGISTRAR_ABI, realProvider);
registrar.on("NameForAddrChanged", register);

if (chainInfo.ownable) {
	node = insertNode(
		node,
		toNibblePath(keccak256(toBytes(1, 32))),
		toBytes(await registrar.owner())
	);
}

Bun.serve({
	port: SERVE_PORT,
	async fetch(req) {
		let id = 1;
		let slots: Uint8Array[];
		try {
			const json: any = await req.json();
			if (typeof json !== "object") {
				throw new Error("expected object");
			}
			id = json.id;
			if (!Number.isSafeInteger(id)) {
				throw new Error("expected id");
			}
			if (json.method !== "eth_getProof") {
				throw new Error("expected eth_getProof");
			}
			if (!Array.isArray(json.params) || json.params.length !== 3) {
				throw new Error("expected params");
			}
			const [address, hexSlots, blockTag] = json.params;
			if (
				REGISTRAR.localeCompare(address, undefined, { sensitivity: "base" })
			) {
				throw new Error(`expected ${REGISTRAR}`);
			}
			if (!Array.isArray(hexSlots)) {
				throw new Error(`expected slots`);
			}
			slots = hexSlots.map((x) => toBytes(x, 32));
			if (blockTag !== "latest") {
				throw new Error("expected latest blockTag");
			}
		} catch (err: any) {
			return Response.json({
				id,
				error: err?.message ?? String(err),
			});
		}
		console.time("getRootHash");
		const storageHash = toHex(getRootHash(node));
		console.timeEnd("getRootHash");
		console.time("getProof");
		const storageProof = slots.map((slot) => {
			const path = toNibblePath(keccak256(slot));
			return {
				key: toHex(slot),
				value: toHex(findLeaf(node, path)?.value ?? EMPTY_BYTES),
				proof: getProof(node, path).map((v) => toHex(v)),
			};
		});
		console.timeEnd("getProof");
		const result = {
			address: REGISTRAR.toLowerCase(),
			storageHash,
			storageProof,
		} satisfies EthGetProof;
		return Response.json({ id, result });
	},
});

const fakeProvider = new JsonRpcProvider(`http://localhost:${SERVE_PORT}`, 1, {
	staticNetwork: true,
	batchMaxCount: 1,
});

const slots = [getPrimarySlot("0x69420f05A11f617B4B74fFe2E04B2D300dFA556F")];

const realProof = await ethGetProof(realProvider, REGISTRAR, slots);
const fakeProof = await ethGetProof(fakeProvider, REGISTRAR, slots);

console.log("eth_getProof Match:", extract(realProof) === extract(fakeProof));
console.log(`Ready on ${SERVE_PORT}`);

function extract({ storageHash, storageProof }: EthGetProof) {
	return JSON.stringify({ storageHash, storageProof });
}

async function sync() {
	console.time("sync");
	const p = new JsonRpcProvider(chainInfo.publicRPC, chainInfo.id, {
		staticNetwork: true,
		batchMaxCount: 3,
	});
	let calls = 0;
	p.on("debug", (x) => {
		if (x.action === "sendRpcPayload") calls++;
	});
	const registrar = new Contract(REGISTRAR, REGISTRAR_ABI, p);
	let lastSavedBlock = block0;
	while (true) {
		const t0 = Date.now();
		let block1 = await p.getBlockNumber();
		while (block0 < block1) {
			const { logs, lastBlock } = await getLogs(
				registrar,
				block0,
				Math.min(block1, block0 + LOG_STEP - 1)
			);
			for (const log of logs) {
				register(log.blockNumber, log.args.addr, log.args.name);
			}
			block0 = lastBlock + 1;
			if (logs.length) {
				save();
				lastSavedBlock = block0;
			}
		}
		if (Date.now() - t0 < 1000) break;
	}
	if (lastSavedBlock != block0) {
		save();
	}
	console.log(`Calls: ${calls}`);
	console.timeEnd("sync");
}

async function getLogs(
	registrar: Contract,
	block0: number,
	block1: number
): Promise<{ logs: EventLog[]; lastBlock: number }> {
	const event = registrar.filters.NameForAddrChanged();
	while (true) {
		const count = 1 + block1 - block0;
		try {
			const logs = await registrar.queryFilter(event, block0, block1);
			console.log(`getLogs: ${block0}-${block1} (${count}) = ${logs.length}`);
			if (logs.length > 100) {
				const lastBlock = logs[logs.length - 1].blockNumber;
				if (logs[0].blockNumber !== lastBlock) {
					block1 = lastBlock - 1; // rewind incase it was truncated (not sure this happens)
					const i = logs.findLastIndex((x) => x.blockNumber <= block1);
					logs.splice(i + 1, logs.length - i);
				}
			}
			return { logs: logs as EventLog[], lastBlock: block1 };
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
				const half = count >> 1;
				console.log(`getLogs: ${count} => ${half} (retry)`);
				block1 = block0 + half - 1;
				continue;
			}
			throw err;
		}
	}
}

function save() {
	writeFileSync(cacheFile, JSON.stringify({ block0, names }, undefined, "\t"));
	console.log(`Saved: ${names.length}`);
}
