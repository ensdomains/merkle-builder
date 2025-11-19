import { keccak } from "@adraffy/keccak";

type LeafNode = { path: Uint8Array; value: Uint8Array };
type ExtensionNode = { path: Uint8Array; child: Node };
type BranchNode = { children: MaybeNode[]; value: Uint8Array | undefined };
export type Node = LeafNode | ExtensionNode | BranchNode;
export type MaybeNode = Node | undefined;

export function H(v: Uint8Array): Uint8Array {
	return keccak().update(v).bytes;
}

const RLP_NULL = encodeRlpBytes(new Uint8Array(0)); // Uint8Array.of(0x80);
const HASH_NULL = H(RLP_NULL);

function isBranch(node: Node): node is BranchNode {
	return "children" in node;
}

function isExtension(node: Node): node is ExtensionNode {
	return "child" in node;
}

function common(a: Uint8Array, b: Uint8Array): number {
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) ++i;
	return i;
}

export function insertNode(
	node: MaybeNode,
	path: Uint8Array,
	value: Uint8Array
): Node {
	if (!node) {
		return { path, value };
	} else if (isBranch(node)) {
		if (path.length) {
			const i = path[0];
			const children = node.children.slice();
			children[i] = insertNode(children[i], path.subarray(1), value);
			return { children, value: node.value };
		} else {
			return { children: node.children, value };
		}
	} else {
		const other = node.path;
		const i = common(other, path);
		if (i === other.length) {
			if (isExtension(node)) {
				return {
					path: other,
					child: insertNode(node.child, path.subarray(i), value),
				};
			} else if (i === path.length) {
				return { path, value }; // replace
			}
		}
		const b: BranchNode = {
			children: Array(16).fill(undefined),
			value: undefined,
		};
		if (i < other.length) {
			b.children[other[i]] = { ...node, path: other.subarray(i + 1) };
		}
		if (i < path.length) {
			b.children[path[i]] = { path: path.subarray(i + 1), value };
		} else {
			b.value = value;
		}
		return i ? { path: path.subarray(0, i), child: b } : b;
	}
}

export function encodeRlpNode(node: MaybeNode): Uint8Array {
	if (!node) {
		return RLP_NULL;
	} else if (isBranch(node)) {
		return encodeRlpList([
			...node.children.map(x => x ? encodeRlpBytes(encodeNodeHash(x)) : RLP_NULL),
			node.value ? encodeRlpBytes(encodeRlpBytes(node.value)) : RLP_NULL,
		]);
	} else if (isExtension(node)) {
		return encodeRlpList([
			encodeRlpBytes(encodePath(node.path, false)),
			encodeRlpBytes(encodeNodeHash(node.child)),
		]);
	} else {
		return encodeRlpList([
			encodeRlpBytes(encodePath(node.path, true)),
			encodeRlpBytes(encodeRlpBytes(node.value)),
		]);
	}
}

export function encodeNodeHash(node: MaybeNode): Uint8Array {
	if (!node) return HASH_NULL;
	const v = encodeRlpNode(node);
	return v.length < 32 ? v : H(v);
}

export function toNibblePath(v: Uint8Array) {
	const u = new Uint8Array(v.length << 1);
	let i = 0;
	for (const x of v) {
		u[i++] = x >> 4;
		u[i++] = x & 15;
	}
	return u;
}

export function encodePath(path: Uint8Array, leaf: boolean): Uint8Array {
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
