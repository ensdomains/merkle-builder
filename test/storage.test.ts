import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Foundry } from "@adraffy/blocksmith";
import { type MaybeNode, getRootHash } from "../src/trie.js";
import { toBigInt, toBytes, toHex } from "../src/utils.js";
import { insertBytes } from "../src/kv.js";
import { getStorageHash, randomBytes, randomInt, randomTrie } from "./utils.js";

describe("storage", () => {
	let F: Foundry;
	beforeAll(async () => {
		F = await Foundry.launch({ infoLog: false });
	});
	afterAll(() => F?.shutdown());

	const N = 10;

	test("empty", async () => {
		const contract = await F.deploy(`contract X {}`);
		const storageHash = await getStorageHash(F.provider, contract.target);
		expect(toHex(getRootHash(undefined))).toStrictEqual(storageHash);
	});

	test("insertBytes: zero", async () => {
		const contract = await F.deploy(`contract X {
			bytes slot0;
			function set(bytes calldata v) external {
				slot0 = v;
			}
		}`);
		const v1 = randomBytes(100);
		const v2 = randomBytes(v1.length >> 1); // smaller
		await F.confirm(contract.set(v1));
		await F.confirm(contract.set(v2));
		const storageHash = await getStorageHash(F.provider, contract.target);
		let node = undefined;
		const key = toBytes(0, 32);
		node = insertBytes(node, key, v1);
		node = insertBytes(node, key, v2);
		expect(toHex(getRootHash(node))).toStrictEqual(storageHash);
	});

	describe("sstore", () => {
		for (let i = 0; i < N; ++i) {
			const { node, storage } = randomTrie();
			test(`#${i} x ${storage.length}`, async () => {
				const contract = await F.deploy(`contract X {
					constructor() {
						assembly {
							${storage.map(([k, v]) => `sstore(${toBigInt(k)}, ${toBigInt(v)})`).join("\n")}
						}
					}	
				}`);
				const storageHash = await getStorageHash(
					F.provider,
					contract.target
				);
				expect(toHex(getRootHash(node))).toStrictEqual(storageHash);
			});
		}
	});

	describe("bytes", () => {
		for (let i = 0; i < N; ++i) {
			const length = randomInt(50);
			test(`bytes #${i} x ${length}`, async () => {
				const contract = await F.deploy(`contract X {
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
					contract.set(
						kv.map((x) => x[0]),
						kv.map((x) => x[1])
					)
				);
				const storageHash = await getStorageHash(
					F.provider,
					contract.target
				);
				const node = kv.reduce<MaybeNode>(
					(a, [k, v]) => insertBytes(a, k, v),
					undefined
				);
				expect(toHex(getRootHash(node))).toStrictEqual(storageHash);
			});
		}
	});
});
