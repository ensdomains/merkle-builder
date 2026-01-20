import {
	isBranch,
	isExtension,
	newLeaf,
	type BranchNode,
	type MaybeNode,
	type Node,
} from "./trie.js";
import { concat } from "./utils.js";

// warning: these operations (when unpaired) violate the trie invariants!

type Limb = [path: Uint8Array, node: Node];

// node is mutated, which preserves precomputed hashes, avoid with copyNode
// trunc is almost always node unless node exists entirely outside of the pluck envelope
// limb paths and nodes are references
export function pluckLimbs(
	node: MaybeNode,
	depth: number
): { trunk: MaybeNode; limbs: Limb[] } {
	if (!node || depth <= 0) return { trunk: node, limbs: [] };
	const queue: [parent: BranchNode, path: number[]][] = [];
	if (isBranch(node)) {
		queue.push([node, []]);
	} else if (isExtension(node)) {
		if (node.path.length >= depth) {
			const extension =
				node.path.length === depth
					? node.child
					: { path: node.path.subarray(depth), child: node.child };
			return {
				trunk: undefined,
				limbs: [[node.path.subarray(0, depth), extension]],
			};
		}
		queue.push([node.child, [...node.path]]);
	} else if (node.path.length >= depth) {
		const leaf = newLeaf(node.path.subarray(depth), node.data);
		return {
			trunk: undefined,
			limbs: [[node.path.subarray(0, depth), leaf]],
		};
	}
	const limbs: Limb[] = [];
	while (queue.length) {
		const [parent, path] = queue.pop()!;
		const rest = depth - path.length - 1;
		parent.children.forEach((child, i) => {
			if (!child) return;
			if (!rest) {
				parent.children[i] = undefined;
				limbs.push([Uint8Array.of(...path, i), child]);
			} else if (isBranch(child)) {
				queue.push([child, [...path, i]]);
			} else if (child.path.length > rest) {
				parent.children[i] = undefined;
				const copy = { ...child };
				copy.path = child.path.subarray(rest);
				limbs.push([
					Uint8Array.of(...path, i, ...child.path.subarray(0, rest)),
					copy,
				]);
			} else if (isExtension(child)) {
				queue.push([child.child, [...path, i, ...child.path]]);
			}
		});
	}
	return { trunk: node, limbs };
}

// trunk is mutated, which preserves precomputed hashes, avoid with copyNode
// limb avoids copy if possible, avoid with copyNode
// path is copied
export function graftLimb(
	trunk: MaybeNode,
	path: Uint8Array,
	limb: Node
): Node {
	if (!path.length) return limb; // technically invalid Limb
	if (!trunk) {
		if (isBranch(limb)) {
			return { path: path.slice(), child: limb };
		} else {
			const copy = { ...limb };
			copy.path = concat(path, copy.path);
			return copy;
		}
	}
	let start = 0;
	let index = 0;
	let node: MaybeNode = trunk;
	while (index < path.length - 1) {
		if (isBranch(node)) {
			const child: MaybeNode = node.children[path[index]];
			if (!child) {
				start = index;
				index = path.length - 1;
				break; // dropped extension
			}
			start = ++index;
			node = child;
		} else if (isExtension(node)) {
			++start;
			index += node.path.length;
			node = node.child;
		} else {
			break;
		}
	}
	if (!isBranch(node)) throw new RangeError("invalid graft");
	if (start === index) {
		node.children[path[start]] = limb;
	} else if (isBranch(limb)) {
		node.children[path[start]] = {
			path: path.slice(start + 1),
			child: limb,
		};
	} else {
		const copy = { ...limb };
		copy.path = concat(path.subarray(start + 1), copy.path);
		node.children[path[start]] = copy;
	}
	return trunk;
}
