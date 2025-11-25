import { inspect } from "bun";
import { randomBytes, randomInt } from "crypto";
import { insertNode, toNibblePath, type MaybeNode } from "../src/trie.js";
import { keccak256, toHex, trimLeadingZeros } from "../src/utils.js";

export function dump(node: MaybeNode) {
	console.log(inspect(node, { depth: Infinity, colors: true }));
}

export { randomInt, randomBytes };

export function randomTrie(size = randomInt(100)) {
	const dedup = new Map<string, [Uint8Array, Uint8Array]>();
	while (dedup.size < size) {
		const k = randomBytes(32);
		const v = trimLeadingZeros(randomBytes(randomInt(33)));
		dedup.set(toHex(k), [k, v]);
	}
	const storage = [...dedup.values()];
	const node = storage.reduce<MaybeNode>(
		(a, [k, v]) => insertNode(a, toNibblePath(keccak256(k)), v),
		undefined
	);
	return { storage, node };
}
