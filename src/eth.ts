import {
	deleteNode,
	EMPTY_BYTES,
	findLeaf,
	getProof,
	getRootHash,
	insertLeaf,
	toNibblePath,
	type MaybeNode,
} from "./trie.js";
import { SlotStorage } from "./storage.js";
import { type Hex, keccak256, toHex } from "viem";
import { toBigInt, trimLeadingZeros } from "./utils.js";

// storageProof[] entry of eth_getProof
export type EthStorageProof = {
	key: Hex;
	value: Hex; // quantity
	proof: Hex[];
};

export type EthStorageOptions = {
	// store zero words as empty leaves instead of deleting them (older anvil)
	zeroLeaves?: boolean;
};

// Ethereum storage trie (Merkle-Patricia + keccak) of a single contract
// node is immutable (copy-on-write), so snapshots are free: `const snap = storage.node`
export class EthStorage extends SlotStorage {
	readonly zeroLeaves: boolean;
	constructor(
		public node: MaybeNode = undefined,
		{ zeroLeaves = false }: EthStorageOptions = {}
	) {
		super();
		this.zeroLeaves = zeroLeaves;
	}
	static path(slot: Uint8Array): Uint8Array {
		return toNibblePath(keccak256(slot, "bytes"));
	}
	clone(): EthStorage {
		return new EthStorage(this.node, this);
	}
	getStorage(slot: Uint8Array): Uint8Array {
		return findLeaf(this.node, EthStorage.path(slot))?.data ?? EMPTY_BYTES;
	}
	setStorage(slot: Uint8Array, value: Uint8Array) {
		this.node = setPath(this.node, EthStorage.path(slot), value, this.zeroLeaves);
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
			value: `0x${toBigInt(findLeaf(this.node, path)?.data ?? EMPTY_BYTES).toString(16)}`,
			proof: getProof(this.node, path).map((x) => toHex(x)),
		};
	}
}

export function setPath(
	node: MaybeNode,
	path: Uint8Array,
	value: Uint8Array,
	zeroLeaves = false
): MaybeNode {
	value = trimLeadingZeros(value);
	return value.length || zeroLeaves
		? insertLeaf(node, path, value)
		: deleteNode(node, path);
}
