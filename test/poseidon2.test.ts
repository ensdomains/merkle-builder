import { afterAll, describe, expect, test } from "bun:test";
import { Foundry } from "@adraffy/blocksmith";
import { concat, toHex } from "viem";
import { poseidon2, poseidon2Pad } from "../src/poseidon2.js";
import { toBytes } from "../src/utils.js";
import VECTORS from "./fixtures/poseidon2-vectors.json" with { type: "json" };
import { randomBytes } from "./utils.js";

describe("poseidon2", async () => {
	test("vectors", () => {
		for (const { in: x, out } of VECTORS) {
			expect(toHex(poseidon2(toBytes(x)))).toBe(out as any);
		}
	});

	test("pad", () => {
		expect(toHex(poseidon2Pad(toBytes("0xAAAABBBB", 32)))).toBe(
			`0x${"0".repeat(112)}0000aaaa0000bbbb`,
		);
	});

	test("invalid length", () => {
		expect(() => poseidon2(new Uint8Array(0))).toThrow();
		expect(() => poseidon2(new Uint8Array(31))).toThrow();
	});

	const F = await Foundry.launch({ infoLog: false });
	afterAll(F.shutdown);
	const Poseidon2 = await F.deploy({ file: "Poseidon2" });

	for (let blocks = 1; blocks <= 6; ++blocks) {
		test(`solidity: ${blocks} blocks`, async () => {
			for (let i = 0; i < 5; i++) {
				// include limbs >= p
				const m = concat([
					...Array.from({ length: blocks }, () =>
						i ? randomBytes(32) : new Uint8Array(32).fill(255),
					),
				]);
				expect(toHex(poseidon2(m))).toBe(await Poseidon2.hash(m));
			}
		});
	}

	test("solidity: pad", async () => {
		const x = randomBytes(32);
		expect(toHex(poseidon2Pad(x))).toBe(await Poseidon2.padBytes32(x));
	});
});
