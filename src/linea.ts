import { poseidon2, poseidon2Pad } from "./poseidon2.js";
import { SlotStorage } from "./storage.js";
import { EMPTY_BYTES } from "./trie.js";
import { concat, type Hex, toHex } from "viem";
import { equalBytes, toBytes, toWord, trimLeadingZeros } from "./utils.js";

// Linea storage trie of a single contract (Shomei "ZK trie", Poseidon2/KoalaBear era)
//
// * sparse binary merkle tree of depth 40, leaves placed in insertion order (never reused)
// * leaves form a linked list sorted by hkey, bounded by HEAD (#0) and TAIL (#1) sentinels
// * root = H(pad(nextFreeIndex) || subRoot)
// * leaf = H(pad(prev) || pad(next) || hkey || hval), hkey = H(pad(slot)), hval = H(pad(value))
// * new slots of a block are inserted in hkey order: buffer writes, then commit() per block
//
// https://github.com/Consensys/shomei/blob/main/trie/src/main/java/net/consensys/shomei/trie/ZKTrie.java
// https://github.com/LFDT-Lineth/lineth-monorepo/blob/main/contracts/src/libraries/SparseMerkleProof.sol

export const LINEA_TREE_DEPTH = 40;

const HEAD_INDEX = 0;
const TAIL_INDEX = 1;
const HEAD_HKEY = new Uint8Array(32);
const TAIL_HKEY = Uint8Array.from({ length: 32 }, (_, i) => (i & 3 ? 0 : 0x7f));
const ZERO_WORD = new Uint8Array(32);

// ZERO_HASHES[level] = root of an empty subtree of that height
const ZERO_HASHES: Uint8Array[] = [ZERO_WORD]; // empty leaf "hash" is 0
for (let i = 0; i < LINEA_TREE_DEPTH; i++) {
	const z = ZERO_HASHES[i];
	ZERO_HASHES.push(poseidon2(concat([z, z])));
}

export type LineaProof = {
	value: Hex; // raw 32-byte storage value
	proofRelatedNodes: Hex[]; // [root node, siblings (top -> bottom), leaf opening]
};

// storageProofs[] entry of linea_getProof
export type LineaStorageProof =
	| { key: Hex; leafIndex: number; proof: LineaProof }
	| {
			// key order matches shomei
			key: Hex;
			leftProof: LineaProof;
			rightProof: LineaProof;
			leftLeafIndex: number;
			rightLeafIndex: number;
	  };

// a live leaf (sentinels excluded), enough to restore the full state
export type LineaEntry = {
	index: number;
	slot: Uint8Array;
	value: Uint8Array;
};

type Leaf = {
	prev: number;
	next: number;
	hkey: Uint8Array;
	value: Uint8Array; // 32 bytes
	slot?: Uint8Array; // undefined for sentinels
};

export function lineaHashKey(slot: Uint8Array): Uint8Array {
	return poseidon2(poseidon2Pad(toWord(slot)));
}

export function lineaHashValue(value: Uint8Array): Uint8Array {
	return poseidon2(poseidon2Pad(toWord(value)));
}

function padIndex(i: number): Uint8Array {
	const word = new Uint8Array(32);
	new DataView(word.buffer).setBigUint64(24, BigInt(i));
	return poseidon2Pad(word);
}

function encodeLeaf(leaf: Leaf): Uint8Array {
	return concat([
		padIndex(leaf.prev),
		padIndex(leaf.next),
		leaf.hkey,
		leaf.slot ? lineaHashValue(leaf.value) : ZERO_WORD // sentinel hval is 0 (not hashed)
	]);
}

function siblingIndex(i: number) {
	return i % 2 ? i - 1 : i + 1; // note: indices exceed 2^31
}

