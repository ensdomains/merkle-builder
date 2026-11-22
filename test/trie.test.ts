import { describe, expect, test } from "bun:test";
import { keccak256 } from "viem";
import {
	copyNode,
	deleteNode,
	findLeaf,
	getRootHash,
	insertLeaf,
	isBranch,
	isExtension,
	isLeaf,
	type LeafNode,
	type MaybeNode,
	toNibblePath,
} from "../src/trie.js";
import { randomTrie } from "./utils.js";

describe("trie", () => {
	describe("findNode", () => {
		test("empty", () => {
			expect(findLeaf(undefined, new Uint8Array(0))).toBeUndefined();
		});

		for (let i = 0; i < 10; ++i) {
			test(`#${i}`, () => {
				const { node, storage } = randomTrie();
				for (const [k, v] of storage) {
					expect(
						findLeaf(node, toNibblePath(keccak256(k, "bytes")))?.data
					).toStrictEqual(v);
				}
			});
		}
	});

	describe("copyNode", () => {
		test("empty", () => {
			expect(copyNode(undefined)).toBeUndefined();
		});

		for (let i = 0; i < 10; ++i) {
			test(`#${i}`, () => {
				const { node } = randomTrie();
				const copy = copyNode(node);
				expect(getRootHash(copy)).toStrictEqual(getRootHash(node));
			});
		}

		test("copyPaths", () => {
			const path = Uint8Array.of(0);
			const node: LeafNode = { path, data: Uint8Array.of(1) };
			const copy = copyNode(node, true);
			expect(copy.path !== node.path);
			expect(copy.path).toStrictEqual(node.path);
		});

		test("copyData", () => {
			const data = Uint8Array.of(1);
			const node: LeafNode = { path: Uint8Array.of(0), data };
			const copy = copyNode(node, true);
			expect(copy.data !== node.data);
			expect(copy.data).toStrictEqual(node.data);
		});
	});

	describe("deleteNode", () => {
		//  _  = branch
		// [_] = leaf
		// (_) = extension
		//  *  = deleted

		test("delete leaf by prefix", () => {
			//    root     ==>   null
			//     /
			//    0*
			//   / \
			// [0] [1]
			const a = insertLeaf(undefined, Uint8Array.of(0, 0), Uint8Array.of(1));
			expect(isLeaf(a)).toBeTrue();
			expect(deleteNode(a, Uint8Array.of(0))).toBeUndefined();
		});

		test("delete branch by prefix", () => {
			//     root   ==>   [11]
			//     /  \
			//    0*   1
			//   / \    \
			// [0] [1]   [1]
			let a: MaybeNode;
			a = insertLeaf(a, Uint8Array.of(0, 0), Uint8Array.of(1));
			a = insertLeaf(a, Uint8Array.of(0, 1), Uint8Array.of(1));
			a = insertLeaf(a, Uint8Array.of(1, 1), Uint8Array.of(1));
			const b = insertLeaf(undefined, Uint8Array.of(1, 1), Uint8Array.of(1));
			expect(isBranch(a)).toBeTrue();
			expect(deleteNode(a, Uint8Array.of(0))).toStrictEqual(b);
			expect(isLeaf(b));
		});

		test("collapse branch", () => {
			//     root    ==>    (1)
			//     /  \           /  \
			//    0*   1        [0]  [1]
			//   /    / \
			// [0]  [0] [1]
			let a: MaybeNode;
			a = insertLeaf(a, Uint8Array.of(0, 0), Uint8Array.of(1));
			a = insertLeaf(a, Uint8Array.of(1, 0), Uint8Array.of(1));
			a = insertLeaf(a, Uint8Array.of(1, 1), Uint8Array.of(1));
			let b: MaybeNode;
			b = insertLeaf(b, Uint8Array.of(1, 0), Uint8Array.of(1));
			b = insertLeaf(b, Uint8Array.of(1, 1), Uint8Array.of(1));
			expect(isBranch(a)).toBeTrue();
			expect(deleteNode(a, Uint8Array.of(0))).toStrictEqual(b);
			expect(isExtension(b)).toBeTrue();
		});

		test("delete extension by prefix", () => {
			//     root    ==>   null
			//     /
			//   (0)*
			//   / \
			// [0] [1]
			let a: MaybeNode;
			a = insertLeaf(a, Uint8Array.of(0, 0), Uint8Array.of(1));
			a = insertLeaf(a, Uint8Array.of(0, 1), Uint8Array.of(1));
			expect(isExtension(a)).toBeTrue();
			expect(deleteNode(a, Uint8Array.of(0))).toBeUndefined();
		});

		test("collapse extension", () => {
			//     root    ==>    [01]
			//     /
			//   (0)
			//   /  \
			// [0]* [1]
			let a: MaybeNode;
			a = insertLeaf(a, Uint8Array.of(0, 0), Uint8Array.of(1));
			a = insertLeaf(a, Uint8Array.of(0, 1), Uint8Array.of(1));
			const b = insertLeaf(undefined, Uint8Array.of(0, 1), Uint8Array.of(1));
			expect(isExtension(a)).toBeTrue();
			expect(deleteNode(a, Uint8Array.of(0, 0))).toStrictEqual(b);
			expect(isLeaf(b)).toBeTrue();
		});
	});

	describe("caching", () => {
		test("no-op insert returns the same node", () => {
			const { node, storage } = randomTrie();
			getRootHash(node);
			for (const [, v, path] of storage) {
				expect(insertLeaf(node, path, v)).toBe(node!);
			}
		});

		test("insert invalidates only the changed path", () => {
			const { node, storage } = randomTrie(200);
			getRootHash(node);
			const [, , path] = storage[0];
			const next = insertLeaf(node, path, Uint8Array.of(0xff));
			// sibling subtrees are shared and keep their cached hash
			const shared = (next as any).children.filter(
				(x: any, i: number) => x && i !== path[0],
			);
			expect(shared.length).toBeGreaterThan(0);
			for (const x of shared) {
				expect((node as any).children.includes(x)).toBeTrue();
			}
			expect((next as any).hash).toBeUndefined();
		});

		for (let i = 0; i < 5; i++) {
			test(`incremental root == rebuilt root #${i}`, () => {
				const { storage } = randomTrie(300);
				let node: MaybeNode;
				const live = new Map<string, [Uint8Array, Uint8Array]>();
				for (let j = 0; j < storage.length; j++) {
					const [k, v, path] = storage[j];
					if (j % 7 === 3 && live.size) {
						// delete a live key
						const [key, [p]] = live.entries().next().value!;
						node = deleteNode(node, p);
						live.delete(key);
					}
					node = insertLeaf(node, path, v);
					live.set(String(k), [path, v]);
					getRootHash(node); // populate caches along the way
				}
				const rebuilt = [...live.values()].reduce<MaybeNode>(
					(a, [p, v]) => insertLeaf(a, p, v),
					undefined,
				);
				expect(getRootHash(node)).toStrictEqual(getRootHash(rebuilt));
			});
		}
	});
});
