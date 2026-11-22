import { describe, expect, test } from "bun:test";
import {
	copyNode,
	deleteNode,
	findLeaf,
	getRootHash,
	insertLeaf,
	isBranch,
	isExtension,
	isLeaf,
	toNibblePath,
	type LeafNode,
} from "../src/trie.js";
import { keccak256 } from "viem";
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
			let a = undefined;
			a = insertLeaf(a, Uint8Array.of(0, 0), Uint8Array.of(1));
			expect(isLeaf(a)).toBeTrue();
			expect(deleteNode(a, Uint8Array.of(0))).toBeUndefined();
		});

		test("delete branch by prefix", () => {
			//     root   ==>   [11]
			//     /  \
			//    0*   1
			//   / \    \
			// [0] [1]   [1]
			let a = undefined;
			a = insertLeaf(a, Uint8Array.of(0, 0), Uint8Array.of(1));
			a = insertLeaf(a, Uint8Array.of(0, 1), Uint8Array.of(1));
			a = insertLeaf(a, Uint8Array.of(1, 1), Uint8Array.of(1));
			let b = undefined;
			b = insertLeaf(b, Uint8Array.of(1, 1), Uint8Array.of(1));
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
			let a = undefined;
			a = insertLeaf(a, Uint8Array.of(0, 0), Uint8Array.of(1));
			a = insertLeaf(a, Uint8Array.of(1, 0), Uint8Array.of(1));
			a = insertLeaf(a, Uint8Array.of(1, 1), Uint8Array.of(1));
			let b = undefined;
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
			let a = undefined;
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
			let a = undefined;
			a = insertLeaf(a, Uint8Array.of(0, 0), Uint8Array.of(1));
			a = insertLeaf(a, Uint8Array.of(0, 1), Uint8Array.of(1));
			let b = undefined;
			b = insertLeaf(b, Uint8Array.of(0, 1), Uint8Array.of(1));
			expect(isExtension(a)).toBeTrue();
			expect(deleteNode(a, Uint8Array.of(0, 0))).toStrictEqual(b);
			expect(isLeaf(b)).toBeTrue();
		});
	});
});
