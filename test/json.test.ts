import { describe, expect, test } from "bun:test";
import { fromJSON, toJSON } from "../src/json.js";
import { insertLeaf, type MaybeNode } from "../src/trie.js";
import { randomTrie } from "./utils.js";

describe("inspect", () => {
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
});
