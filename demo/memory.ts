import { parseArgs } from "node:util";
import { Database } from "bun:sqlite";
import { deepEquals } from "bun";
import { Coder } from "../src/coder.js";
import { insertBytes } from "../src/kv.js";
import { keccak256, toHex, type Hex } from "../src/utils.js";
import {
	copyNode,
	findLeaf,
	getProof,
	getRootHash,
	toNibblePath,
	type MaybeNode,
} from "../src/trie.js";
import { determineChain, getPrimarySlot, KNOWN_ADDRS } from "./registrar.js";
import { getByteCount, getNodeCount } from "../src/inspect.js";
import { graftLimb, pluckLimbs } from "../src/surgery.js";

const args = parseArgs({
	options: {
		chain: { type: "string", short: "c" },
		depth: { type: "string", short: "d", default: "3" },
	},
	strict: true,
});

const chainInfo = determineChain(args.values.chain);
console.log(`Chain: ${chainInfo.name}`);

const depth = parseInt(args.values.depth);
console.log(`Depth: ${depth}`);

const db = new Database(`${import.meta.dir}/${chainInfo.name}.sqlite`);

let node: MaybeNode;
console.time("rebuildTrie");
for (const row of db
	.query<
		{
			addr: Uint8Array;
			name: Uint8Array;
		},
		[]
	>("SELECT * FROM names ORDER BY rowid")
	.iterate()) {
	node = insertBytes(node, getPrimarySlot(toHex(row.addr)), row.name);
}
console.timeEnd("rebuildTrie");

console.log(`NodeCount: ${getNodeCount(node)}`);
const byteCount = getByteCount(node);
console.log(`ByteCount: ${formatBytes(byteCount)}`);

// hash
console.time("getRootHash");
const storageHash = toHex(getRootHash(node));
console.timeEnd("getRootHash");
console.log(`StorageHash: ${storageHash}`);
console.log(`CacheByteCount: ${formatBytes(getByteCount(node) - byteCount)}`);

// split
const { trunk, limbs } = pluckLimbs(copyNode(node), depth);
console.log(`LimbCount: ${limbs.length}`);
console.log(`Trunk Size: ${formatBytes(Coder.getByteCount(trunk))}`);
console.log(
	`Max Limb Size: ${formatBytes(
		limbs.reduce((a, x) => Math.max(a, Coder.getByteCount(x[1])), 0),
	)}`,
);

// coder
const coder = new Coder();
console.time('write');
coder.writeNode(trunk);
coder.writeSize(depth);
coder.writeSize(limbs.length);
for (const [path, node] of limbs) {
	coder.writeBytes(path);
	coder.writeNode(node);
}
console.timeEnd('write');
console.time('read');
coder.reset();
const trunk2 = coder.readNode();
const depth2 = coder.readSize();
const limbs2 = Array.from({ length: coder.readSize() }, () => [
	coder.readBytes(depth2),
	coder.readNode(),
]);
console.timeEnd('read');
console.log("Coder:", {
	sameTrunk: deepEquals(trunk, trunk2),
	sameLimbs: deepEquals(limbs, limbs2),
});

// join
const copy = limbs.reduce((a, x) => graftLimb(a, ...x), copyNode(trunk));
console.log(
	`Reproduce StorageHash: ${toHex(getRootHash(copy)) === storageHash}`,
);

// load sql
const mem = new Database();
mem.run(`CREATE TABLE limbs (key BLOB PRIMARY KEY, value BLOB)`);
const select = mem.prepare<{ value: Uint8Array }, Uint8Array>(
	"SELECT value FROM limbs WHERE key = ?",
);
const insert = mem.prepare<void, [Uint8Array, Uint8Array]>(
	"INSERT INTO limbs (key,value) VALUES(?,?)",
);
const memory = mem.prepare<{ n: number }, []>(
	`SELECT page_count * page_size AS n FROM pragma_page_count(), pragma_page_size()`,
);
mem.transaction(() => {
	const c = new Coder();
	c.writeNode(trunk);
	insert.run(new Uint8Array(0), c.bytes);
	for (const [part, limb] of limbs) {
		c.reset();
		c.writeNode(limb);
		insert.run(part, c.bytes);
	}
})();
console.log(`Database Memory: ${formatBytes(memory.get()!.n)}`);

// query sql
for (const addr of KNOWN_ADDRS) {
	console.log();
	lookup(addr, false);
	lookup(addr, true);
}

function lookup(address: Hex, loadTrunk: boolean) {
	console.time("lookup");
	let temp = loadTrunk
		? new Coder(select.get(new Uint8Array(0))!.value).readNode()
		: copyNode(trunk);
	const slot = getPrimarySlot(address);
	const path = toNibblePath(keccak256(slot));
	const part = path.subarray(0, depth);
	const limb = select.get(part)?.value;
	if (limb) {
		temp = graftLimb(temp, part, new Coder(limb).readNode()!);
	}
	console.log({
		loadTrunk,
		address,
		hasLimb: !!limb,
		sameProof: deepEquals(getProof(temp, path), getProof(node, path)),
		sameLeaf: deepEquals(findLeaf(temp, path), findLeaf(node, path)),
		sameHash: toHex(getRootHash(temp)) === storageHash,
	});
	console.timeEnd("lookup");
}

function formatBytes(size: number) {
	if (size < 1000) return `${size}B`;
	size /= 1024;
	if (size < 1000) return `${size.toFixed(1)}KB`;
	size /= 1024;
	return `${size.toFixed(1)}MB`;
}

// 20250109: `-c base`
// depth | speed | limbs |   size |   trunk |   limb
//     2 |  4 ms |   256 | 185 mb |   10 kb | 750 kb
//     3 |  1 ms |  4096 | 180 mb |  150 kb |  52 kb ==> best
//     4 |  1 ms | 65536 | 250 mb | 2300 kb |   6 kb

// 20250125: `-c base -d 3`
// [449.16ms] write
// [838.35ms] read
