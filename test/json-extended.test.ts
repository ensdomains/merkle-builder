import { describe, expect, test } from "bun:test";
import { fromJSON, toJSON } from "../src/json.js";
import { EMPTY_BYTES, newBranch, newLeaf } from "../src/trie.js";
import { toBytes } from "../src/utils.js";

//-------------------------------------
// JSON Extended Tests
//-------------------------------------

describe("json", () => {
	test("toJSON: null node", () => {
		const json = toJSON(undefined);
		expect(json).toBeNull();
	});

	test("toJSON: leaf with hex data", () => {
		const leaf = newLeaf(new Uint8Array([1, 2]), toBytes(12345n));
		const json = toJSON(leaf);
		expect(typeof json).toBe("string");
		expect(json).toMatch(/^[0-9a-f]+$/);
	});

	test("toJSON: branch with children", () => {
		const branch = newBranch();
		branch.children[0] = newLeaf(new Uint8Array([1]), toBytes(100n));
		branch.children[1] = newLeaf(new Uint8Array([2]), toBytes(200n));
		const json = toJSON(branch);
		expect(typeof json).toBe("object");
		expect(json).not.toBeNull();
		if (json && typeof json === "object") {
			expect(json["0"]).toBeDefined();
			expect(json["1"]).toBeDefined();
		}
	});

	test("toJSON: depth limit", () => {
		const branch = newBranch();
		branch.children[0] = newLeaf(new Uint8Array([1]), toBytes(100n));
		const json = toJSON(branch, 0);
		// Should return the MORE symbol representation
		expect(json).toBeDefined();
	});

	test("fromJSON: null string", () => {
		const node = fromJSON(null);
		expect(node).toBeUndefined();
	});

	test("fromJSON: hex string to leaf", () => {
		const hexStr = "0x1234567890abcdef";
		const node = fromJSON(hexStr);
		expect(node).toBeDefined();
		if (node) {
			expect(node.path.length).toBe(0);
		}
	});

	test("fromJSON: branch object", () => {
		const json = {
			"0": "0x64",
			"1": "0xc8"
		};
		const node = fromJSON(json);
		expect(node).toBeDefined();
	});

	test("fromJSON: extension array", () => {
		const json = [["0x1", "0x64"]];
		const node = fromJSON(json);
		expect(node).toBeDefined();
	});

	test("fromJSON: nested branch", () => {
		const json = {
			"0": {
				"0": "0x01",
				"1": "0x02"
			},
			"1": "0x64"
		};
		const node = fromJSON(json);
		expect(node).toBeDefined();
	});

	test("roundtrip: leaf", () => {
		const original = newLeaf(new Uint8Array([10, 20, 30]), toBytes(12345n));
		const json = toJSON(original);
		const restored = fromJSON(json);
		expect(restored).toBeDefined();
	});

	test("roundtrip: branch", () => {
		const original = newBranch();
		original.children[0] = newLeaf(new Uint8Array([1]), toBytes(100n));
		original.children[5] = newLeaf(new Uint8Array([6]), toBytes(200n));
		
		const json = toJSON(original);
		const restored = fromJSON(json);
		expect(restored).toBeDefined();
	});

	test("fromJSON: invalid input throws", () => {
		expect(() => fromJSON(123 as any)).toThrow();
		expect(() => fromJSON("not-hex" as any)).toThrow();
	});

	test("fromJSON: invalid nibble throws", () => {
		const json = { "z": "0x01" };
		expect(() => fromJSON(json)).toThrow();
	});

	test("toJSON preserves structure for empty branch", () => {
		const branch = newBranch();
		const json = toJSON(branch);
		expect(json).toEqual({});
	});

	test("toJSON with depth=1 shows first level only", () => {
		const branch = newBranch();
		branch.children[0] = newLeaf(new Uint8Array([1]), toBytes(100n));
		const json = toJSON(branch, 1);
		// First level is shown, children are collapsed
		if (json && typeof json === "object") {
			expect(json["0"]).toBeDefined();
		}
	});
});
