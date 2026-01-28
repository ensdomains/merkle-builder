import { describe, expect, test } from "bun:test";
import {
	copyNode,
	getProof,
	getRootHash,
	insertLeaf,
	isExtension,
	isLeaf,
	newBranch,
	newLeaf,
	type MaybeNode,
} from "../src/trie.js";
import { graftLimb, pluckLimbs } from "../src/surgery.js";
import { randomTrie } from "./utils.js";

describe("surgery", () => {
	describe("pluckLimbs", () => {
		test("invalid graft: null trunk", () => {
			expect(() =>
				graftLimb(undefined, [Uint8Array.of(), newBranch()]),
			).toThrow("invalid graft");
		});

		test("invalid graft: empty path", () => {
			expect(() =>
				graftLimb(newBranch(), [Uint8Array.of(), newBranch()]),
			).toThrow("invalid graft");
		});

		test("invalid path: too long", () => {
			expect(() =>
				graftLimb(newBranch(), [Uint8Array.of(0, 0), newBranch()]),
			).toThrow("invalid path");
		});

		test("invalid path: mismatch", () => {
			expect(() =>
				graftLimb({ path: Uint8Array.of(1), child: newBranch() }, [
					Uint8Array.of(0),
					newBranch(),
				]),
			).toThrow("invalid path");
		});

		test("invalid limb", () => {
			expect(() =>
				graftLimb({ path: Uint8Array.of(0), child: newBranch() }, [
					Uint8Array.of(0),
					newLeaf(Uint8Array.of(), Uint8Array.of(1)),
				]),
			).toThrow("invalid limb");
		});

		test("empty", () => {
			assertLimbless(undefined, 2);
			assertLimbless(undefined, 1);
			assertLimbless(undefined);
		});

		test("leaf", () => {
			const node = insertLeaf(undefined, Uint8Array.of(1, 2), Uint8Array.of(3));
			expect(isLeaf(node), "type").toBeTrue();
			assertLimbless(node, 3); // >
			assertLimbless(node, 2); // =
			assertLimbless(node, 1); // <
			assertLimbless(node);
		});

		test("extension (depth > length)", () => {
			let node = undefined;
			node = insertLeaf(node, Uint8Array.of(0, 0), Uint8Array.of(1));
			node = insertLeaf(node, Uint8Array.of(0, 1), Uint8Array.of(2));
			expect(isExtension(node), "type").toBeTrue();
			assertLimbless(node, 3);
			assertLimbless(node);
		});

		test("extension (depth < length)", () => {
			let node = undefined;
			node = insertLeaf(node, Uint8Array.of(0, 0, 0), Uint8Array.of(1));
			node = insertLeaf(node, Uint8Array.of(0, 0, 1), Uint8Array.of(2));
			expect(isExtension(node), "type").toBeTrue();
			let part = newBranch();
			part.children[0] = newLeaf(Uint8Array.of(), Uint8Array.of(1));
			part.children[1] = newLeaf(Uint8Array.of(), Uint8Array.of(2));
			const trunk = copyNode(node);
			expect(pluckLimbs(trunk, 1), "limbs").toStrictEqual([
				[Uint8Array.of(0), part],
			]);
			expect(trunk, "trunk").toStrictEqual({
				path: Uint8Array.of(0, 0),
				child: newBranch(),
			});
			assertLimbless(node);
		});

		test("extension (depth = length)", () => {
			let node = undefined;
			node = insertLeaf(node, Uint8Array.of(0, 0), Uint8Array.of(1));
			node = insertLeaf(node, Uint8Array.of(0, 1), Uint8Array.of(2));
			expect(isExtension(node), "type").toBeTrue();
			const trunk = copyNode(node);
			expect(pluckLimbs(trunk, 2), "limbs").toStrictEqual([
				[Uint8Array.of(0, 0), newLeaf(Uint8Array.of(), Uint8Array.of(1))],
				[Uint8Array.of(0, 1), newLeaf(Uint8Array.of(), Uint8Array.of(2))],
			]);
			expect(trunk, "trunk").toStrictEqual({
				path: Uint8Array.of(0),
				child: newBranch(),
			});
			assertLimbless(node);
		});

		test("complex", () => {
			let node = undefined;
			node = insertLeaf(node, Uint8Array.of(0, 0, 0, 0), Uint8Array.of(1));
			node = insertLeaf(node, Uint8Array.of(0, 0, 0, 1), Uint8Array.of(2));
			node = insertLeaf(node, Uint8Array.of(1, 0, 0, 0), Uint8Array.of(3));
			node = insertLeaf(node, Uint8Array.of(2, 3, 4, 5), Uint8Array.of(4));
			node = insertLeaf(node, Uint8Array.of(2, 3, 4, 6), Uint8Array.of(5));
			let part0 = newBranch();
			part0.children[0] = { path: Uint8Array.of(0, 0), child: newBranch() };
			part0.children[1] = newLeaf(Uint8Array.of(0, 0, 0), Uint8Array.of(3));
			part0.children[2] = { path: Uint8Array.of(3, 4), child: newBranch() };
			let part1 = newBranch();
			part1.children[0] = newLeaf(Uint8Array.of(), Uint8Array.of(1));
			part1.children[1] = newLeaf(Uint8Array.of(), Uint8Array.of(2));
			let part2 = newBranch();
			part2.children[5] = newLeaf(Uint8Array.of(), Uint8Array.of(4));
			part2.children[6] = newLeaf(Uint8Array.of(), Uint8Array.of(5));
			const trunk = copyNode(node);
			expect(pluckLimbs(trunk, 2), "limbs").toStrictEqual([
				[Uint8Array.of(0, 0), part1],
				[Uint8Array.of(2, 3), part2],
			]);
			expect(trunk, "trunk").toStrictEqual(part0);
			assertLimbless(node);
		});

		function assertLimbless(node: MaybeNode, depth = 0) {
			const trunk = copyNode(node);
			expect(pluckLimbs(trunk, depth), `limbs#${depth}`).toStrictEqual([]);
			expect(trunk, `trunk#${depth}`).toStrictEqual(node);
		}
	});

	describe("reconstruction", () => {
		for (let depth = 1; depth <= 8; ++depth) {
			for (let i = 0; i < 20; ++i) {
				test(`#${depth},${i}`, () => {
					const { node } = randomTrie(10);
					const trunk = copyNode(node);
					const limbs = pluckLimbs(trunk, depth);
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

		const trunk = copyNode(a);
		const limbs = pluckLimbs(trunk, 1);
		expect(limbs, "limbs").toHaveLength(2);
		expect(getRootHash(trunk)).toStrictEqual(rootHash);

		// partial proof
		expect(limbs[0][0]).toStrictEqual(path.subarray(0, 1));
		const b = graftLimb(trunk, limbs[0]);
		const pb = getProof(b, path);
		expect(pb).toStrictEqual(pa);
	});
});
