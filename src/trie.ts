import { keccak256, toHex } from "./utils.js";

type LeafNode = { path: Uint8Array; value: Uint8Array };
type ExtensionNode = { path: Uint8Array; child: Node };
type BranchNode = { children: MaybeNode[], cache?: Uint8Array };

export type Node = LeafNode | ExtensionNode | BranchNode;
export type MaybeNode = Node | undefined;

export const EMPTY_BYTES = new Uint8Array(0);
export const EMPTY_LEAF: LeafNode = Object.freeze({
	path: EMPTY_BYTES,
	value: EMPTY_BYTES,
});

const RLP_NULL = encodeRlpBytes(EMPTY_BYTES); // 0x80
const RLP_EMPTY = encodeRlpList([encodeRlpList([])]); // 0xc1c0
const HASH_NULL = keccak256(RLP_NULL); // 0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421

export function isBranch(node: MaybeNode): node is BranchNode {
	return !!node && "children" in node;
}

export function isExtension(node: MaybeNode): node is ExtensionNode {
	return !!node && "child" in node;
}

export function isLeaf(node: MaybeNode): node is LeafNode {
	return !!node && "value" in node;
}

export function isEmptyLeaf(node: MaybeNode) {
	return isLeaf(node) && !node.path.length && !node.value.length;
}

function common(a: Uint8Array, b: Uint8Array): number {
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) ++i;
	return i;
}

export function findLeaf(
	node: MaybeNode,
	path: Uint8Array
): LeafNode | undefined {
	if (!node) return;
	if (isBranch(node)) {
		if (path.length) {
			return findLeaf(node.children[path[0]], path.subarray(1));
		}
	} else if (isExtension(node)) {
		const n = node.path.length;
		if (path.length >= n && !Buffer.compare(node.path, path.subarray(0, n))) {
			return findLeaf(node.child, path.subarray(n));
		}
	} else if (!Buffer.compare(node.path, path)) {
		return node;
	}
}

export function getProof(node: MaybeNode, path: Uint8Array): Uint8Array[] {
	if (!node) return [RLP_NULL];
	const ret: Uint8Array[] = [];
	while (node) {
		ret.push(encodeNode(node));
		if (isBranch(node)) {
			if (!path.length) throw new Error('bug');
			node = node.children[path[0]];
			path = path.subarray(1)
		} else if (isExtension(node)) {
			const n = node.path.length;
			if (path.length < n || Buffer.compare(node.path, path.subarray(0, n))) break;
			node = node.child;
			path = path.subarray(n);
		} else {
			break;
		}
	}
	return ret;
}

export function insertNode(
	node: MaybeNode,
	path: Uint8Array,
	value: Uint8Array
): Node {
	if (!node) {
		return newLeaf(path, value);
	} else if (isBranch(node)) {
		const i = path[0];
		const children = node.children.slice();
		children[i] = insertNode(children[i], path.subarray(1), value);
		return { children };
	} else if (isExtension(node)) {
		const other = node.path;
		const i = common(other, path);
		if (i === other.length) {
			return {
				path: other,
				child: insertNode(node.child, path.subarray(i), value),
			};
		}
		const b = newBranch();
		if (i < other.length) {
			const rest = other.subarray(i + 1);
			b.children[other[i]] = rest.length
				? { path: rest, child: node.child }
				: node.child;
		}
		b.children[path[i]] = newLeaf(path.subarray(i + 1), value);
		return i ? { path: path.subarray(0, i), child: b } : b;
	} else {
		const other = node.path;
		const i = common(other, path);
		if (i === other.length && i === path.length) {
			return newLeaf(path, value);
		}
		const b = newBranch();
		if (i < other.length) {
			b.children[other[i]] = newLeaf(other.subarray(i + 1), node.value);
		}
		b.children[path[i]] = newLeaf(path.subarray(i + 1), value);
		return i ? { path: path.subarray(0, i), child: b } : b;
	}
}

function newLeaf(path: Uint8Array, value: Uint8Array): LeafNode {
	if (!value.length) {
		value = EMPTY_BYTES;
		if (!path.length) return EMPTY_LEAF;
	} else if (value[0] === 0) {
		throw new Error(`not trim: ${toHex(value)}`);
	}
	return { path, value };
}

function newBranch(): BranchNode {
	return { children: Array(16).fill(undefined) };
}

export function encodeNode(node: MaybeNode): Uint8Array {
	if (!node) {
		return RLP_NULL;
	} else if (isBranch(node)) {
		return node.cache ??= encodeRlpList([...node.children.map(encodeNodeRef), RLP_NULL]);
	} else if (isExtension(node)) {
		return encodeRlpList([
			encodeRlpBytes(encodePath(node.path, false)),
			encodeNodeRef(node.child),
		]);
	} else {
		return encodeRlpList([
			encodeRlpBytes(encodePath(node.path, true)),
			encodeRlpBytes(encodeRlpBytes(node.value)),
		]);
	}
}

function encodeNodeRef(node: MaybeNode) {
	if (!node) {
		return RLP_NULL;
	} else if (isEmptyLeaf(node)) {
		return RLP_EMPTY;
	} else {
		const v = encodeNode(node);
		return encodeRlpBytes(v.length < 32 ? v : keccak256(v));
	}
}

export function getRootHash(node: MaybeNode): Uint8Array {
	if (!node) return HASH_NULL;
	const v = encodeNode(node);
	return v.length < 32 ? v : keccak256(v);
}

export function toNibblePath(v: Uint8Array) {
	if (!v.length) return EMPTY_BYTES;
	const u = new Uint8Array(v.length << 1);
	let i = 0;
	for (const x of v) {
		u[i++] = x >> 4;
		u[i++] = x & 15;
	}
	return u;
}

function encodePath(path: Uint8Array, leaf: boolean): Uint8Array {
	const v = new Uint8Array(1 + (path.length >> 1));
	if (leaf) v[0] = 32;
	const odd = path.length & 1;
	if (path.length & 1) v[0] |= 16 | path[0];
	for (let i = odd, j = 1; i < path.length; i += 2, j++) {
		v[j] = (path[i] << 4) | path[i + 1];
	}
	return v;
}

function encodeRlpLength(start: number, length: number): Uint8Array {
	const max = 55;
	if (length <= max) return Uint8Array.of(start + length);
	const v = new Uint8Array(8);
	let i = v.length;
	for (; length; length >>= 8, ++start) {
		v[--i] = length & 255;
	}
	v[--i] = start + max;
	return v.subarray(i);
}

function encodeRlpList(m: Uint8Array[]): Uint8Array {
	return Buffer.concat([
		encodeRlpLength(
			0xc0,
			m.reduce((a, x) => a + x.length, 0)
		),
		...m,
	]);
}

function encodeRlpBytes(v: Uint8Array): Uint8Array {
	const max = 0x80;
	if (v.length == 1 && v[0] < max) return v;
	return Buffer.concat([encodeRlpLength(max, v.length), v]);
}
