import { describe, expect, test } from "bun:test";
import { Coder, MAX_LENGTH } from "../src/coder.js";
import { randomTrie } from "./utils.js";

describe("coder", () => {
	for (let i = 0; i < 50; i++) {
		test(`#${i}`, () => {
			const coder = new Coder();
			const { node } = randomTrie();
			coder.writeNode(node);
			coder.pos = 0;
			expect(coder.readNode()).toStrictEqual(node);
		});
	}

	test('MAX_LENGTH', () => {
		const coder = new Coder();
		for (let i = 0; i <= MAX_LENGTH; ++i) {
			coder.pos = 0;
			coder.writeLength(i);
			coder.pos = 0;
			expect(coder.readLength()).toStrictEqual(i);
		}
	});
});
