import { afterAll, describe, expect, test } from "bun:test";
import { Foundry } from "@adraffy/blocksmith";
import { toHex } from "viem";
import { EthStorage } from "../src/eth.js";
import { followSlot, toBytes } from "../src/utils.js";
import { ethGetProof } from "./rpc.js";
import { randomBytes, randomInt } from "./utils.js";

describe("registrar", async () => {
	const F = await Foundry.launch({ infoLog: false }); // enable to show events
	afterAll(F.shutdown);

	test("setName", async () => {
		const C = await F.deploy({
			import: "@ens/reverseRegistrar/L2ReverseRegistrar.sol",
			args: [1n],
		});

		const storage = new EthStorage();

		C.on("NameForAddrChanged", (addr: string, name: string) => {
			storage.setBytes(followSlot(0n, toBytes(addr, 32)), Buffer.from(name));
		});

		for (let i = 0; i < 10; ++i) {
			const w = await F.impersonateWallet(toHex(randomBytes(20)));
			await F.confirm(
				C.connect(w).setName(toHex(randomBytes(randomInt(1, 100))))
			);
		}

		const { storageHash } = await ethGetProof(F.provider, C.target);

		expect(storage.storageHash).toStrictEqual(storageHash);
	});
});
