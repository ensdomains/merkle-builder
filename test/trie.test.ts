import { describe, expect, test } from "bun:test";
import { findLeaf, toNibblePath } from "../src/trie.js";
import { randomTrie } from "./utils.js";
import { keccak256 } from "../src/utils.js";

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
});
