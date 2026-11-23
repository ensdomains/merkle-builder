import keccak256 from "@adraffy/keccak/256";
import { concat, toHex } from "viem";
import { encodePath, encodeRlpBytes, encodeRlpList } from "./rlp.js";
import { equalBytes } from "./utils.js";

export type LeafNode = { path: Uint8Array; data: Uint8Array };
export type ExtensionNode = { path: Uint8Array; child: BranchNode };
export type BranchNode = {
	children: MaybeNode[];
	cache?: Uint8Array; // encodeNode(), computed lazily
	hash?: Uint8Array; // keccak256(cache), computed lazily
};

export type Node = LeafNode | ExtensionNode | BranchNode;
export type MaybeNode = Node | undefined;

export const EMPTY_BYTES = new Uint8Array(0);

const RLP_NULL = encodeRlpBytes(EMPTY_BYTES); // 0x80
const HASH_NULL = keccak256(RLP_NULL); // 0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421

export function isBranch(node: MaybeNode): node is BranchNode {
	return !!node && ("children" satisfies keyof BranchNode) in node;
}

export function isExtension(node: MaybeNode): node is ExtensionNode {
	return !!node && ("child" satisfies keyof ExtensionNode) in node;
}

export function isLeaf(node: MaybeNode): node is LeafNode {
	return !!node && ("data" satisfies keyof LeafNode) in node;
}

// return common prefix length
function common(a: Uint8Array, b: Uint8Array): number {
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) ++i;
	return i;
}

// return true if path starts with prefix
function startsWith(path: Uint8Array, prefix: Uint8Array): boolean {
	const n = prefix.length;
	if (path.length < n) return false;
	for (let i = 0; i < n; ++i) if (path[i] !== prefix[i]) return false;
	return true;
}


export function copyNode<T extends MaybeNode>(node: T, copyPath = true): T {
	if (isLeaf(node)) {
		return newLeaf(
			copyPath && node.path.length ? node.path.slice() : node.path,
			node.data
		) as T;
	} else if (isExtension(node)) {
		const copy = { ...node };
		if (copyPath && copy.path.length) copy.path = copy.path.slice();
		copy.child = copyNode(copy.child, copyPath);
		return copy;
	} else if (isBranch(node)) {
		const copy = { ...node };
		copy.children = copy.children.map((x) => copyNode(x, copyPath));
		return copy;
	} else {
		return node;
	}
}

export function findLeaf(
	node: MaybeNode,
	path: Uint8Array
): LeafNode | undefined {
	while (node) {
		if (isBranch(node)) {
			if (!path.length) return;
			node = node.children[path[0]];
			path = path.subarray(1);
		} else if (isExtension(node)) {
			if (!startsWith(path, node.path)) return;
			path = path.subarray(node.path.length);
			node = node.child;
		} else {
			return equalBytes(path, node.path) ? node : undefined;
		}
	}
	return;
}

export function getProof(node: MaybeNode, path: Uint8Array): Uint8Array[] {
	const ret: Uint8Array[] = [];
	do {
		ret.push(encodeNode(node));
		if (isBranch(node)) {
			if (!path.length) break;
			node = node.children[path[0]];
			path = path.subarray(1);
		} else if (isExtension(node)) {
			if (!startsWith(path, node.path)) break;
			path = path.subarray(node.path.length);
			node = node.child;
		} else {
			break;
		}
	} while (node);
	return ret;
}

