import { describe, expect, test } from "bun:test";
import {
	deleteNode,
	findLeaf,
	insertNode,
	isBranch,
	isExtension,
	isLeaf,
	toNibblePath,
} from "../src/trie.js";
import { keccak256 } from "../src/utils.js";
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
						findLeaf(node, toNibblePath(keccak256(k)))?.value
					).toStrictEqual(v);
				}
			});
		}
	});

	describe("deleteNode", () => {
		test("delete leaf by prefix", () => {
			let a = undefined;
			a = insertNode(a, Uint8Array.of(0, 0), Uint8Array.of(1));
			expect(isLeaf(a)).toBeTrue();
			expect(deleteNode(a, Uint8Array.of(0))).toBeUndefined();
		});

		test("delete branch by prefix", () => {
			let a = undefined;
			a = insertNode(a, Uint8Array.of(0, 0), Uint8Array.of(1));
			a = insertNode(a, Uint8Array.of(0, 1), Uint8Array.of(1));
			a = insertNode(a, Uint8Array.of(1, 1), Uint8Array.of(1));
			let b = undefined;
			b = insertNode(b, Uint8Array.of(1, 1), Uint8Array.of(1));
			expect(isBranch(a)).toBeTrue();
			expect(deleteNode(a, Uint8Array.of(0))).toStrictEqual(b);
			expect(isLeaf(b));
		});

		test("collapse branch", () => {
			let a = undefined;
			a = insertNode(a, Uint8Array.of(0, 0), Uint8Array.of(1));
			a = insertNode(a, Uint8Array.of(1, 0), Uint8Array.of(1));
			a = insertNode(a, Uint8Array.of(1, 1), Uint8Array.of(1));
			let b = undefined;
			b = insertNode(b, Uint8Array.of(1, 0), Uint8Array.of(1));
			b = insertNode(b, Uint8Array.of(1, 1), Uint8Array.of(1));
			expect(isBranch(a)).toBeTrue();
			expect(deleteNode(a, Uint8Array.of(0))).toStrictEqual(b);
			expect(isExtension(b)).toBeTrue();
		});

		test("delete extension by prefix", () => {
			let a = undefined;
			a = insertNode(a, Uint8Array.of(0, 0), Uint8Array.of(1));
			a = insertNode(a, Uint8Array.of(0, 1), Uint8Array.of(1));
			expect(isExtension(a)).toBeTrue();
			expect(deleteNode(a, Uint8Array.of(0))).toBeUndefined();
		});

		test("collapse extension", () => {
			let a = undefined;
			a = insertNode(a, Uint8Array.of(0, 0), Uint8Array.of(1));
			a = insertNode(a, Uint8Array.of(0, 1), Uint8Array.of(1));
			let b = undefined;
			b = insertNode(b, Uint8Array.of(0, 1), Uint8Array.of(1));
			expect(isExtension(a)).toBeTrue();
			expect(deleteNode(a, Uint8Array.of(0, 0))).toStrictEqual(b);
			expect(isLeaf(b)).toBeTrue();
		});
	});
});
