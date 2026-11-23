import keccak256 from "@adraffy/keccak/256";
import { concat, type Hex, toHex } from "viem";
import { EthStorage, type EthStorageProof } from "./eth.js";
import { decodePath, decodeRlpBytes, decodeRlpList, encodePath, encodeRlpBytes, encodeRlpList } from "./rlp.js";
import { SlotStorage } from "./storage.js";
import { EMPTY_BYTES, encodeNode, isBranch, isExtension, type MaybeNode } from "./trie.js";
import { equalBytes, toBigInt, trimLeadingZeros } from "./utils.js";

// Ethereum storage trie as rows: every node of the trie at its absolute nibble path
//
// * path = the node's nibble path from the root, as lowercase hex ("" is the root)
// * node = encodeNode(node), or null when the node at that path was removed
// * every node has a row, including nodes < 32 bytes that are inlined in their parent
// * a slot's proof is the rows along its key path (the nodes of getProof())
// * the empty trie has no rows (storage hash = keccak256(0x80))
export type TrieRow = { path: string; node: Hex | null };

// encoded node at path in the current (committed) trie
export type RowReader = (path: string) => Uint8Array | undefined;

const HEX = "0123456789abcdef";
const RLP_NULL = Uint8Array.of(0x80);
const HASH_NULL = keccak256(RLP_NULL);

function toPathString(nibbles: Uint8Array, end = nibbles.length): string {
	let s = "";
	for (let i = 0; i < end; i++) s += HEX[nibbles[i]];
	return s;
}

// every row of an in-memory trie, in path order (pre-order dfs)
export function* trieRows(node: MaybeNode, path = ""): Generator<TrieRow & { node: Hex }> {
	if (!node) return;
	yield { path, node: toHex(encodeNode(node)) };
	if (isBranch(node)) {
		for (let i = 0; i < 16; i++) yield* trieRows(node.children[i], path + HEX[i]);
	} else if (isExtension(node)) {
		yield* trieRows(node.child, path + toPathString(node.path));
	}
}

// working trie of a batch: nodes are loaded from rows on demand and mutated in place
// enc/ref are caches: absent = changed since loaded (or new)
const STUB = 0;
const LEAF = 1;
const EXT = 2;
const BRANCH = 3;
type Cached = { enc?: Uint8Array; ref?: Uint8Array };
type Stub = { type: typeof STUB; ref: Uint8Array; enc?: undefined }; // not loaded
type Leaf = Cached & { type: typeof LEAF; path: Uint8Array; data: Uint8Array };
type Ext = Cached & { type: typeof EXT; path: Uint8Array; child: Branch | Stub };
type Branch = Cached & { type: typeof BRANCH; children: (Child | undefined)[] };
type Loaded = Leaf | Ext | Branch;
type Child = Stub | Loaded;

// ref = the node's reference in its parent's encoding: inline encoding or rlp(keccak(encoding))
function decodeNode(enc: Uint8Array): Loaded {
	const items = decodeRlpList(enc);
	if (items.length === 17) {
		const children: Branch["children"] = Array(16);
		for (let i = 0; i < 16; i++) {
			const ref = items[i];
			children[i] = ref.length === 1 && ref[0] === 0x80 ? undefined : { type: STUB, ref };
		}
		return { type: BRANCH, children, enc };
	} else if (items.length === 2) {
		const { path, leaf } = decodePath(decodeRlpBytes(items[0]));
		return leaf
			? { type: LEAF, path, data: decodeRlpBytes(decodeRlpBytes(items[1])), enc }
			: { type: EXT, path, child: { type: STUB, ref: items[1] }, enc };
	}
	throw new Error("invalid node");
}

function encode(node: Loaded): Uint8Array {
	if (node.enc) return node.enc;
	let enc: Uint8Array;
	switch (node.type) {
		case LEAF:
			enc = encodeRlpList([encodeRlpBytes(encodePath(node.path, true)), encodeRlpBytes(encodeRlpBytes(node.data))]);
			break;
		case EXT:
			enc = encodeRlpList([encodeRlpBytes(encodePath(node.path, false)), refOf(node.child)]);
			break;
		default:
			enc = encodeRlpList([...node.children.map((x) => (x ? refOf(x) : RLP_NULL)), RLP_NULL]);
	}
	node.enc = enc;
	return enc;
}

function refOf(node: Child): Uint8Array {
	if (node.ref) return node.ref;
	const enc = encode(node as Loaded);
	node.ref = enc.length < 32 ? enc : encodeRlpBytes(keccak256(enc));
	return node.ref;
}

function changed(node: Cached) {
	node.enc = node.ref = undefined;
}

function newLeaf(path: Uint8Array, data: Uint8Array): Leaf {
	return { type: LEAF, path, data };
}

function newExt(path: Uint8Array, child: Branch | Stub): Ext {
	return { type: EXT, path, child };
}

function newBranch(): Branch {
	return { type: BRANCH, children: Array(16).fill(undefined) };
}

// common prefix length of path and key[depth:]
function common(path: Uint8Array, key: Uint8Array, depth: number): number {
	let i = 0;
	while (i < path.length && path[i] === key[depth + i]) ++i;
	return i;
}

