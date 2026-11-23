import { describe, expect, test } from "bun:test";
import { keccak256, toHex } from "viem";
import { EthStorage, setPath } from "../src/eth.js";
import { getProofFromRows, getRowProof, RowStorage, type TrieRow, trieRows } from "../src/rows.js";
import { EMPTY_BYTES, findLeaf, getProof, getRootHash, type MaybeNode } from "../src/trie.js";
import { toBigInt, toBytes, trimLeadingZeros } from "../src/utils.js";
import { randomBytes, randomInt } from "./utils.js";

const EMPTY_HASH = keccak256(Uint8Array.of(0x80));

// Map-backed row store that checks every applied row is a real change
class Store {
	readonly rows = new Map<string, Uint8Array>();
	reads = 0;
	readonly get = (path: string) => {
		this.reads++;
		return this.rows.get(path);
	};
	apply(changes: TrieRow[]) {
		const paths = new Set(changes.map((x) => x.path));
		expect(paths.size).toBe(changes.length); // one row per path
		for (const { path, node } of changes) {
			const prev = this.rows.get(path);
			if (node === null) {
				expect(prev).toBeDefined(); // only existing rows are removed
				this.rows.delete(path);
			} else {
				if (prev) expect(toHex(prev)).not.toBe(node); // only changed rows
				this.rows.set(path, Buffer.from(node.slice(2), "hex"));
			}
		}
	}
	// path -> encoding
	snapshot() {
		return Object.fromEntries([...this.rows].map(([k, v]) => [k, toHex(v)]));
	}
}

function fullRows(node: MaybeNode) {
	return Object.fromEntries([...trieRows(node)].map((x) => [x.path, x.node]));
}

// random 64-nibble key, sharing a random-length prefix with a key from the pool
function clusteredKey(pool: Uint8Array[]): Uint8Array {
	const key = new Uint8Array(64);
	for (let i = 0; i < 64; i++) key[i] = randomInt(16);
	if (pool.length) {
		const other = pool[randomInt(pool.length)];
		const r = Math.random();
		const n = r < 0.3 ? randomInt(4) : r < 0.6 ? 56 + randomInt(8) : randomInt(64); // deep prefixes -> inline nodes
		key.set(other.subarray(0, n));
	}
	return key;
}

function randomValue(): Uint8Array {
	const r = Math.random();
	if (r < 0.2) return EMPTY_BYTES; // delete
	if (r < 0.5) return Uint8Array.of(1 + randomInt(127)); // tiny (inline)
	return randomBytes(1 + randomInt(32));
}

// path-level mirror of RowStorage and an in-memory trie
class PathMirror {
	readonly store = new Store();
	readonly storage = new RowStorage(this.store.get);
	node: MaybeNode;
	committed: MaybeNode; // copy-on-write snapshot
	set(key: Uint8Array, value: Uint8Array) {
		this.storage.setPath(key, value);
		this.node = setPath(this.node, key, value);
	}
	commit() {
		const { rows, storageHash } = this.storage.commit();
		expect(storageHash).toBe(toHex(getRootHash(this.node)));
		this.store.apply(rows);
		expect(this.store.snapshot()).toEqual(fullRows(this.node));
		expect(this.storage.cacheSize).toBe(0);
		this.committed = this.node;
		return rows;
	}
	rollback() {
		this.storage.rollback();
		this.node = this.committed;
	}
	expectProof(key: Uint8Array) {
		expect(getRowProof(this.store.get, key)).toEqual({
			proof: getProof(this.node, key).map((x) => toHex(x)),
			value: findLeaf(this.node, key)?.data ?? EMPTY_BYTES,
		});
	}
}

// slot-level mirror of RowStorage and EthStorage
class SlotMirror {
	readonly store = new Store();
	readonly rows = new RowStorage(this.store.get);
	readonly eth = new EthStorage();
	setStorage(slot: Uint8Array, value: Uint8Array) {
		this.rows.setStorage(slot, value);
		this.eth.setStorage(slot, value);
	}
	setBytes(slot: Uint8Array, value: Uint8Array) {
		this.rows.setBytes(slot, value);
		this.eth.setBytes(slot, value);
	}
	commit() {
		const { rows, storageHash } = this.rows.commit();
		expect(storageHash).toBe(this.eth.storageHash);
		this.store.apply(rows);
		expect(this.store.snapshot()).toEqual(fullRows(this.eth.node));
		return rows;
	}
	expectProof(slot: Uint8Array) {
		const expected = this.eth.getProof(slot);
		const { proof, value } = getProofFromRows(this.store.get, slot);
		expect(proof).toEqual(expected.proof);
		expect(toHex(toBigInt(value))).toBe(expected.value);
	}
}