export class LineaStorage extends SlotStorage {
	// restore from live entries (prev/next are implied by hkey order)
	static restore(nextFreeIndex: number, entries: Iterable<LineaEntry>): LineaStorage {
		const s = new this();
		const sorted = Array.from(entries, ({ index, slot, value }) => {
			if (index <= TAIL_INDEX || index >= nextFreeIndex) {
				throw new Error(`invalid leaf index: ${index}`);
			}
			value = toWord(value);
			if (!trimLeadingZeros(value).length) throw new Error(`zero value: #${index}`);
			const hkey = lineaHashKey(slot);
			return { index, slot: toWord(slot).slice(), value: value.slice(), hkey, hex: toHex(hkey) };
		}).sort((a, b) => (a.hex < b.hex ? -1 : 1));
		let prev = HEAD_INDEX;
		for (const { index, slot, value, hkey, hex } of sorted) {
			if (s.#leaves.has(index)) throw new Error(`duplicate leaf index: ${index}`);
			if (s.#indexOf.has(hex)) throw new Error(`duplicate slot: ${toHex(slot)}`);
			s.#leaves.set(index, { prev, next: TAIL_INDEX, hkey, value, slot });
			s.#leaves.get(prev)!.next = index;
			s.#indexOf.set(hex, index);
			s.#dirty.add(index);
			prev = index;
		}
		s.#leaves.get(TAIL_INDEX)!.prev = prev;
		s.#dirty.add(HEAD_INDEX);
		s.#dirty.add(TAIL_INDEX);
		s.#sorted = [HEAD_HKEY, ...sorted.map((x) => x.hkey), TAIL_HKEY].map((x) => toHex(x));
		s.#nextFreeIndex = nextFreeIndex;
		return s;
	}

	#nextFreeIndex = 2;
	readonly #leaves = new Map<number, Leaf>();
	readonly #indexOf = new Map<Hex, number>(); // hkey => leaf index
	#sorted: Hex[]; // all hkeys (incl. sentinels) in ascending order
	readonly #pending = new Map<Hex, { slot: Uint8Array; value: Uint8Array }>(); // slot => value
	readonly #nodes: Map<number, Uint8Array>[] = Array.from(
		{ length: LINEA_TREE_DEPTH + 1 },
		() => new Map()
	); // [level][index] => hash (absent = empty subtree)
	readonly #dirty = new Set<number>(); // leaf indices

	constructor() {
		super();
		this.#leaves.set(HEAD_INDEX, { prev: HEAD_INDEX, next: TAIL_INDEX, hkey: HEAD_HKEY, value: ZERO_WORD });
		this.#leaves.set(TAIL_INDEX, { prev: HEAD_INDEX, next: TAIL_INDEX, hkey: TAIL_HKEY, value: ZERO_WORD });
		this.#indexOf.set(toHex(HEAD_HKEY), HEAD_INDEX);
		this.#indexOf.set(toHex(TAIL_HKEY), TAIL_INDEX);
		this.#sorted = [toHex(HEAD_HKEY), toHex(TAIL_HKEY)];
		this.#dirty.add(HEAD_INDEX);
		this.#dirty.add(TAIL_INDEX);
	}

	get nextFreeIndex() {
		return this.#nextFreeIndex;
	}
	get size() {
		return this.#indexOf.size - 2;
	}
	get hasPending() {
		return this.#pending.size > 0;
	}

	*entries(): Generator<LineaEntry> {
		for (const [index, { slot, value }] of this.#leaves) {
			if (slot) yield { index, slot, value };
		}
	}

	getLeafIndex(slot: Uint8Array): number | undefined {
		return this.#indexOf.get(toHex(lineaHashKey(slot)));
	}

	// includes pending writes
	getStorage(slot: Uint8Array): Uint8Array {
		const pending = this.#pending.get(toHex(toWord(slot)));
		if (pending) return trimLeadingZeros(pending.value);
		const index = this.getLeafIndex(slot);
		return index === undefined ? EMPTY_BYTES : trimLeadingZeros(this.#leaves.get(index)!.value);
	}

	// buffered until commit()
	setStorage(slot: Uint8Array, value: Uint8Array) {
		slot = toWord(slot).slice();
		this.#pending.set(toHex(slot), { slot, value: toWord(value).slice() });
	}

	// apply buffered writes as one block: net changes in ascending hkey order
	commit() {
		const writes = Array.from(this.#pending.values(), (x) => {
			const hkey = lineaHashKey(x.slot);
			return { ...x, hkey, hex: toHex(hkey) };
		}).sort((a, b) => (a.hex < b.hex ? -1 : 1));
		this.#pending.clear();
		for (const { slot, value, hkey, hex } of writes) {
			const zero = !trimLeadingZeros(value).length;
			const index = this.#indexOf.get(hex);
			if (index !== undefined) {
				if (zero) {
					this.#remove(index, hex);
				} else {
					this.#leaves.get(index)!.value = value;
					this.#dirty.add(index);
				}
			} else if (!zero) {
				this.#insert(slot, value, hkey, hex);
			}
		}
	}

	// discard buffered writes
	rollback() {
		this.#pending.clear();
	}

	#insert(slot: Uint8Array, value: Uint8Array, hkey: Uint8Array, hex: Hex) {
		const pos = this.#lowerBound(hex);
		const left = this.#indexOf.get(this.#sorted[pos - 1])!;
		const right = this.#leaves.get(left)!.next;
		const index = this.#nextFreeIndex++;
		if (index >= 2 ** LINEA_TREE_DEPTH) throw new Error("tree is full");
		this.#leaves.get(left)!.next = index;
		this.#leaves.get(right)!.prev = index;
		this.#leaves.set(index, { prev: left, next: right, hkey, value, slot });
		this.#indexOf.set(hex, index);
		this.#sorted.splice(pos, 0, hex);
		this.#dirty.add(left).add(right).add(index);
	}

