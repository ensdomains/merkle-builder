import { afterAll, describe, expect, test } from "bun:test";
import { Foundry } from "@adraffy/blocksmith";
import { getRootHash, type MaybeNode } from "../src/trie.js";
import { insertBytes } from "../src/kv.js";
import { toBytes, followSlot, toHex } from "../src/utils.js";
import { randomBytes, randomInt } from "./utils.js";
import { ethGetProof } from "./rpc.js";

describe("registrar", async () => {
	const F = await Foundry.launch({ infoLog: false }); // enable to show events
	afterAll(F.shutdown);

	test("setName", async () => {
		const C = await F.deploy({
			import: "@ens/reverseRegistrar/L2ReverseRegistrar.sol",
			args: [1n],
		});

		let node: MaybeNode = undefined;

		C.on("NameForAddrChanged", (addr: string, name: string) => {
			node = insertBytes(
				node,
				followSlot(0n, toBytes(addr, 32)),
				Buffer.from(name)
			);
		});

		for (let i = 0; i < 10; ++i) {
			const w = await F.impersonateWallet(toHex(randomBytes(20)));
			await F.confirm(
				C.connect(w).setName(toHex(randomBytes(randomInt(1, 100))))
			);
		}

		const { storageHash } = await ethGetProof(F.provider, C.target);

		expect(toHex(getRootHash(node))).toStrictEqual(storageHash);
	});
});
