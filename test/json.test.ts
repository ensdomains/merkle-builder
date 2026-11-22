import { describe, expect, test } from "bun:test";
import { fromJSON, toJSON } from "../src/json.js";
import { insertLeaf, type MaybeNode } from "../src/trie.js";
import { randomTrie } from "./utils.js";

describe("json", () => {
	test("null", () => {
		const node = undefined;
		expect(toJSON(node)).toStrictEqual(null);
		expect(fromJSON(null)).toStrictEqual(node);
	});

	test("leaf", () => {
		const json = "010203";
		const node = insertLeaf(undefined, Uint8Array.of(), Uint8Array.of(1, 2, 3));
		expect(toJSON(node)).toStrictEqual(json);
		expect(fromJSON(json)).toStrictEqual(node);
	});

	test("branch", () => {
		const json = {
			"0": "0102",
			"1": "0304",
		};
		let node: MaybeNode;
		node = insertLeaf(node, Uint8Array.of(0), Uint8Array.of(1, 2));
		node = insertLeaf(node, Uint8Array.of(1), Uint8Array.of(3, 4));
		expect(toJSON(node)).toStrictEqual(json);
		expect(fromJSON(json)).toStrictEqual(node);
	});

	test("extension", () => {
		const json = [
			"00",
			{
				"0": "0102",
				"1": "0304",
			},
		];
		let node: MaybeNode;
		node = insertLeaf(node, Uint8Array.of(0, 0, 0), Uint8Array.of(1, 2));
		node = insertLeaf(node, Uint8Array.of(0, 0, 1), Uint8Array.of(3, 4));
		expect(toJSON(node)).toStrictEqual(json);
		expect(fromJSON(json)).toStrictEqual(node);
	});

	for (let i = 0; i < 10; ++i) {
		test(`#${i}`, async () => {
			const { node } = randomTrie();
			expect(fromJSON(toJSON(node))).toStrictEqual(node);
		});
	}

	test("fromJSON: accepts 0x prefix", () => {
		expect(fromJSON("0x0102")).toStrictEqual(fromJSON("0102"));
	});

	test("fromJSON: nested arrays merge into one path", () => {
		// extension -> leaf collapses into a single leaf
		expect(fromJSON(["01", ["2", "aa"]])).toStrictEqual(
			insertLeaf(undefined, Uint8Array.of(0, 1, 2), Uint8Array.of(0xaa)),
		);
		// extension -> extension collapses into a single extension
		const branch = { "0": "01", "1": "02" };
		expect(fromJSON(["1", ["2", branch]])).toStrictEqual(fromJSON(["12", branch]));
	});

	test("toJSON: depth limit", () => {
		const { node } = randomTrie(100);
		const shallow = toJSON(node, 0) as Record<string, unknown>;
		const values = Object.values(shallow);
		expect(values.length).toBeGreaterThan(1);
		for (const x of values) {
			// children are replaced by an opaque placeholder
			expect(typeof x).toBe("object");
			expect(Array.isArray(x)).toBeFalse();
			expect(Object.keys(x as object)).toStrictEqual([]);
		}
		expect(() => fromJSON(shallow)).toThrow("depth-limited");
		expect(fromJSON(toJSON(node, Infinity))).toStrictEqual(node);
	});

	test("fromJSON: invalid input throws", () => {
		expect(() => fromJSON(123)).toThrow("invalid json");
		expect(() => fromJSON(true)).toThrow("invalid json");
		expect(() => fromJSON(["0"])).toThrow("invalid json"); // not [path, child]
		expect(() => fromJSON(["0", null])).toThrow("invalid json");
		expect(() => fromJSON({ z: "01" })).toThrow("invalid nibble");
		expect(() => fromJSON(["0g", "01"])).toThrow("invalid nibble");
		expect(() => fromJSON("xyz")).toThrow(); // not hex
		expect(() => fromJSON("")).toThrow("empty leaf"); // zero is no leaf
		expect(() => fromJSON("0001")).toThrow("not trim");
	});
});