	#remove(index: number, hex: Hex) {
		const { prev, next } = this.#leaves.get(index)!;
		this.#leaves.get(prev)!.next = next;
		this.#leaves.get(next)!.prev = prev;
		this.#leaves.delete(index);
		this.#indexOf.delete(hex);
		this.#sorted.splice(this.#lowerBound(hex), 1);
		this.#dirty.add(prev).add(next).add(index);
	}

	// first position with sorted[pos] >= hex
	#lowerBound(hex: Hex): number {
		let lo = 0;
		let hi = this.#sorted.length;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if (this.#sorted[mid] < hex) lo = mid + 1;
			else hi = mid;
		}
		return lo;
	}

	#node(level: number, index: number): Uint8Array {
		return this.#nodes[level].get(index) ?? ZERO_HASHES[level];
	}

	#setNode(level: number, index: number, hash: Uint8Array) {
		if (equalBytes(hash, ZERO_HASHES[level])) {
			this.#nodes[level].delete(index);
		} else {
			this.#nodes[level].set(index, hash);
		}
	}

	#flush() {
		if (this.#pending.size) throw new Error("uncommitted writes: call commit()");
		if (!this.#dirty.size) return;
		let indices = new Set<number>();
		for (const i of this.#dirty) {
			const leaf = this.#leaves.get(i);
			this.#setNode(0, i, leaf ? poseidon2(encodeLeaf(leaf)) : ZERO_WORD);
			indices.add(Math.floor(i / 2));
		}
		this.#dirty.clear();
		for (let level = 1; level <= LINEA_TREE_DEPTH; level++) {
			const parents = new Set<number>();
			for (const i of indices) {
				const below = level - 1;
				this.#setNode(
					level,
					i,
					poseidon2(concat([this.#node(below, 2 * i), this.#node(below, 2 * i + 1)]))
				);
				parents.add(Math.floor(i / 2));
			}
			indices = parents;
		}
	}

	get subRootHash(): Uint8Array {
		this.#flush();
		return this.#node(LINEA_TREE_DEPTH, 0);
	}

	#rootNode(): Uint8Array {
		return concat([padIndex(this.#nextFreeIndex), this.subRootHash]);
	}

	// this is the storageRoot in the account leaf
	get rootHash(): Uint8Array {
		return poseidon2(this.#rootNode());
	}

	get storageRoot(): Hex {
		return toHex(this.rootHash);
	}

	#proof(index: number): LineaProof {
		const nodes = [this.#rootNode()]; // flushes
		for (let level = LINEA_TREE_DEPTH - 1, i = index; level >= 0; level--) {
			const sib = siblingIndex(Math.floor(i / 2 ** level));
			if (level) {
				nodes.push(concat([this.#node(level - 1, 2 * sib), this.#node(level - 1, 2 * sib + 1)]));
			} else {
				const leaf = this.#leaves.get(sib);
				nodes.push(leaf ? encodeLeaf(leaf) : ZERO_WORD);
			}
		}
		const leaf = this.#leaves.get(index)!;
		nodes.push(encodeLeaf(leaf));
		return {
			value: toHex(leaf.value),
			proofRelatedNodes: nodes.map((x) => toHex(x)),
		};
	}

	getProof(slot: Uint8Array): LineaStorageProof {
		const key = toHex(toWord(slot));
		const hex = toHex(lineaHashKey(slot));
		const index = this.#indexOf.get(hex);
		if (index !== undefined) {
			return { key, leafIndex: index, proof: this.#proof(index) };
		}
		const leftLeafIndex = this.#indexOf.get(this.#sorted[this.#lowerBound(hex) - 1])!;
		const rightLeafIndex = this.#leaves.get(leftLeafIndex)!.next;
		return {
			key,
			leftProof: this.#proof(leftLeafIndex),
			rightProof: this.#proof(rightLeafIndex),
			leftLeafIndex,
			rightLeafIndex,
		};
	}
}

// verify a proof against a storage root (as SparseMerkleProof.verifyProof does)
export function verifyLineaProof(
	proof: LineaProof,
	leafIndex: number,
	storageRoot: Uint8Array
): boolean {
	const nodes = proof.proofRelatedNodes.map((x) => toBytes(x));
	if (nodes.length !== LINEA_TREE_DEPTH + 2) return false;
	const root = nodes[0];
	if (root.length !== 96) return false;
	let hash = poseidon2(nodes[nodes.length - 1]);
	for (let level = 0, i = leafIndex; level < LINEA_TREE_DEPTH; level++, i = Math.floor(i / 2)) {
		const node = nodes[LINEA_TREE_DEPTH - level];
		const sib = !level && equalBytes(node, ZERO_WORD) ? ZERO_WORD : poseidon2(node);
		hash = poseidon2(i % 2 ? concat([sib, hash]) : concat([hash, sib]));
	}
	return equalBytes(hash, root.subarray(64)) && equalBytes(poseidon2(root), storageRoot);
}
