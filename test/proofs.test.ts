import { afterAll, describe, expect, test } from "bun:test";
import { Foundry } from "@adraffy/blocksmith";
import { keccak256, toHex } from "viem";
import { EthStorage } from "../src/eth.js";
import { insertWord } from "../src/kv.js";
import { getProof, toNibblePath } from "../src/trie.js";
import { toBigInt, toBytes } from "../src/utils.js";
import { ethGetProof } from "./rpc.js";
import { randomTrie } from "./utils.js";

describe("proofs", async () => {
	const F = await Foundry.launch({ infoLog: false });
	afterAll(F.shutdown);

	test("dne", async () => {
		const C = await F.deploy(`contract X {}`);
		const slot = toBytes(0, 32);
		const { storageProof } = await ethGetProof(F.provider, C.target, [slot]);
		const proof = getProof(undefined, toNibblePath(keccak256(slot, "bytes"))).map((x) => toHex(x));
		expect(proof).toStrictEqual(storageProof[0].proof);
	});

	test("zero", async () => {
		const C = await F.deploy(`contract X {
			uint256 slot0 = 0;
		}`);
		const slot = toBytes(0, 32);
		const { storageProof } = await ethGetProof(F.provider, C.target, [slot]);
		const path = toNibblePath(keccak256(slot, "bytes"));
		const node = insertWord(undefined, slot, toBytes(0)); // zero => absent
		expect(node).toBeUndefined();
		const proof = getProof(node, path).map((x) => toHex(x));
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
					getProof(node, toNibblePath(keccak256(k, "bytes"))).map((x) => toHex(x))
				)
			).toStrictEqual(storageProof.map((x) => x.proof));
		});
	}

	test("EthStorage: full storageProof (key, value, proof)", async () => {
		const { storage } = randomTrie();
		const C = await F.deploy(`contract X {
			constructor() {
				assembly {
					${storage.map(([k, v]) => `sstore(${toBigInt(k)}, ${toBigInt(v)})`).join("\n")}
				}
			}
		}`);
		const s = new EthStorage();
		for (const [k, v] of storage) s.setStorage(k, v);
		const slots = [...storage.map(([k]) => k), toBytes(0, 32)]; // + missing
		const { storageHash, storageProof } = await ethGetProof(F.provider, C.target, slots);
		expect(s.storageHash).toBe(storageHash);
		expect(slots.map((x) => s.getProof(x))).toStrictEqual(storageProof);
	});

	test("EthStorage: bytes round trip", async () => {
		const s = new EthStorage();
		const slot = toBytes(1, 32);
		for (const len of [0, 7, 31, 32, 33, 200, 40, 3, 0]) {
			const v = new Uint8Array(len).map((_, i) => i + 1);
			s.setBytes(slot, v);
			expect(s.getBytes(slot)).toStrictEqual(v);
		}
		expect(s.node).toBeUndefined();
	});
});
