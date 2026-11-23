import keccak256 from "@adraffy/keccak/256";
import { concat, type Hex, toHex } from "viem";
import { SlotStorage } from "./storage.js";
import {
	deleteNode,
	EMPTY_BYTES,
	findLeaf,
	getProof,
	getRootHash,
	insertLeaf,
	isBranch,
	isExtension,
	type MaybeNode,
	newBranch,
	newLeaf,
	toNibblePath,
} from "./trie.js";
import { toBigInt, toBytes, trimLeadingZeros } from "./utils.js";

// storageProof[] entry of eth_getProof
export type EthStorageProof = {
	key: Hex;
	value: Hex; // quantity
	proof: Hex[];
};

// Ethereum storage trie (Merkle-Patricia + keccak) of a single contract, in memory
// node is immutable (copy-on-write), so snapshots are free: `const snap = storage.node`
// for large tries, see EthRowStorage
export class EthStorage extends SlotStorage {
	// inverse of toJSON()
	static fromJSON(json: unknown): EthStorage {
		return new EthStorage(nodeFromJSON(json));
	}
	constructor(public node: MaybeNode = undefined) {
		super();
	}
	// readable nested form: branch = {nibble: child}, extension = [path, child], leaf = [path, data] or data
	// depth limits nesting (deeper nodes print as "...", which fromJSON() rejects)
	toJSON(depth?: number): unknown {
		return nodeToJSON(this.node, typeof depth === "number" ? depth : Infinity); // JSON.stringify passes a key
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

const MORE = {
	[Symbol.for("nodejs.util.inspect.custom")]() {
		return "\x1b[37m...\x1b[0m";
	},
};

function nodeToJSON(node: MaybeNode, depth: number): unknown {
	if (!node) return null;
	if (depth < 0) return MORE;
	if (isBranch(node)) {
		return Object.fromEntries(
			node.children.flatMap((x, i) =>
				x ? [[toNibbleChar(i), nodeToJSON(x, depth - 1)]] : [],
			),
		);
	} else if (isExtension(node)) {
		return [nibbleStr(node.path), nodeToJSON(node.child, depth - 1)];
	} else if (node.path.length) {
		return [nibbleStr(node.path), toHex(node.data).slice(2)];
	} else {
		return toHex(node.data).slice(2);
	}
}

function nodeFromJSON(json: unknown): MaybeNode {
	if (json === MORE) throw new TypeError("cannot decode depth-limited json");
	switch (typeof json) {
		case "string":
			return newLeaf(EMPTY_BYTES, toBytes(json));
		case "object": {
			if (json === null) return;
			if (Array.isArray(json) && json.length === 2) {
				const path = Uint8Array.from(json[0], fromNibbleChar);
				const child = nodeFromJSON(json[1]);
				if (isBranch(child)) {
					return { path, child };
				} else if (isExtension(child)) {
					return { path: concat([path, child.path]), child: child.child };
				} else if (child) {
					return newLeaf(concat([path, child.path]), child.data);
				}
			} else if (json.constructor === Object) {
				const b = newBranch();
				for (const [k, x] of Object.entries(json)) {
					b.children[fromNibbleChar(k)] = nodeFromJSON(x);
				}
				return b;
			}
		}
	}
	throw Object.assign(new TypeError("invalid json"), { json });
}

function nibbleStr(path: Iterable<number>) {
	return Array.from(path, toNibbleChar).join("");
}

function toNibbleChar(nibble: number) {
	return String.fromCharCode((nibble < 10 ? 48 : 55) + nibble);
}

function fromNibbleChar(ch: string): number {
	if (ch.length === 1) {
		const cp = ch.charCodeAt(0);
		if (cp >= 48 && cp <= 57) {
			return cp - 48;
		} else if (cp >= 65 && cp <= 70) {
			return cp - 55;
		}
	}
	throw new TypeError(`invalid nibble: "${ch}"`);
}
