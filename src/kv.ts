import {
	deleteNode,
	EMPTY_BYTES,
	findLeaf,
	insertNode,
	toNibblePath,
	type MaybeNode,
} from "./trie.js";
import { toBigInt, toBytes, keccak256, trimLeadingZeros } from "./utils.js";

export type InsertMode = "zero" | "delete" | undefined;

export function insertBytes(
	node: MaybeNode,
	slot: Uint8Array,
	value: Uint8Array,
	mode: InsertMode = "delete"
) {
	if (slot.length !== 32) throw new Error(`expected bytes32 slot`);
	const key = keccak256(slot);
	const path = toNibblePath(key);
	let oldSize = 0;
	if (mode) {
		const prior = findLeaf(node, path)?.value;
		if (prior?.length) {
			const header = toBigInt(prior);
			if (header & 1n) {
				oldSize = Number(header >> 1n);
				// if this is too large, likely theres an encoding error
				// evm will run out of gas trying to clear it
			}
		}
	}
	let pos = 0;
	if (value.length < 32) {
		if (!value.length && mode === "delete") {
			node = deleteNode(node, path);
		} else {
			const word = bytes32(value);
			word[31] = value.length << 1;
			node = insertNode(node, path, trimLeadingZeros(word));
		}
	} else {
		node = insertNode(node, path, toBytes((BigInt(value.length) << 1n) | 1n));
		for (; pos < value.length; inc(key)) {
			const end = pos + 32;
			node = insertNode(
				node,
				toNibblePath(keccak256(key)),
				trimLeadingZeros(
					end > value.length
						? bytes32(value.subarray(pos))
						: value.subarray(pos, end)
				)
			);
			pos = end;
		}
	}
	if (mode === "delete") {
		for (; pos < oldSize; inc(key), pos += 32) {
			node = deleteNode(node, toNibblePath(keccak256(key)));
		}
	} else if (mode === "zero") {
		for (; pos < oldSize; inc(key), pos += 32) {
			node = insertNode(node, toNibblePath(keccak256(key)), EMPTY_BYTES);
		}
	}
	return node;
}
 
function inc(v: Uint8Array, max = 255) {
	let i = v.length;
	while (i && v[i - 1] === max) --i;
	if (i) {
		++v[i - 1];
		v.fill(0, i);
	} else {
		v.fill(0);
	}
}

function bytes32(v: Uint8Array) {
	const word = new Uint8Array(32);
	word.set(v);
	return word;
}