describe("rows", () => {
	test("empty trie", () => {
		const m = new SlotMirror();
		expect(m.rows.storageHash).toBe(EMPTY_HASH);
		expect(m.commit()).toEqual([]);
		const slot = toBytes(0, 32);
		expect(m.rows.getStorage(slot)).toEqual(EMPTY_BYTES);
		expect(m.rows.getProof(slot)).toEqual(m.eth.getProof(slot));
		m.expectProof(slot);
	});

	test("single leaf, then delete the last leaf", () => {
		const m = new SlotMirror();
		const slot = toBytes(1, 32);
		m.setStorage(slot, toBytes(123));
		expect(m.commit()).toHaveLength(1);
		expect(m.store.rows.has("")).toBe(true);
		m.expectProof(slot);
		m.setStorage(slot, EMPTY_BYTES);
		expect(m.commit()).toEqual([{ path: "", node: null }]);
		expect(m.rows.storageHash).toBe(EMPTY_HASH);
		m.expectProof(slot);
	});

	test("reads see pending writes", () => {
		const m = new SlotMirror();
		const slot = toBytes(2, 32);
		m.setStorage(slot, toBytes(7));
		m.commit();
		m.setStorage(slot, toBytes(8));
		m.setBytes(toBytes(3, 32), randomBytes(100));
		expect(m.rows.getStorage(slot)).toEqual(toBytes(8));
		expect(m.rows.getBytes(toBytes(3, 32))).toEqual(m.eth.getBytes(toBytes(3, 32)));
		expect(m.rows.storageHash).toBe(m.eth.storageHash);
		expect(m.rows.getProof(slot)).toEqual(m.eth.getProof(slot));
		m.commit();
	});

	test("no-op writes produce no rows", () => {
		const m = new SlotMirror();
		for (let i = 0; i < 50; i++) m.setStorage(toBytes(i, 32), toBytes(i + 1));
		m.commit();
		m.setStorage(toBytes(5, 32), toBytes(6)); // same value
		m.setStorage(toBytes(99, 32), toBytes(1)); // insert then delete
		m.setStorage(toBytes(99, 32), EMPTY_BYTES);
		m.setStorage(toBytes(7, 32), toBytes(1)); // change then restore
		m.setStorage(toBytes(7, 32), toBytes(8));
		m.setStorage(toBytes(1000, 32), EMPTY_BYTES); // delete missing
		expect(m.rows.getStorage(toBytes(9, 32))).toEqual(toBytes(10));
		expect(m.commit()).toEqual([]);
	});

	test("rollback", () => {
		const m = new SlotMirror();
		m.setStorage(toBytes(1, 32), toBytes(1));
		m.commit();
		m.rows.setStorage(toBytes(1, 32), toBytes(2));
		m.rows.setStorage(toBytes(2, 32), toBytes(2));
		m.rows.rollback();
		expect(m.rows.cacheSize).toBe(0);
		expect(m.rows.getStorage(toBytes(1, 32))).toEqual(toBytes(1));
		expect(m.commit()).toEqual([]);
	});

	test("reads only touched paths, once per batch", () => {
		const m = new SlotMirror();
		for (let i = 0; i < 2000; i++) m.setStorage(toBytes(i, 32), toBytes(i + 1));
		m.commit();
		m.store.reads = 0;
		const slots = Array.from({ length: 10 }, (_, i) => toBytes(i, 32));
		for (const slot of slots) m.setStorage(slot, toBytes(77));
		for (const slot of slots) m.rows.getStorage(slot);
		expect(m.store.reads).toBe(m.rows.cacheSize); // each row read once
		expect(m.store.reads).toBeLessThan(10 * 5);
		const rows = m.commit();
		expect(rows.length).toBeLessThan(10 * 5);
		expect(rows.every((x) => x.node)).toBe(true); // overwrites remove nothing
	});

	test("long shared prefixes (extensions)", () => {
		const m = new PathMirror();
		const base = clusteredKey([]);
		const keys = [40, 50, 60, 45, 62, 30, 0].map((n) => {
			const key = clusteredKey([]);
			key.set(base.subarray(0, n));
			return key;
		});
		for (const key of keys) {
			m.set(key, randomBytes(20));
			m.commit();
		}
		// delete in another order: branches collapse, extensions merge
		for (const key of [keys[2], keys[0], keys[4], keys[6], keys[1], keys[3], keys[5]]) {
			m.set(key, EMPTY_BYTES);
			m.commit();
			for (const k of keys) m.expectProof(k);
		}
		expect(m.store.rows.size).toBe(0);
	});

	test("inline (< 32 byte) nodes", () => {
		const m = new PathMirror();
		const base = clusteredKey([]);
		const keys = Array.from({ length: 6 }, (_, i) => {
			const key = base.slice();
			key[63] = i;
			if (i >= 3) key[62] = (base[62] + 1) & 15;
			return key;
		});
		for (const key of keys) m.set(key, Uint8Array.of(1 + randomInt(100)));
		m.commit();
		const inline = [...m.store.rows].filter(([, v]) => v.length < 32);
		expect(inline.length).toBeGreaterThanOrEqual(6); // every leaf, plus small branches
		for (const key of keys) m.expectProof(key);
		for (const key of keys.slice(1)) {
			m.set(key, EMPTY_BYTES);
			m.commit();
			for (const k of keys) m.expectProof(k);
		}
		expect(m.store.rows.size).toBe(1);
	});

	test("fuzz: paths", () => {
		for (let run = 0; run < 10; run++) {
			const m = new PathMirror();
			const pool: Uint8Array[] = [];
			for (let batch = 0; batch < 30; batch++) {
				const ops = 1 + randomInt(40);
				for (let i = 0; i < ops; i++) {
					const key = pool.length && Math.random() < 0.4 ? pool[randomInt(pool.length)] : clusteredKey(pool);
					pool.push(key);
					m.set(key, randomValue());
				}
				if (Math.random() < 0.1) m.rollback();
				m.commit();
				for (let i = 0; i < 5; i++) m.expectProof(pool[randomInt(pool.length)]);
				m.expectProof(clusteredKey(pool)); // absent
			}
		}
	});

	test("fuzz: slots + bytes", () => {
		// slots whose keys share prefixes: neighbors in sorted key order
		const mined = Array.from({ length: 4096 }, () => randomBytes(32))
			.map((slot) => [slot, toHex(keccak256(slot))] as const)
			.sort((a, b) => a[1].localeCompare(b[1]))
			.map((x) => x[0]);
		for (let run = 0; run < 5; run++) {
			const m = new SlotMirror();
			const start = randomInt(mined.length - 64);
			const slots = [...mined.slice(start, start + 64), ...Array.from({ length: 32 }, () => randomBytes(32))];
			const bytesSlots = Array.from({ length: 8 }, () => randomBytes(32));
			for (let batch = 0; batch < 30; batch++) {
				const ops = 1 + randomInt(30);
				for (let i = 0; i < ops; i++) {
					if (Math.random() < 0.3) {
						const r = Math.random();
						const size = r < 0.3 ? randomInt(32) : r < 0.5 ? 0 : randomInt(300); // shrink and grow
						m.setBytes(bytesSlots[randomInt(bytesSlots.length)], randomBytes(size));
					} else {
						const r = Math.random();
						const value = r < 0.25 ? EMPTY_BYTES : trimLeadingZeros(randomBytes(1 + randomInt(32)));
						m.setStorage(slots[randomInt(slots.length)], value);
					}
				}
				// pending reads
				const slot = slots[randomInt(slots.length)];
				expect(m.rows.getStorage(slot)).toEqual(m.eth.getStorage(slot));
				expect(m.rows.getProof(slot)).toEqual(m.eth.getProof(slot));
				const bs = bytesSlots[randomInt(bytesSlots.length)];
				expect(m.rows.getBytes(bs)).toEqual(m.eth.getBytes(bs));
				m.commit();
				for (let i = 0; i < 5; i++) m.expectProof(slots[randomInt(slots.length)]);
				m.expectProof(bytesSlots[randomInt(bytesSlots.length)]);
				m.expectProof(randomBytes(32)); // absent
			}
		}
	});
});
