import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Foundry } from "@adraffy/blocksmith";
import {
	type MaybeNode,
	getRootHash,
	insertNode,
	toNibblePath,
} from "../src/trie.js";
import { keccak256, toBigInt, toBytes, toHex } from "../src/utils.js";
import { insertBytes } from "../src/kv.js";
import { randomBytes, randomInt, randomTrie } from "./utils.js";
import { ethGetProof } from "./rpc.js";

describe("storage", () => {
	let F: Foundry;
	beforeAll(async () => {
		F = await Foundry.launch({ infoLog: false });
	});
	afterAll(() => F?.shutdown());

	test("empty", async () => {
		const C = await F.deploy(`contract X {}`);
		const { storageHash } = await ethGetProof(F, C.target);
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

	test("insertBytes: zero w/unset", async () => {
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
		const { storageHash } = await ethGetProof(F, C.target);
		const key = toBytes(0, 32);
		let node = undefined;
		node = insertNode(node, toNibblePath(keccak256(key)), toBytes(header));
		node = insertBytes(node, key, v);
		expect(toHex(getRootHash(node))).toStrictEqual(storageHash);
	});

	test("insertBytes: zero w/smaller", async () => {
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
		const { storageHash } = await ethGetProof(F, C.target);
		const key = toBytes(0, 32);
		let node = undefined;
		node = insertBytes(node, key, v1);
		node = insertBytes(node, key, v2);
		expect(toHex(getRootHash(node))).toStrictEqual(storageHash);
	});

	describe("sstore", () => {
		for (let i = 0; i < 10; ++i) {
			const { node, storage } = randomTrie();
			test(`#${i} x ${storage.length}`, async () => {
				const C = await F.deploy(`contract X {
					constructor() {
						assembly {
							${storage.map(([k, v]) => `sstore(${toBigInt(k)}, ${toBigInt(v)})`).join("\n")}
						}
					}	
				}`);
				const { storageHash } = await ethGetProof(F, C.target);
				expect(toHex(getRootHash(node))).toStrictEqual(storageHash);
			});
		}
	});

	describe("bytes", () => {
		for (let i = 0; i < 10; ++i) {
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
				const { storageHash } = await ethGetProof(F, C.target);
				const node = kv.reduce<MaybeNode>(
					(a, [k, v]) => insertBytes(a, k, v),
					undefined
				);
				expect(toHex(getRootHash(node))).toStrictEqual(storageHash);
			});
		}
	});
});