// returns the same node (by reference) when nothing changed
export function insertLeaf(
	node: BranchNode,
	path: Uint8Array,
	data: Uint8Array
): BranchNode;
export function insertLeaf(
	node: MaybeNode,
	path: Uint8Array,
	data: Uint8Array
): Node;
export function insertLeaf(
	node: MaybeNode,
	path: Uint8Array,
	data: Uint8Array
) {
	if (!node) {
		return newLeaf(path, data);
	} else if (isBranch(node)) {
		if (!path.length) throw new Error("invalid path: ends at branch");
		const i = path[0];
		const prev = node.children[i];
		const child = insertLeaf(prev, path.subarray(1), data);
		if (child === prev) return node; // unchanged
		const children = node.children.slice();
		children[i] = child;
		return { children };
	} else if (isExtension(node)) {
		const other = node.path;
		const i = common(other, path);
		if (i === other.length) {
			const child = insertLeaf(node.child, path.subarray(i), data);
			return child === node.child ? node : { path: other, child };
		}
		if (i === path.length) throw new Error("invalid path: ends in extension");
		const b = newBranch();
		const rest = other.subarray(i + 1);
		b.children[other[i]] = rest.length
			? { path: rest, child: node.child }
			: node.child;
		b.children[path[i]] = newLeaf(path.subarray(i + 1), data);
		return i ? { path: path.subarray(0, i), child: b } : b;
	} else {
		const other = node.path;
		const i = common(other, path);
		if (i === other.length && i === path.length) {
			return equalBytes(node.data, data) ? node : newLeaf(path, data);
		} else if (i === other.length || i === path.length) {
			throw new Error("invalid path: length mismatch");
		}
		const b = newBranch();
		b.children[other[i]] = newLeaf(other.subarray(i + 1), node.data);
		b.children[path[i]] = newLeaf(path.subarray(i + 1), data);
		return i ? { path: path.subarray(0, i), child: b } : b;
	}
}

export function extractNode(node: MaybeNode, path: Uint8Array): MaybeNode {
	while (node) {
		if (!path.length) return node;
		if (isBranch(node)) {
			node = node.children[path[0]];
			path = path.subarray(1);
		} else if (isExtension(node)) {
			const part = node.path;
			const i = common(path, part);
			if (i === part.length) {
				node = node.child;
				path = path.subarray(i);
			} else if (i === path.length) {
				return { path: part.subarray(i), child: node.child };
			} else {
				return;
			}
		} else {
			const part = node.path;
			const i = common(path, part);
			if (i === path.length) {
				return { path: part.subarray(i), data: node.data };
			} else {
				return;
			}
		}
	}
	return;
}

// deletes every leaf whose path starts with path
// returns the same node (by reference) when nothing was deleted
export function deleteNode(node: MaybeNode, path: Uint8Array): MaybeNode {
	if (!node || !path.length) return;
	if (isBranch(node)) {
		const i = path[0];
		const prev = node.children[i];
		if (!prev) return node; // unchanged
		let child = deleteNode(prev, path.subarray(1));
		if (child === prev) return node; // unchanged
		const children = node.children.slice();
		children[i] = child;
		if (child) return { children }; // same structure
		let index = -1;
		for (let j = 0; j < children.length; ++j) {
			if (children[j]) {
				if (index >= 0) return { children }; // multiple children
				index = j; // remember child
			}
		}
		if (index < 0) return; // no children (only possible in a plucked trunk)
		// collapse single child
		child = children[index] as Node;
		if (isBranch(child)) return { path: Uint8Array.of(index), child }; // extension
		path = Uint8Array.of(index, ...child.path);
		return isExtension(child)
			? { path, child: child.child } // double extension
			: newLeaf(path, child.data);
	} else if (isExtension(node)) {
		const i = common(node.path, path);
		if (i === path.length) return; // path is a prefix: delete
		if (i < node.path.length) return node; // diverges: unchanged
		const child = deleteNode(node.child, path.subarray(i));
		if (child === node.child) return node; // unchanged
		if (!child) return; // deleted
		if (isBranch(child)) return { path: node.path, child }; // same structure
		path = concat([node.path, child.path]);
		return isExtension(child)
			? { path, child: child.child } // double extension
			: newLeaf(path, child.data);
	} else {
		if (common(node.path, path) === path.length) return; // delete
		return node; // unchanged
	}
}

