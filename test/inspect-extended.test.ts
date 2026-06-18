import { describe, expect, test } from "bun:test";
import { 
	getByteCount, 
	getLeafCount, 
	getNodeCount, 
	getNodeType 
} from "../src/inspect.js";
import { 
	newBranch, 
	newLeaf 
} from "../src/trie.js";

//-------------------------------------
// Inspect Extended Tests
//-------------------------------------

describe("inspect", () => {
	test("getByteCount: empty node", () => {
		const count = getByteCount(undefined);
		expect(count).toBe(0);
	});

	test("getByteCount: leaf node", () => {
		const path = new Uint8Array([1, 2, 3]);
		const data = new Uint8Array([10, 20, 30]);
		const leaf = newLeaf(path, data);
		const count = getByteCount(leaf);
		expect(count).toBeGreaterThan(0);
	});

	test("getByteCount: branch node", () => {
		const branch = newBranch();
		const count = getByteCount(branch);
		expect(count).toBeGreaterThanOrEqual(16); // 16 children slots
	});

	test("getByteCount: custom size function", () => {
		const path = new Uint8Array([1, 2]);
		const data = new Uint8Array([10, 20]);
		const leaf = newLeaf(path, data);
		const count = getByteCount(leaf, () => 1);
		// Each element counted as 1
		expect(count).toBeGreaterThanOrEqual(2);
	});

	test("getLeafCount: empty node", () => {
		const count = getLeafCount(undefined);
		expect(count).toBe(0);
	});

	test("getLeafCount: single leaf", () => {
		const path = new Uint8Array([1, 2, 3]);
		const data = new Uint8Array([10, 20, 30]);
		const leaf = newLeaf(path, data);
		const count = getLeafCount(leaf);
		expect(count).toBe(1);
	});

	test("getLeafCount: branch with leaves", () => {
		const branch = newBranch();
		branch.children[0] = newLeaf(new Uint8Array([1]), new Uint8Array([100]));
		branch.children[1] = newLeaf(new Uint8Array([2]), new Uint8Array([200]));
		const count = getLeafCount(branch);
		expect(count).toBe(2);
	});

	test("getNodeCount: empty node", () => {
		const count = getNodeCount(undefined);
		expect(count).toBe(0);
	});

	test("getNodeCount: single leaf", () => {
		const path = new Uint8Array([1, 2]);
		const data = new Uint8Array([10, 20]);
		const leaf = newLeaf(path, data);
		const count = getNodeCount(leaf);
		expect(count).toBe(1);
	});

	test("getNodeCount: branch with children", () => {
		const branch = newBranch();
		branch.children[0] = newLeaf(new Uint8Array([1]), new Uint8Array([100]));
		branch.children[1] = newLeaf(new Uint8Array([2]), new Uint8Array([200]));
		const count = getNodeCount(branch);
		// 1 branch + 2 leaves = 3 nodes
		expect(count).toBe(3);
	});

	test("getNodeType: null", () => {
		const type = getNodeType(undefined);
		expect(type).toBe("null");
	});

	test("getNodeType: leaf", () => {
		const path = new Uint8Array([1, 2]);
		const data = new Uint8Array([10, 20]);
		const leaf = newLeaf(path, data);
		const type = getNodeType(leaf);
		expect(type).toBe("leaf");
	});

	test("getNodeType: branch", () => {
		const branch = newBranch();
		const type = getNodeType(branch);
		expect(type).toBe("branch");
	});

	test("getNodeType: extension", () => {
		const branch = newBranch();
		const ext = { path: new Uint8Array([1, 2]), child: branch };
		const type = getNodeType(ext as any);
		expect(type).toBe("extension");
	});

	test("consistency: larger trie structure", () => {
		// Build a trie with multiple nodes
		const branch = newBranch();
		const subBranch = newBranch();
		const leaf1 = newLeaf(new Uint8Array([1]), new Uint8Array([100]));
		const leaf2 = newLeaf(new Uint8Array([2]), new Uint8Array([200]));
		subBranch.children[0] = leaf1;
		subBranch.children[1] = leaf2;
		branch.children[5] = subBranch;

		const nodeCount = getNodeCount(branch);
		const leafCount = getLeafCount(branch);
		
		// nodeCount should be >= leafCount
		expect(nodeCount).toBeGreaterThanOrEqual(leafCount);
		// For this structure: 1 branch + 1 subBranch + 2 leaves = 4 nodes, 2 leaves
		expect(nodeCount).toBe(4);
		expect(leafCount).toBe(2);
	});

	test("consistency: byte count vs node structure", () => {
		const leaf = newLeaf(new Uint8Array([1]), new Uint8Array([100]));
		const byteCount = getByteCount(leaf);
		const nodeCount = getNodeCount(leaf);
		
		// More bytes than nodes for a leaf (path + data)
		expect(byteCount).toBeGreaterThan(nodeCount);
	});
});
