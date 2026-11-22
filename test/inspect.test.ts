import { describe, expect, test } from "bun:test";
import {
	getByteCount,
	getLeafCount,
	getNodeCount,
	getNodeType,
} from "../src/inspect.js";
import {
	copyNode,
	getRootHash,
	insertLeaf,
	isBranch,
	isExtension,
	isLeaf,
	type MaybeNode,
} from "../src/trie.js";
import { randomTrie } from "./utils.js";

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

	test("getNodeType", () => {
		const leaf = insertLeaf(undefined, Uint8Array.of(0), Uint8Array.of(1));
		const branch = insertLeaf(leaf, Uint8Array.of(1), Uint8Array.of(2));
		const ext = insertLeaf(
			insertLeaf(undefined, Uint8Array.of(0, 0), Uint8Array.of(1)),
			Uint8Array.of(0, 1),
			Uint8Array.of(2),
		);
		expect(getNodeType(undefined)).toBe("null");
		expect(getNodeType(leaf)).toBe("leaf");
		expect(getNodeType(branch)).toBe("branch");
		expect(getNodeType(ext)).toBe("extension");
	});

	test("getByteCount: custom sizeOf", () => {
		// 2 leaves (path + data each) + branch with 16 child slots
		const node = insertLeaf(
			insertLeaf(undefined, Uint8Array.of(0), Uint8Array.of(1, 2)),
			Uint8Array.of(1),
			Uint8Array.of(3, 4),
		);
		expect(getByteCount(node, () => 1)).toBe(2 * 2 + 16);
	});

	test("getByteCount: includes cached encoding and hash", () => {
		const { node } = randomTrie(50);
		const before = getByteCount(node);
		getRootHash(node); // populates cache + hash on branches
		expect(getByteCount(node)).toBeGreaterThan(before);
		expect(getByteCount(copyNode(node))).toBe(getByteCount(node));
	});

	test("counts: nested branches", () => {
		const { node, storage } = randomTrie(100);
		expect(getLeafCount(node)).toBe(storage.length);
		expect(getNodeCount(node)).toBeGreaterThan(storage.length);
	});
});
