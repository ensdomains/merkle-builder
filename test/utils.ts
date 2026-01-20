import { inspect } from "bun";
import { randomBytes, randomInt } from "node:crypto";
import { insertLeaf, toNibblePath, type MaybeNode } from "../src/trie.js";
import { keccak256, toHex, trimLeadingZeros } from "../src/utils.js";

export function dump(x: unknown) {
	console.log(inspect(x, { depth: Infinity, colors: true }));
}

export { randomInt, randomBytes };

export type TrieEntry = [key: Uint8Array, value: Uint8Array, path: Uint8Array];

export function randomTrie(size = 1 + randomInt(100)) {
	const dedup = new Map<string, TrieEntry>();
	while (dedup.size < size) {
		const k = randomBytes(32);
		const v = trimLeadingZeros(randomBytes(randomInt(33)));
		const p = toNibblePath(keccak256(k));
		dedup.set(toHex(k), [k, v, p]);
	}
	const storage = [...dedup.values()];
	const node = storage.reduce<MaybeNode>(
		(a, [, v, p]) => insertLeaf(a, p, v),
		undefined,
	);
	return { storage, node };
}
