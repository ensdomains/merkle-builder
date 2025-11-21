import { findValue, insertNode, toNibblePath, type MaybeNode } from "./trie.js";
import { toBigInt, toBytes, keccak256, trimLeadingZeros } from "./utils.js";

export function insertBytes(
	node: MaybeNode,
	key: Uint8Array,
	value: Uint8Array,
	zero = true
) {
	if (key.length !== 32) throw new Error(`expected bytes32 key`);
	const slot = keccak256(key);
	const path = toNibblePath(slot);
	const oldValue = zero && findValue(node, path);
	let pos = 0;
	if (value.length < 32) {
		const word = bytes32(value);
		word[31] = value.length << 1;
		node = insertNode(node, path, trimLeadingZeros(word));
	} else {
		node = insertNode(
			node,
			path,
			toBytes((BigInt(value.length) << 1n) | 1n)
		);
		for (; pos < value.length; inc(slot)) {
			const end = pos + 32;
			node = insertNode(
				node,
				toNibblePath(keccak256(slot)),
				trimLeadingZeros(
					end > value.length
						? bytes32(value.subarray(pos))
						: value.subarray(pos, end)
				)
			);
			pos = end;
		}
	}
	if (oldValue) {
		const header = toBigInt(oldValue);
		if (header & 1n) {
			const size = Number(header >> 1n);
			for (; pos < size; inc(slot), pos += 32) {
				node = insertNode(node, toNibblePath(keccak256(slot)));
			}
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
