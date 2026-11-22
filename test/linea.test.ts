import { describe, expect, test } from "bun:test";
import { toHex } from "viem";
import {
	LineaStorage,
	type LineaStorageProof,
	lineaHashKey,
	verifyLineaProof,
} from "../src/linea.js";
import { followSlot, toBytes } from "../src/utils.js";
import FIXTURE from "./fixtures/linea-proof.json" with { type: "json" };
import { randomBytes, randomInt } from "./utils.js";

function verifyAll(s: LineaStorage, p: LineaStorageProof) {
	const root = s.rootHash;
	if ("proof" in p) {
		expect(verifyLineaProof(p.proof, p.leafIndex, root)).toBeTrue();
	} else {
		expect(verifyLineaProof(p.leftProof, p.leftLeafIndex, root)).toBeTrue();
		expect(verifyLineaProof(p.rightProof, p.rightLeafIndex, root)).toBeTrue();
	}
}

describe("linea", () => {
	test("fixture: storage proof", () => {
		const s = new LineaStorage();
		for (const { key, proof } of FIXTURE.storageProofs) {
			s.setStorage(toBytes(key), toBytes(proof.value));
		}
		s.commit();
		for (const expected of FIXTURE.storageProofs) {
			expect(s.getProof(toBytes(expected.key))).toStrictEqual(expected as any);
		}
		// account value = nonce | balance | storageRoot | ...
		const account = toBytes(FIXTURE.accountProof.proof.value);
		expect(s.storageRoot).toBe(toHex(account.subarray(64, 96)));
	});

	test("empty", () => {
		const s = new LineaStorage();
		expect(s.size).toBe(0);
		expect(s.nextFreeIndex).toBe(2);
		const p = s.getProof(new Uint8Array(32));
		expect(p).toMatchObject({ leftLeafIndex: 0, rightLeafIndex: 1 });
		verifyAll(s, p);
	});

	test("uncommitted", () => {
		const s = new LineaStorage();
		s.setStorage(new Uint8Array(32), Uint8Array.of(1));
		expect(s.getStorage(new Uint8Array(32))).toStrictEqual(Uint8Array.of(1));
		expect(() => s.rootHash).toThrow("uncommitted");
		s.rollback();
		expect(s.getStorage(new Uint8Array(32))).toStrictEqual(new Uint8Array(0));
	});

	test("block order is by hkey, not write order", () => {
		const slots = Array.from({ length: 10 }, () => randomBytes(32));
		const a = new LineaStorage();
		const b = new LineaStorage();
		for (const x of slots) a.setStorage(x, Uint8Array.of(1));
		for (const x of slots.toReversed()) b.setStorage(x, Uint8Array.of(1));
		a.commit();
		b.commit();
		expect(a.rootHash).toStrictEqual(b.rootHash);
		const byHkey = slots.toSorted((x, y) =>
			toHex(lineaHashKey(x)) < toHex(lineaHashKey(y)) ? -1 : 1,
		);
		expect(byHkey.map((x) => a.getLeafIndex(x))).toStrictEqual(
			byHkey.map((_, i) => 2 + i),
		);
		// separate blocks => insertion order
		const c = new LineaStorage();
		for (const x of slots) {
			c.setStorage(x, Uint8Array.of(1));
			c.commit();
		}
		expect(slots.map((x) => c.getLeafIndex(x))).toStrictEqual(
			slots.map((_, i) => 2 + i),
		);
	});

	test("delete never reuses indices", () => {
		const s = new LineaStorage();
		const x = randomBytes(32);
		s.setStorage(x, Uint8Array.of(1));
		s.commit();
		expect(s.getLeafIndex(x)).toBe(2);
		s.setStorage(x, new Uint8Array(0));
		s.commit();
		expect(s.getLeafIndex(x)).toBeUndefined();
		expect(s.nextFreeIndex).toBe(3);
		s.setStorage(x, Uint8Array.of(2));
		s.commit();
		expect(s.getLeafIndex(x)).toBe(3);
	});

	test("set + clear in one block is a no-op", () => {
		const s = new LineaStorage();
		const root = s.rootHash;
		s.setStorage(randomBytes(32), Uint8Array.of(1));
		s.setStorage(randomBytes(32), Uint8Array.of(0));
		const x = randomBytes(32);
		s.setStorage(x, Uint8Array.of(1));
		s.setStorage(x, Uint8Array.of());
		s.rollback();
		s.commit();
		expect(s.rootHash).toStrictEqual(root);
	});

	for (let i = 0; i < 10; i++) {
		test(`fuzz #${i}: proofs, restore`, () => {
			const s = new LineaStorage();
			const live = new Map<string, Uint8Array>();
			const known: Uint8Array[] = [];
			for (let block = 0; block < 20; block++) {
				for (let n = randomInt(1, 8); n; n--) {
					const slot =
						known.length && Math.random() < 0.4
							? known[randomInt(known.length)]
							: randomBytes(32);
					known.push(slot);
					const value = Math.random() < 0.2 ? new Uint8Array(0) : randomBytes(randomInt(1, 33));
					s.setStorage(slot, value);
				}
				s.commit();
			}
			for (const slot of known) live.set(toHex(slot), s.getStorage(slot));
			for (const slot of [...known.slice(0, 20), randomBytes(32)]) {
				const p = s.getProof(slot);
				verifyAll(s, p);
				expect("proof" in p).toBe(!!s.getStorage(slot).length);
			}
			const r = LineaStorage.restore(s.nextFreeIndex, s.entries());
			expect(r.rootHash).toStrictEqual(s.rootHash);
			expect(r.size).toBe(s.size);
		});
	}

	test("bytes layout", () => {
		const s = new LineaStorage();
		const slot = randomBytes(32);
		for (const len of [0, 5, 31, 32, 33, 100, 64, 10, 0]) {
			const v = randomBytes(len);
			s.setBytes(slot, v);
			expect(s.getBytes(slot)).toStrictEqual(v);
			s.commit();
			expect(s.getBytes(slot)).toStrictEqual(v);
		}
		expect(s.size).toBe(0); // everything cleared
	});
});

describe("linea mainnet", () => {
	test("L2ReverseRegistrar: replay events => linea_getProof", async () => {
		const F = (await import("./fixtures/linea-registrar.json", { with: { type: "json" } })).default;
		const s = new LineaStorage();
		let block = -1;
		for (const [b, addr, name] of F.names as [number, string, string][]) {
			if (b !== block) {
				s.commit(); // one commit per block
				block = b;
			}
			s.setBytes(followSlot(0n, toBytes(addr, 32)), toBytes(name));
		}
		s.commit();
		expect(s.storageRoot).toBe(F.storageRoot as any);
		expect(F.slots.map((x) => s.getProof(toBytes(x)))).toStrictEqual(
			F.storageProofs as any,
		);
		// byte-identical json
		expect(JSON.stringify(F.slots.map((x) => s.getProof(toBytes(x))))).toBe(
			JSON.stringify(F.storageProofs),
		);
	});
});
