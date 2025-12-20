import { afterAll, describe, expect, test } from "bun:test";
import { Foundry } from "@adraffy/blocksmith";
import {
	type MaybeNode,
	deleteNode,
	getRootHash,
	insertNode,
	toNibblePath,
} from "../src/trie.js";
import { keccak256, toBigInt, toBytes, toHex } from "../src/utils.js";
import { insertBytes, type InsertMode } from "../src/kv.js";
import { randomBytes, randomInt, randomTrie } from "./utils.js";
import { ethGetProof } from "./rpc.js";

describe("storage", async () => {
	const F = await Foundry.launch({ infoLog: false });
	afterAll(F.shutdown);

	const FUZZ = 20; // samples

	const mode: InsertMode = "zero"; // forge zeros instead of deletes

	test("empty", async () => {
		const C = await F.deploy(`contract X {}`);
		const { storageHash } = await ethGetProof(F.provider, C.target);
		expect(toHex(getRootHash(undefined))).toStrictEqual(storageHash);
	});

	test("OOG: zero", async () => {
		expect(
			F.deploy(`contract X {
				bytes slot0;
				constructor() {
					assembly { sstore(0, 10000001) }
					slot0 = '';
				}
			}`)
		).rejects.toThrow();
	});

	test("insertBytes: w/unset", async () => {
		const header = 2001;
		const C = await F.deploy(`contract X {
			bytes slot0;
			constructor() {
				assembly { sstore(0, ${header}) }
			}
			function set(bytes calldata v) external {
				slot0 = v;
			}
		}`);
		const v = randomBytes(31);
		await F.confirm(C.set(v));
		const { storageHash } = await ethGetProof(F.provider, C.target);
		const key = toBytes(0, 32);
		let node = undefined;
		node = insertNode(node, toNibblePath(keccak256(key)), toBytes(header));
		node = insertBytes(node, key, v, mode);
		expect(toHex(getRootHash(node))).toStrictEqual(storageHash);
	});

	test("insertBytes: w/smaller", async () => {
		const C = await F.deploy(`contract X {
			bytes slot0;
			function set(bytes calldata v) external {
				slot0 = v;
			}
		}`);
		const v1 = randomBytes(100);
		const v2 = randomBytes(v1.length >> 1); // smaller
		await F.confirm(C.set(v1));
		await F.confirm(C.set(v2));
		const { storageHash } = await ethGetProof(F.provider, C.target);
		const key = toBytes(0, 32);
		let node = undefined;
		node = insertBytes(node, key, v1, mode);
		node = insertBytes(node, key, v2, mode);
		expect(toHex(getRootHash(node))).toStrictEqual(storageHash);
	});

	function contractWithStorage(storage: [Uint8Array, Uint8Array][]) {
		return F.deploy(`contract X {
			constructor() {
				assembly {
					${storage.map(([k, v]) => `sstore(${toBigInt(k)}, ${toBigInt(v)})`).join("\n")}
				}
			}	
		}`);
	}

	describe("insertNode", () => {
		for (let i = 0; i < FUZZ; ++i) {
			const { node, storage } = randomTrie();
			test(`#${i} x ${storage.length}`, async () => {
				const C = await contractWithStorage(storage);
				const { storageHash } = await ethGetProof(F.provider, C.target);
				expect(toHex(getRootHash(node))).toStrictEqual(storageHash);
			});
		}
	});

	describe("deleteNode", () => {
		for (let i = 0; i < FUZZ; ++i) {
			const { node, storage } = randomTrie();
			test(`#${i} x ${storage.length}`, async () => {
				const deletedIndex = (storage.length * Math.random()) | 0;
				const [deletedKey] = storage[deletedIndex];
				storage.splice(deletedIndex, 1);
				const C = await contractWithStorage(storage);
				const { storageHash } = await ethGetProof(F.provider, C.target);
				const node2 = deleteNode(node, toNibblePath(keccak256(deletedKey)));
				expect(toHex(getRootHash(node2))).toStrictEqual(storageHash);
			});
		}
	});

	describe("bytes", () => {
		for (let i = 0; i < FUZZ; ++i) {
			const length = randomInt(50);
			test(`bytes #${i} x ${length}`, async () => {
				const C = await F.deploy(`contract X {
					struct S { bytes v; }
					function set(bytes32[] calldata ks, bytes[] calldata vs) external {
						S storage s;
						for (uint256 i; i < ks.length; ++i) {
							bytes32 slot = ks[i];
							assembly { s.slot := slot }
							s.v = vs[i];
						}
					}
				}`);
				const kv = Array.from({ length }, () => [
					randomBytes(32),
					randomBytes(randomInt(0, 100)),
				]);
				await F.confirm(
					C.set(
						kv.map((x) => x[0]),
						kv.map((x) => x[1])
					)
				);
				const { storageHash } = await ethGetProof(F.provider, C.target);
				const node = kv.reduce<MaybeNode>(
					(a, [k, v]) => insertBytes(a, k, v, mode),
					undefined
				);
				expect(toHex(getRootHash(node))).toStrictEqual(storageHash);
			});
		}
	});
});
