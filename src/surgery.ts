import {
	isBranch,
	isExtension,
	newBranch,
	type MaybeNode,
	type Node,
} from "./trie.js";

// warning: these operations (when unpaired) violate the trie invariants!

type Limb = [path: Uint8Array, node: Node];

// node is mutated, which preserves precomputed hashes, avoid with copyNode
// limbs are references (except extended branches)
// leaves within depth are never plucked
// extensions within depth are traversed to their child
// extended branches keep "cache" in the trunk (removed from limb)
// every limb path.length == depth
export function pluckLimbs(node: MaybeNode, depth: number): Limb[] {
	const limbs: Limb[] = [];
	if (node && depth > 0) pluck(node, []);
	return limbs;
	function pluck(node: Node, path: number[], ext = false): boolean | undefined {
		if (path.length >= depth) {
			if (ext && "cache" in node) {
				// since "cache" is in trunk, only copy children
				node = { children: node.children };
			}
			limbs.push([new Uint8Array(path.slice(0, depth)), node]);
			return true;
		} else if (isBranch(node)) {
			node.children.forEach((x, i, v) => {
				if (x && pluck(x, [...path, i])) {
					v[i] = undefined; // remove child
				}
			});
		} else if (
			isExtension(node) &&
			pluck(node.child, [...path, ...node.path], true)
		) {
			node.child = { ...node.child, ...newBranch() }; // remove children
		}
	}
}

// trunk is mutated, which preserves precomputed hashes, avoid with copyNode
// limb is referenced, avoid with copyNode
export function graftLimb(trunk: MaybeNode, [path, limb]: Limb): Node {
	if (!trunk || !path.length) throw new Error("invalid graft");
	const part: number[] = [];
	let parent: MaybeNode = undefined;
	let cursor: MaybeNode = trunk;
	while (part.length < path.length) {
		if (isBranch(cursor)) {
			const i = path[part.length];
			part.push(i);
			parent = cursor;
			cursor = cursor.children[i];
			if (isExtension(cursor)) {
				parent = cursor;
				part.push(...cursor.path);
				cursor = cursor.child;
			}
		} else if (isExtension(cursor)) {
			parent = cursor;
			part.push(...cursor.path);
			cursor = cursor.child;
		} else {
			break;
		}
	}
	if (!path.every((x, i) => x === part[i])) throw new Error("invalid path");
	if (isBranch(parent)) {
		parent.children[path[path.length - 1]] = limb;
	} else if (isExtension(parent)) {
		if (!isBranch(limb)) throw new Error("invalid limb");
		parent.child.children = limb.children;
	}
	return trunk;
}
