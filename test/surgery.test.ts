import { describe, expect, test } from "bun:test";
import {
	copyNode,
	getProof,
	getRootHash,
	insertLeaf,
	newBranch,
	newLeaf,
	type LeafNode,
} from "../src/trie.js";
import { graftLimb, pluckLimbs } from "../src/surgery.js";
import { randomTrie } from "./utils.js";

describe("surgery", () => {
	describe("pluckLimbs", () => {
		test("empty", () => {
			expect(pluckLimbs(undefined, 1)).toStrictEqual({
				trunk: undefined,
				limbs: [],
			});
		});

		test("leaf (inner)", () => {
			const node = newLeaf(Uint8Array.of(1, 2), Uint8Array.of(3, 4));
			expect(pluckLimbs(copyNode(node), 1)).toStrictEqual({
				trunk: undefined,
				limbs: [
					[node.path.subarray(0, 1), newLeaf(node.path.subarray(1), node.data)],
				],
			});
		});

		test("leaf (edge)", () => {
			const node: LeafNode = {
				path: Uint8Array.of(0, 0),
				data: Uint8Array.of(1),
			};
			expect(pluckLimbs(copyNode(node), 2)).toStrictEqual({
				trunk: undefined,
				limbs: [[node.path, newLeaf(node.path.subarray(2), node.data)]],
			});
		});

		test("leaf (outer)", () => {
			const node = newLeaf(Uint8Array.of(0, 0), Uint8Array.of(1));
			expect(pluckLimbs(copyNode(node), 3)).toStrictEqual({
				trunk: node,
				limbs: [],
			});
		});

		test("extension (inner)", () => {
			let node = undefined;
			node = insertLeaf(node, Uint8Array.of(0, 0), Uint8Array.of(1));
			node = insertLeaf(node, Uint8Array.of(0, 1), Uint8Array.of(2));
			let part = undefined;
			part = insertLeaf(part, Uint8Array.of(0), Uint8Array.of(1));
			part = insertLeaf(part, Uint8Array.of(1), Uint8Array.of(2));
			expect(pluckLimbs(copyNode(node), 1)).toStrictEqual({
				trunk: undefined,
				limbs: [[Uint8Array.of(0), part]],
			});
		});

		test("extension (edge)", () => {
			let node = undefined;
			node = insertLeaf(node, Uint8Array.of(0, 0), Uint8Array.of(1));
			node = insertLeaf(node, Uint8Array.of(0, 1), Uint8Array.of(2));
			expect(pluckLimbs(copyNode(node), 2)).toStrictEqual({
				trunk: {
					path: Uint8Array.of(0),
					child: newBranch(),
				},
				limbs: [
					[Uint8Array.of(0, 0), newLeaf(new Uint8Array(), Uint8Array.of(1))],
					[Uint8Array.of(0, 1), newLeaf(new Uint8Array(), Uint8Array.of(2))],
				],
			});
		});

		test("extension (outer)", () => {
			let node = undefined;
			node = insertLeaf(node, Uint8Array.of(0, 0), Uint8Array.of(1));
			node = insertLeaf(node, Uint8Array.of(0, 1), Uint8Array.of(2));
			expect(pluckLimbs(copyNode(node), 3)).toStrictEqual({
				trunk: node,
				limbs: [],
			});
		});

		test("extension (split)", () => {
			let node = undefined;
			node = insertLeaf(node, Uint8Array.of(0, 0, 0, 0), Uint8Array.of(1));
			node = insertLeaf(node, Uint8Array.of(0, 0, 0, 1), Uint8Array.of(2));
			node = insertLeaf(node, Uint8Array.of(1, 0, 0, 0), Uint8Array.of(3));
			let trunk = newBranch();
			trunk.children[0] = { path: Uint8Array.of(0, 0), child: newBranch() };
			trunk.children[1] = newLeaf(Uint8Array.of(0, 0, 0), Uint8Array.of(3));
			let part = undefined;
			part = insertLeaf(part, Uint8Array.of(0), Uint8Array.of(1));
			part = insertLeaf(part, Uint8Array.of(1), Uint8Array.of(2));
			expect(pluckLimbs(copyNode(node), 2)).toStrictEqual({
				trunk,
				limbs: [[Uint8Array.of(0, 0), part]],
			});
		});
	});

	describe("reconstruction", () => {
		for (let depth = 1; depth <= 8; ++depth) {
			for (let i = 0; i < 20; ++i) {
				test(`#${depth},${i}`, () => {
					const { node } = randomTrie(10);
					const { trunk, limbs } = pluckLimbs(copyNode(node), depth);
					const copy = limbs.reduce(graftLimb, trunk);
					expect(copy).toStrictEqual(node);
				});
			}
		}
	});

	test("getProof", () => {
		const path = Uint8Array.of(0, 0);

		let a = undefined;
		a = insertLeaf(a, path, Uint8Array.of(1));
		a = insertLeaf(a, Uint8Array.of(0, 1), Uint8Array.of(2));
		a = insertLeaf(a, Uint8Array.of(1, 0), Uint8Array.of(3));
		a = insertLeaf(a, Uint8Array.of(1, 1), Uint8Array.of(4));

		const pa = getProof(a, path);

		const rootHash = getRootHash(a);

		const { trunk, limbs } = pluckLimbs(copyNode(a), 1);
		expect(limbs).toHaveLength(2);
		expect(limbs[0][0]).toStrictEqual(path.subarray(0, 1));

		expect(getRootHash(trunk)).toStrictEqual(rootHash);

		const b = graftLimb(trunk, limbs[0]);

		const pb = getProof(b, path);

		expect(pb).toStrictEqual(pa);
	});
});
