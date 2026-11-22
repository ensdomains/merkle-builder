import { describe, expect, test } from "bun:test";
import { getByteCount, getLeafCount, getNodeCount } from "../src/inspect.js";
import { insertLeaf, isBranch, isExtension, isLeaf, type MaybeNode } from "../src/trie.js";

describe("inspect", () => {
	test("null", () => {
		const node = undefined;
		expect(getNodeCount(node)).toStrictEqual(0);
		expect(getLeafCount(node)).toStrictEqual(0);
		expect(getByteCount(node)).toStrictEqual(0);
	});

	test("leaf", () => {
		const node = insertLeaf(undefined, Uint8Array.of(), Uint8Array.of(1, 2, 3));
		expect(isLeaf(node)).toBeTrue();
		expect(getNodeCount(node)).toStrictEqual(1);
		expect(getLeafCount(node)).toStrictEqual(1);
		expect(getByteCount(node)).toStrictEqual(3);
	});

	test("branch", () => {
		let node: MaybeNode;
		node = insertLeaf(node, Uint8Array.of(0), Uint8Array.of(1, 2));
		node = insertLeaf(node, Uint8Array.of(1), Uint8Array.of(3, 4));
		expect(isBranch(node)).toBeTrue();
		expect(getNodeCount(node)).toStrictEqual(3);
		expect(getLeafCount(node)).toStrictEqual(2);
		expect(getByteCount(node)).toStrictEqual(20);
	});

	test("extension", () => {
		let node: MaybeNode;
		node = insertLeaf(node, Uint8Array.of(0, 0, 0), Uint8Array.of(1, 2));
		node = insertLeaf(node, Uint8Array.of(0, 0, 1), Uint8Array.of(3, 4));
		expect(isExtension(node)).toBeTrue();
		expect(getNodeCount(node)).toStrictEqual(4);
		expect(getLeafCount(node)).toStrictEqual(2);
		expect(getByteCount(node)).toStrictEqual(22);
	});
});
