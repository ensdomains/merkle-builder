import { isBranch, isExtension, isLeaf, type MaybeNode } from "./trie.js";

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
