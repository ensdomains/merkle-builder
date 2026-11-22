import keccak256 from "@adraffy/keccak/256";
import { type Hex, toHex } from "viem";
import { SlotStorage } from "./storage.js";
import {
	deleteNode,
	EMPTY_BYTES,
	findLeaf,
	getProof,
	getRootHash,
	insertLeaf,
	type MaybeNode,
	toNibblePath,
} from "./trie.js";
import { toBigInt, trimLeadingZeros } from "./utils.js";

// storageProof[] entry of eth_getProof
export type EthStorageProof = {
	key: Hex;
	value: Hex; // quantity
	proof: Hex[];
};

// Ethereum storage trie (Merkle-Patricia + keccak) of a single contract
// node is immutable (copy-on-write), so snapshots are free: `const snap = storage.node`
export class EthStorage extends SlotStorage {
	constructor(public node: MaybeNode = undefined) {
		super();
	}
	static path(slot: Uint8Array): Uint8Array {
		return toNibblePath(keccak256(slot));
	}
	clone(): EthStorage {
		return new EthStorage(this.node);
	}
	getStorage(slot: Uint8Array): Uint8Array {
		return findLeaf(this.node, EthStorage.path(slot))?.data ?? EMPTY_BYTES;
	}
	setStorage(slot: Uint8Array, value: Uint8Array) {
		this.node = setPath(this.node, EthStorage.path(slot), value);
	}
	get rootHash(): Uint8Array {
		return getRootHash(this.node);
	}
	get storageHash(): Hex {
		return toHex(this.rootHash);
	}
	getProof(slot: Uint8Array): EthStorageProof {
		const path = EthStorage.path(slot);
		return {
			key: toHex(slot),
			value: toHex(toBigInt(findLeaf(this.node, path)?.data ?? EMPTY_BYTES)), // quantity
			proof: getProof(this.node, path).map((x) => toHex(x)),
		};
	}
}

// zero deletes the leaf
export function setPath(
	node: MaybeNode,
	path: Uint8Array,
	value: Uint8Array
): MaybeNode {
	value = trimLeadingZeros(value);
	return value.length ? insertLeaf(node, path, value) : deleteNode(node, path);
}
