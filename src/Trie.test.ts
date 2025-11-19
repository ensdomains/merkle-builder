import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Foundry } from "@adraffy/blocksmith";
import { hexlify, randomBytes } from "ethers";
import {
	type MaybeNode,
	insertNode,
	toNibblePath,
	encodeNodeHash,
	H,
} from "./Trie.js";

describe("Trie", () => {
	let F: Foundry;
	beforeAll(async () => {
		F = await Foundry.launch({ infoLog: false });
		afterAll(F.shutdown);
	});

	for (let i = 0; i < 20; i++) {
		const storage = Array.from({ length: rngInt(10) }, (_, i) => [
			BigInt(i),
			BigInt(hexlify(randomBytes(rngInt(1, 32)))),
		]);
		test(`${i} x ${storage.length}`, async () => {
			const contract = await F.deploy(`contract X {
				constructor() {
					assembly {
						${storage.map(([k, v]) => `sstore(${k}, ${v})`).join("\n")}
					}
				}	
			}`);
			const { storageHash }: { storageHash: string } =
				await F.provider.send("eth_getProof", [
					contract.target,
					[],
					"latest",
				]);

			let node: MaybeNode;
			for (const [k, x] of storage) {
				node = insertNode(
					node,
					toNibblePath(H(toBytes(k, 32))),
					toBytes(x)
				);
			}
			expect(hexlify(encodeNodeHash(node))).toStrictEqual(storageHash);
		});
	}
});

function toBytes(i: bigint, n?: number): Uint8Array {
	const s = i.toString(16);
	n ??= (s.length + 1) >> 1;
	return Buffer.from(s.padStart(n << 1, "0"), "hex");
}

function rngInt(minOrMax: number, max?: number) {
	if (max === undefined) {
		max = minOrMax;
		minOrMax = 0;
	}
	return minOrMax + Math.random() * (max - minOrMax);
}
