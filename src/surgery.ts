import {
	isBranch,
	isExtension,
	newBranch,
	newLeaf,
	type BranchNode,
	type MaybeNode,
	type Node,
} from "./trie.js";
import { concat } from "./utils.js";

// warning: these operations (when unpaired) violate the trie invariants!

type Limb = [path: Uint8Array, node: Node];

// node is mutated, which preserves precomputed hashes, avoid with copyNode
// limb paths and nodes are references
// trunk is almost always node unless node exists entirely outside of the envelope
// leaves reached inside of the envelope are kept in the trunk
// extensions that span the envelope are kept in the trunk with no children
// every limb path.length == depth
export function pluckLimbs(
	node: MaybeNode,
	depth: number,
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
		parent.children.forEach((x, i) => {
			if (!x) return;
			if (path.length + 1 === depth) {
				parent.children[i] = undefined;
				limbs.push([Uint8Array.of(...path, i), x]);
			} else if (isBranch(x)) {
				queue.push([x, [...path, i]]);
			} else if (isExtension(x)) {
				const full = [...path, i, ...x.path];
				if (full.length >= depth) {
					const { cache, ...branch } = x.child; // remove cache from branch
					const child = newBranch(); // preserve extension with no children
					if (cache) child.cache = cache; // inject cache
					parent.children[i] = { path: x.path, child }; // new extension
					limbs.push([new Uint8Array(full.slice(0, depth)), branch]);
				} else {
					queue.push([x.child, full]); // extension inside depth
				}
			}
		});
	}
	return { trunk: node, limbs };
}

// trunk is mutated, which preserves precomputed hashes, avoid with copyNode
// limb avoids copy if possible, avoid with copyNode
// path is copied
export function graftLimb(trunk: MaybeNode, [path, limb]: Limb): Node {
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
	let index = 0;
	let parent: MaybeNode = trunk;
	while (index < path.length - 1) {
		if (isBranch(parent)) {
			parent = parent.children[path[index++]];
		} else if (isExtension(parent)) {
			index += parent.path.length; // check path?
			if (index >= path.length) break;
			parent = parent.child;
		} else {
			break;
		}
	}
	if (isExtension(parent)) {
		if (!isBranch(limb)) throw new RangeError("expected branch");
		parent.child.children = limb.children;
	} else if (isBranch(parent)) {
		if (isBranch(limb)) {
			parent.children[path[index]] =
				index + 1 == path.length
					? limb
					: { path: path.slice(index + 1), child: limb };
		} else {
			const copy = { ...limb };
			copy.path = concat(path.subarray(index + 1), copy.path);
			parent.children[path[index]] = copy;
		}
	} else {
		throw new RangeError("invalid graft location");
	}
	return trunk;
}