// data is a trimmed non-zero word (zero is represented by the absence of a leaf)
export function newLeaf(path: Uint8Array, data: Uint8Array): LeafNode {
	if (!data.length) {
		throw new Error("empty leaf: use deleteNode");
	} else if (!data[0]) {
		throw new Error(`not trim: ${toHex(data)}`);
	}
	return { path, data };
}

export function newBranch(): BranchNode {
	return { children: Array(16).fill(undefined) };
}

export function encodeNode(node: MaybeNode): Uint8Array {
	if (!node) {
		return RLP_NULL;
	} else if (isBranch(node)) {
		if (!node.cache) {
			node.cache = encodeRlpList([...node.children.map(encodeNodeRef), RLP_NULL]);
		}
		return node.cache;
	} else if (isExtension(node)) {
		return encodeRlpList([
			encodeRlpBytes(encodePath(node.path, false)),
			encodeNodeRef(node.child),
		]);
	} else {
		return encodeRlpList([
			encodeRlpBytes(encodePath(node.path, true)),
			encodeRlpBytes(encodeRlpBytes(node.data)),
		]);
	}
}

// a child < 32 bytes is embedded as is (rlp list), otherwise by hash (rlp bytes)
function encodeNodeRef(node: MaybeNode) {
	if (!node) return RLP_NULL;
	const v = encodeNode(node);
	return v.length < 32 ? v : encodeRlpBytes(hashNode(node, v));
}

// keccak256(encodeNode(node)), cached on branches
function hashNode(node: Node, v = encodeNode(node)): Uint8Array {
	if (!isBranch(node)) return keccak256(v);
	if (!node.hash) node.hash = keccak256(v);
	return node.hash;
}

export function clearCache(node: MaybeNode) {
	if (isBranch(node)) {
		node.cache = node.hash = undefined;
		node.children.forEach(clearCache);
	} else if (isExtension(node)) {
		clearCache(node.child);
	}
}

// unlike child references, the root is always hashed (even if < 32 bytes)
export function getRootHash(node: MaybeNode): Uint8Array {
	return node ? hashNode(node) : HASH_NULL;
}

export function toNibblePath(v: Uint8Array): Uint8Array {
	if (!v.length) return EMPTY_BYTES;
	const u = new Uint8Array(v.length << 1);
	let i = 0;
	for (const x of v) {
		u[i++] = x >> 4;
		u[i++] = x & 15;
	}
	return u;
}

// inspection

export function getByteCount(
	node: MaybeNode,
	sizeOf = (v: Uint8Array) => v.length
): number {
	if (!node) {
		return 0;
	} else if (isLeaf(node)) {
		return sizeOf(node.path) + sizeOf(node.data);
	} else if (isExtension(node)) {
		return sizeOf(node.path) + getByteCount(node.child, sizeOf);
	} else {
		return node.children.reduce(
			(a, x) => a + getByteCount(x, sizeOf),
			(node.cache ? sizeOf(node.cache) : 0) +
				(node.hash ? sizeOf(node.hash) : 0) +
				node.children.length
		);
	}
}

export function getLeafCount(node: MaybeNode): number {
	if (!node) {
		return 0;
	} else if (isLeaf(node)) {
		return 1;
	} else if (isExtension(node)) {
		return getLeafCount(node.child);
	} else {
		return node.children.reduce((a, x) => a + getLeafCount(x), 0);
	}
}

export function getNodeCount(node: MaybeNode): number {
	if (!node) {
		return 0;
	} else if (isLeaf(node)) {
		return 1;
	} else if (isExtension(node)) {
		return 1 + getNodeCount(node.child);
	} else {
		return node.children.reduce((a, x) => a + getNodeCount(x), 1);
	}
}

export function getNodeType(node: MaybeNode) {
	if (isBranch(node)) {
		return "branch";
	} else if (isExtension(node)) {
		return "extension";
	} else if (isLeaf(node)) {
		return "leaf";
	} else {
		return "null";
	}
}
