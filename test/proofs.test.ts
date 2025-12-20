import { afterAll, describe, expect, test } from "bun:test";
import { Foundry } from "@adraffy/blocksmith";
import { getProof, insertNode, toNibblePath } from "../src/trie.js";
import { keccak256, toBigInt, toBytes, toHex } from "../src/utils.js";
import { ethGetProof } from "./rpc.js";
import { randomTrie } from "./utils.js";

describe("proofs", async () => {
	const F = await Foundry.launch({ infoLog: false });
	afterAll(F.shutdown);

	test("dne", async () => {
		const C = await F.deploy(`contract X {}`);
		const slot = toBytes(0, 32);
		const { storageProof } = await ethGetProof(F.provider, C.target, [slot]);
		const proof = getProof(undefined, toNibblePath(keccak256(slot))).map(toHex);
		expect(proof).toStrictEqual(storageProof[0].proof);
	});

	test("zero", async () => {
		const C = await F.deploy(`contract X {
			uint256 slot0 = 0;
		}`);
		const slot = toBytes(0, 32);
		const { storageProof } = await ethGetProof(F.provider, C.target, [slot]);
		const path = toNibblePath(keccak256(slot));
		const node = insertNode(undefined, path, toBytes(0));
		const proof = getProof(node, path).map(toHex);
		expect(proof).toStrictEqual(storageProof[0].proof);
	});

	for (let i = 0; i < 10; ++i) {
		test(`#${i}`, async () => {
			const { node, storage } = randomTrie();
			const C = await F.deploy(`contract X {
				constructor() {
					assembly {
						${storage.map(([k, v]) => `sstore(${toBigInt(k)}, ${toBigInt(v)})`).join("\n")}
					}
				}
			}`);
			const { storageProof } = await ethGetProof(
				F.provider,
				C.target,
				storage.map(([k]) => k)
			);
			expect(
				storage.map(([k]) =>
					getProof(node, toNibblePath(keccak256(k))).map(toHex)
				)
			).toStrictEqual(storageProof.map((x) => x.proof));
		});
	}
});