// Ethereum storage trie (Merkle-Patricia + keccak) backed by rows (see TrieRow)
// * only the nodes along touched paths are read (and cached until commit)
// * writes are applied to the cached nodes (reads see them) until commit()
// * commit() returns the rows that changed: persist them before the next read
export class RowStorage extends SlotStorage {
	#root: Loaded | undefined;
	#rootLoaded = false;
	#original = new Map<string, Uint8Array>(); // original rows of the loaded nodes
	constructor(readonly read: RowReader) {
		super();
	}
	// number of rows read since the last commit (or rollback)
	get cacheSize(): number {
		return this.#original.size;
	}
	// discard uncommitted writes and the node cache
	rollback() {
		this.#root = undefined;
		this.#rootLoaded = false;
		this.#original.clear();
	}
	// apply the writes: returns the changed rows and drops the node cache
	commit(): { rows: TrieRow[]; storageHash: Hex } {
		const rows: TrieRow[] = [];
		const original = this.#original;
		const walk = (node: Child, path: string) => {
			if (node.type === STUB) return; // not loaded: unchanged
			const enc = encode(node);
			const old = original.get(path);
			if (old) original.delete(path);
			if (enc !== old && !(old && equalBytes(enc, old))) {
				rows.push({ path, node: toHex(enc) });
			}
			if (node.type === BRANCH) {
				for (let i = 0; i < 16; i++) {
					const child = node.children[i];
					if (child) walk(child, path + HEX[i]);
				}
			} else if (node.type === EXT) {
				walk(node.child, path + toPathString(node.path));
			}
		};
		const root = this.#getRoot();
		if (root) walk(root, "");
		for (const path of original.keys()) rows.push({ path, node: null }); // loaded but gone
		const storageHash = toHex(this.rootHash);
		this.rollback();
		return { rows, storageHash };
	}
	get rootHash(): Uint8Array {
		const root = this.#getRoot();
		return root ? keccak256(encode(root)) : HASH_NULL;
	}
	get storageHash(): Hex {
		return toHex(this.rootHash);
	}
	getStorage(slot: Uint8Array): Uint8Array {
		return this.getPath(EthStorage.path(slot));
	}
	setStorage(slot: Uint8Array, value: Uint8Array) {
		this.setPath(EthStorage.path(slot), value);
	}
	// path-level access (key = 64 nibbles)
	getPath(key: Uint8Array): Uint8Array {
		let node = this.#getRoot();
		let depth = 0;
		while (node) {
			if (node.type === BRANCH) {
				node = this.#branchChild(node, key, depth, key[depth++]);
			} else if (node.type === EXT) {
				if (common(node.path, key, depth) < node.path.length) break;
				depth += node.path.length;
				node = this.#extChild(node, key, depth);
			} else {
				return common(node.path, key, depth) === node.path.length ? node.data : EMPTY_BYTES;
			}
		}
		return EMPTY_BYTES;
	}
	// zero deletes the leaf
	setPath(key: Uint8Array, value: Uint8Array) {
		const data = trimLeadingZeros(value);
		const root = this.#getRoot();
		this.#root = data.length ? this.#insert(root, key, 0, data) : this.#delete(root, key, 0);
	}
	getProof(slot: Uint8Array): EthStorageProof {
		const key = EthStorage.path(slot);
		const proof: Hex[] = [];
		let node = this.#getRoot();
		let depth = 0;
		let data: Uint8Array = EMPTY_BYTES;
		if (!node) proof.push(toHex(RLP_NULL));
		while (node) {
			proof.push(toHex(encode(node)));
			if (node.type === BRANCH) {
				node = this.#branchChild(node, key, depth, key[depth++]);
			} else if (node.type === EXT) {
				if (common(node.path, key, depth) < node.path.length) break;
				depth += node.path.length;
				node = this.#extChild(node, key, depth);
			} else {
				if (common(node.path, key, depth) === node.path.length) data = node.data;
				break;
			}
		}
		return { key: toHex(slot), value: toHex(toBigInt(data)), proof };
	}
	#load(path: string, ref: Uint8Array): Loaded {
		const enc = this.read(path);
		if (!enc) throw new Error(`missing row: "${path}"`);
		this.#original.set(path, enc);
		const node = decodeNode(enc);
		node.ref = ref;
		return node;
	}
	#getRoot(): Loaded | undefined {
		if (!this.#rootLoaded) {
			const enc = this.read("");
			if (enc) {
				this.#original.set("", enc);
				this.#root = decodeNode(enc);
			}
			this.#rootLoaded = true;
		}
		return this.#root;
	}
	// child i of the branch at key[:depth] (loaded and cached)
	#branchChild(node: Branch, key: Uint8Array, depth: number, i: number): Loaded | undefined {
		const child = node.children[i];
		if (child?.type !== STUB) return child;
		const loaded = this.#load(toPathString(key, depth) + HEX[i], child.ref);
		node.children[i] = loaded;
		return loaded;
	}
	// child of the extension ending at key[:depth]
	#extChild(node: Ext, key: Uint8Array, depth: number): Branch {
		const child = node.child;
		if (child.type !== STUB) return child;
		const loaded = this.#load(toPathString(key, depth), child.ref);
		if (loaded.type !== BRANCH) throw new Error(`expected branch: "${toPathString(key, depth)}"`);
		node.child = loaded;
		return loaded;
	}
	// node is at key[:depth], returns the replacement (the same node if mutated in place)
	#insert(node: Child | undefined, key: Uint8Array, depth: number, data: Uint8Array): Loaded {
		if (!node) return newLeaf(key.subarray(depth), data);
		if (node.type === STUB) node = this.#load(toPathString(key, depth), node.ref);
		switch (node.type) {
			case BRANCH: {
				const i = key[depth];
				const child = this.#insert(node.children[i], key, depth + 1, data);
				node.children[i] = child;
				if (!child.enc) changed(node);
				return node;
			}
			case EXT: {
				const other = node.path;
				const n = common(other, key, depth);
				if (n === other.length) {
					const child = this.#insert(node.child, key, depth + n, data) as Branch;
					node.child = child;
					if (!child.enc) changed(node);
					return node;
				}
				// split: the child keeps its absolute path
				const b = newBranch();
				const rest = other.subarray(n + 1);
				b.children[other[n]] = rest.length ? newExt(rest, node.child) : node.child;
				b.children[key[depth + n]] = newLeaf(key.subarray(depth + n + 1), data);
				return n ? newExt(other.subarray(0, n), b) : b;
			}
			default: {
				const other = node.path;
				const n = common(other, key, depth);
				if (n === other.length) {
					if (!equalBytes(node.data, data)) {
						node.data = data;
						changed(node);
					}
					return node;
				}
				const b = newBranch();
				b.children[other[n]] = newLeaf(other.subarray(n + 1), node.data);
				b.children[key[depth + n]] = newLeaf(key.subarray(depth + n + 1), data);
				return n ? newExt(other.subarray(0, n), b) : b;
			}
		}
	}
	// node is at key[:depth], returns the replacement (the same node if mutated in place)
	#delete(node: Child | undefined, key: Uint8Array, depth: number): Loaded | undefined {
		if (!node) return;
		if (node.type === STUB) node = this.#load(toPathString(key, depth), node.ref);
		switch (node.type) {
			case BRANCH: {
				const i = key[depth];
				const prev = node.children[i];
				if (!prev) return node;
				const child = this.#delete(prev, key, depth + 1);
				node.children[i] = child;
				if (child) {
					if (!child.enc) changed(node);
					return node;
				}
				changed(node);
				let index = -1;
				for (let j = 0; j < 16; j++) {
					if (node.children[j]) {
						if (index >= 0) return node; // still a branch
						index = j;
					}
				}
				if (index < 0) return; // invalid trie
				// collapse into the remaining child (which leaves its own path)
				const only = this.#branchChild(node, key, depth, index) as Loaded;
				if (only.type === BRANCH) return newExt(Uint8Array.of(index), only);
				const path = concat([Uint8Array.of(index), only.path]);
				return only.type === EXT ? newExt(path, only.child) : newLeaf(path, only.data);
			}
			case EXT: {
				const n = node.path.length;
				if (common(node.path, key, depth) < n) return node; // diverges
				const child = this.#delete(node.child, key, depth + n);
				if (child?.type === BRANCH) {
					node.child = child;
					if (!child.enc) changed(node);
					return node;
				}
				if (!child) return; // invalid trie
				// merge with the collapsed child (which leaves its own path)
				const path = concat([node.path, child.path]);
				return child.type === EXT ? newExt(path, child.child) : newLeaf(path, child.data);
			}
			default:
				return common(node.path, key, depth) === node.path.length ? undefined : node;
		}
	}
}

// eth_getProof storage proof of a key path by reading rows (the nodes of getProof())
// value is the trimmed big-endian word (empty if unset)
export function getRowProof(read: RowReader, key: Uint8Array): { proof: Hex[]; value: Uint8Array } {
	const proof: Hex[] = [];
	let value: Uint8Array = EMPTY_BYTES;
	let path = "";
	let depth = 0;
	let enc = read(path);
	if (!enc) return { proof: [toHex(RLP_NULL)], value };
	while (enc) {
		proof.push(toHex(enc));
		const node = decodeNode(enc);
		if (node.type === BRANCH) {
			const i = key[depth++];
			if (!node.children[i]) break;
			path += HEX[i];
		} else if (node.type === EXT) {
			if (common(node.path, key, depth) < node.path.length) break;
			depth += node.path.length;
			path += toPathString(node.path);
		} else {
			if (common(node.path, key, depth) === node.path.length) value = node.data;
			break;
		}
		enc = read(path);
		if (!enc) throw new Error(`missing row: "${path}"`);
	}
	return { proof, value };
}

export function getProofFromRows(read: RowReader, slot: Uint8Array): { proof: Hex[]; value: Uint8Array } {
	return getRowProof(read, EthStorage.path(slot));
}
