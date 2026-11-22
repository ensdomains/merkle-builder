import { EthStorage, type EthStorageOptions } from "./eth.js";
import type { SetBytesOptions } from "./storage.js";
import type { MaybeNode } from "./trie.js";

// functional wrappers around EthStorage

// set the storage word at slot
export function insertWord(
	node: MaybeNode,
	slot: Uint8Array,
	value: Uint8Array,
	options?: EthStorageOptions
): MaybeNode {
	const s = new EthStorage(node, options);
	s.setStorage(slot, value);
	return s.node;
}

// write value using the solidity "bytes" / "string" storage layout
export function insertBytes(
	node: MaybeNode,
	slot: Uint8Array,
	value: Uint8Array,
	options?: SetBytesOptions & EthStorageOptions
): MaybeNode {
	const s = new EthStorage(node, options);
	s.setBytes(slot, value, options);
	return s.node;
}
