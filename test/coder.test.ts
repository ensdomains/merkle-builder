import { describe, expect, test } from "bun:test";
import { Coder } from "../src/coder.js";
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
});
