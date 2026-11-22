import { describe, expect, test } from "bun:test";
import {
	deleteNode,
	encodeNode,
	findLeaf,
	getRootHash,
	insertLeaf,
	isExtension,
	toNibblePath,
	type MaybeNode,
} from "../src/trie.js";
import { insertBytes, insertWord } from "../src/kv.js";
import { keccak256 } from "viem";
import { toBytes } from "../src/utils.js";

const p = (...v: number[]) => Uint8Array.from(v);

describe("regressions", () => {
	test("findLeaf: leaf with empty remaining path", () => {
		const node = insertLeaf(undefined, p(), p(1));
		expect(findLeaf(node, p())?.data).toStrictEqual(p(1));
	});

	test("findLeaf: leaf requires exact path", () => {
		const node = insertLeaf(undefined, p(1, 2), p(1));
		expect(findLeaf(node, p(1, 2, 3))).toBeUndefined();
	});

	test("deleteNode: partial match of extension is a no-op", () => {
		// (1,2,3) -> branch { 0: [], 1: [], 2: [] }
		let a: MaybeNode;
		a = insertLeaf(a, p(1, 2, 3, 0), p(1));
		a = insertLeaf(a, p(1, 2, 3, 1), p(2));
		a = insertLeaf(a, p(1, 2, 3, 2), p(3));
		expect(isExtension(a)).toBeTrue();
		// (1,2,0) diverges inside the extension, nothing should be deleted
		expect(deleteNode(a, p(1, 2, 0))).toStrictEqual(a);
		expect(deleteNode(a, p(1, 2, 0, 0))).toStrictEqual(a);
	});

	test("deleteNode: missing key keeps node identity (and hash cache)", () => {
		let a: MaybeNode;
		for (let i = 0; i < 16; i++) a = insertLeaf(a, p(i, 0, 0), p(i + 1));
		a = insertLeaf(a, p(5, 1, 0), p(99));
		encodeNode(a); // populate cache
		expect(deleteNode(a, p(5, 2, 0))).toBe(a);
		expect(deleteNode(a, p(5, 0, 1))).toBe(a);
	});

	test("getRootHash: root is always hashed", () => {
		const node = insertLeaf(undefined, p(1), p(1));
		expect(encodeNode(node).length).toBeLessThan(32);
		expect(getRootHash(node)).toStrictEqual(keccak256(encodeNode(node), "bytes"));
	});

	test("insertBytes(delete): all-zero chunk is not stored", () => {
		const slot = toBytes(0, 32);
		const value = new Uint8Array(64);
		value[0] = 1; // chunk #0 nonzero, chunk #1 all zero
		const node = insertBytes(undefined, slot, value);
		const first = keccak256(slot, "bytes");
		const chunk1 = toBytes(BigInt(`0x${Buffer.from(first).toString("hex")}`) + 1n, 32);
		expect(findLeaf(node, toNibblePath(keccak256(first, "bytes")))).toBeDefined();
		expect(findLeaf(node, toNibblePath(keccak256(chunk1, "bytes")))).toBeUndefined();
	});

	test("toBytes: overflow throws instead of truncating", () => {
		expect(() => toBytes("0x1234", 1)).toThrow();
		expect(() => toBytes(256, 1)).toThrow();
		expect(toBytes("0x0000ff", 1)).toStrictEqual(p(255));
		expect(toBytes(0)).toStrictEqual(p());
	});

	test("insertBytes: zeroLeaves / clearStale options", () => {
		const slot = toBytes(0, 32);
		const long = new Uint8Array(100).fill(1);
		const node = insertBytes(undefined, slot, long);
		const stale = toNibblePath(keccak256(keccak256(slot, "bytes"), "bytes")); // first data slot
		expect(findLeaf(node, stale)).toBeDefined();
		// default: stale data slots are removed
		expect(findLeaf(insertBytes(node, slot, Uint8Array.of(1)), stale)).toBeUndefined();
		// clearStale: false leaves them
		expect(findLeaf(insertBytes(node, slot, Uint8Array.of(1), { clearStale: false }), stale)?.data).toStrictEqual(long.subarray(0, 32));
		// zeroLeaves: true zeroes them
		expect(findLeaf(insertBytes(node, slot, Uint8Array.of(1), { zeroLeaves: true }), stale)?.data).toStrictEqual(new Uint8Array(0));
		expect(insertWord(undefined, slot, Uint8Array.of(0))).toBeUndefined();
		expect(insertWord(undefined, slot, Uint8Array.of(0), { zeroLeaves: true })).toBeDefined();
	});
});
