import { describe, expect, test } from "bun:test";
import { Coder, MAX_SIZE } from "../src/coder.js";
import { randomTrie } from "./utils.js";

describe("coder", () => {
	for (let i = 0; i < 50; i++) {
		test(`#${i}`, () => {
			const coder = new Coder();
			const { node } = randomTrie();
			coder.writeNode(node);
			coder.reset();
			expect(coder.readNode()).toStrictEqual(node);
		});
	}

	test("MAX_SIZE", () => {
		const coder = new Coder();
		for (let i = 0; i <= MAX_SIZE; ++i) {
			coder.reset();
			coder.writeSize(i);
			coder.reset();
			expect(coder.readSize()).toStrictEqual(i);
		}
	});

	test("remaining", () => {
		const coder = new Coder(new Uint8Array(2));
		expect(coder.remaining).toStrictEqual(2);
		coder.readByte();
		expect(coder.remaining).toStrictEqual(1);
		coder.pos = 10;
		expect(coder.remaining).toStrictEqual(0);
	});
});
