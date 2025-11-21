import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Foundry } from "@adraffy/blocksmith";
import { randomBytes, randomInt } from "crypto";
import { getRootHash, type MaybeNode } from "../src/trie.js";
import { insertBytes } from "../src/kv.js";
import { toBytes, followSlot, toHex } from "../src/utils.js";
import { getStorageHash } from "./utils.js";

describe("registrar", () => {
	let F: Foundry;
	beforeAll(async () => {
		F = await Foundry.launch({ infoLog: true });
	});
	afterAll(() => F?.shutdown());

	test("test", async () => {
		const registrar = await F.deploy({
			import: "@ens/reverseRegistrar/L2ReverseRegistrar.sol",
			args: [1n],
		});

		let node: MaybeNode = undefined;

		registrar.on("NameForAddrChanged", (addr: string, name: string) => {
			node = insertBytes(
				node,
				followSlot(0n, toBytes(addr, 32)),
				Buffer.from(name)
			);
		});

		for (let i = 0; i < 10; ++i) {
			const w = await F.impersonateWallet(toHex(randomBytes(20)));
			await F.confirm(
				registrar.connect(w).setName(toHex(randomBytes(randomInt(1, 100))))
			);
		}

		const storageHash = await getStorageHash(F.provider, registrar.target);

		expect(toHex(getRootHash(node))).toStrictEqual(storageHash);
	});
});
