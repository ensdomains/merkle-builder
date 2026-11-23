// benchmark: replay synthetic primary names into a row-backed trie (RowStorage) or EthStorage
// usage: bun run bench:rows --store map|sqlite|eth [--names 1900000] [--batch 10000]
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import keccak256 from "@adraffy/keccak/256";
import { toHex } from "viem";
import { EthStorage } from "../src/eth.js";
import { RowStorage, type TrieRow } from "../src/rows.js";
import { getPrimarySlot } from "./ens-registrar.js";

const args = parseArgs({
	options: {
		store: { type: "string", short: "s", default: "map" },
		names: { type: "string", short: "n", default: "1900000" },
		batch: { type: "string", short: "b", default: "10000" },
	},
	strict: true,
});

const store = args.values.store;
const total = Number(args.values.names);
const batchSize = Number(args.values.batch);

// deterministic synthetic events: 90% new addresses, 10% renames (shrink/grow), 5% long names (> 31 bytes)
let seed = 0x9e3779b9;
function rand() {
	seed ^= seed << 13;
	seed ^= seed >>> 17;
	seed ^= seed << 5;
	return (seed >>> 0) / 0x100000000;
}
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
function randomName() {
	const n = rand() < 0.05 ? 32 + Math.floor(rand() * 48) : 3 + Math.floor(rand() * 16);
	let s = "";
	for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
	return Buffer.from(`${s}.eth`);
}
let addrs = 0;
function nextEvent(): [slot: Uint8Array, name: Uint8Array] {
	const id = addrs && rand() < 0.1 ? Math.floor(rand() * addrs) : addrs++;
	const addr = keccak256(Uint8Array.of(id >> 24, id >> 16, id >> 8, id)).subarray(0, 20);
	return [getPrimarySlot(toHex(addr)), randomName()];
}

type Backend = {
	storage: EthStorage | RowStorage;
	commit(): string; // storage hash
	rowCount(): number;
	close?(): void;
};

function rowBytes(node: string) {
	return Buffer.from(node.slice(2), "hex");
}

function mapBackend(): Backend {
	const rows = new Map<string, Uint8Array>();
	const storage = new RowStorage((path) => rows.get(path));
	return {
		storage,
		commit() {
			const changes = storage.commit();
			for (const { path, node } of changes.rows) {
				if (node) rows.set(path, rowBytes(node));
				else rows.delete(path);
			}
			rowsWritten += changes.rows.length;
			return changes.storageHash;
		},
		rowCount: () => rows.size,
	};
}

function sqliteBackend(): Backend {
	const file = join(tmpdir(), "merkle-builder-rows-bench.sqlite");
	for (const ext of ["", "-wal", "-shm"]) rmSync(file + ext, { force: true });
	const db = new Database(file);
	db.run("PRAGMA journal_mode = WAL");
	db.run("PRAGMA synchronous = NORMAL");
	db.run("CREATE TABLE rows (path TEXT PRIMARY KEY, node BLOB NOT NULL) WITHOUT ROWID");
	const select = db.prepare<{ node: Uint8Array }, [string]>("SELECT node FROM rows WHERE path = ?");
	const upsert = db.prepare<void, [string, Uint8Array]>("INSERT OR REPLACE INTO rows (path, node) VALUES (?, ?)");
	const remove = db.prepare<void, [string]>("DELETE FROM rows WHERE path = ?");
	const apply = db.transaction((rows: TrieRow[]) => {
		for (const { path, node } of rows) {
			if (node) upsert.run(path, rowBytes(node));
			else remove.run(path);
		}
	});
	const storage = new RowStorage((path) => select.get(path)?.node);
	console.log(`Database: ${file}`);
	return {
		storage,
		commit() {
			const changes = storage.commit();
			apply(changes.rows);
			rowsWritten += changes.rows.length;
			return changes.storageHash;
		},
		rowCount: () => db.query<{ n: number }, []>("SELECT count(*) AS n FROM rows").get()!.n,
		close: () => db.close(),
	};
}

function ethBackend(): Backend {
	const storage = new EthStorage();
	return {
		storage,
		commit: () => storage.storageHash,
		rowCount: () => NaN,
	};
}

let rowsWritten = 0;
const backend = store === "map" ? mapBackend() : store === "sqlite" ? sqliteBackend() : store === "eth" ? ethBackend() : undefined;
if (!backend) throw new Error(`unknown store: ${store}`);

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

console.log(`Store: ${store}, Names: ${fmt(total)}, Batch: ${fmt(batchSize)}`);
let peak = process.memoryUsage().rss;
let storageHash = "";
const t0 = performance.now();
for (let done = 0; done < total; ) {
	const n = Math.min(batchSize, total - done);
	for (let i = 0; i < n; i++) {
		const [slot, name] = nextEvent();
		backend.storage.setBytes(slot, name);
	}
	storageHash = backend.commit();
	done += n;
	peak = Math.max(peak, process.memoryUsage().rss);
	if (done % (batchSize * 20) === 0 || done === total) {
		const secs = (performance.now() - t0) / 1000;
		process.stdout.write(`\r${fmt(done)} names, ${fmt(done / secs)}/s, rss ${mb(process.memoryUsage().rss)}   `);
	}
}
const secs = (performance.now() - t0) / 1000;
console.log();
console.log(`StorageHash: ${storageHash}`);
console.log(`Time: ${secs.toFixed(1)}s (${fmt(total / secs)} names/s)`);
if (store !== "eth") {
	console.log(`Rows: ${fmt(backend.rowCount())} (${fmt(rowsWritten)} written, ${fmt(rowsWritten / secs)}/s)`);
}
console.log(`Peak RSS: ${mb(Math.max(peak, process.resourceUsage().maxRSS * 1024))}`);
Bun.gc(true);
console.log(`RSS after GC: ${mb(process.memoryUsage().rss)}`);
backend.close?.();
