// replay L2ReverseRegistrar events into LineaStorage and compare with linea_getProof
// run `bun demo/app.ts -c linea` first to sync names
import { Database } from "bun:sqlite";
import { createPublicClient, http, numberToHex, toHex } from "viem";
import { LineaStorage, type LineaStorageProof } from "../src/linea.js";
import { toBytes } from "../src/utils.js";
import {
	determineChain,
	determineProvider,
	getPrimarySlot,
	getRegistrarAddress,
	KNOWN_ADDRS,
} from "./registrar.js";

const chainInfo = determineChain("linea");
const registrarAddress = getRegistrarAddress(chainInfo.testnet);

const db = new Database(`${import.meta.dir}/${chainInfo.name}.sqlite`, {
	readonly: true,
});
const block0 = Number(
	db.query<{ value: string }, []>("SELECT value FROM state WHERE key = 'block0'").get()?.value ??
		chainInfo.createdAtBlock,
);
const blockNumber = block0 - 1; // last synced block

console.time("replay");
const storage = new LineaStorage();
let block = -1;
let blocks = 0;
for (const row of db
	.query<{ block: number; addr: Uint8Array; name: Uint8Array }, [number]>(
		"SELECT * FROM names WHERE block <= ? ORDER BY rowid",
	)
	.iterate(blockNumber)) {
	if (row.block !== block) {
		storage.commit(); // one commit per block
		block = row.block;
		blocks++;
	}
	storage.setBytes(getPrimarySlot(toHex(row.addr)), row.name);
}
storage.commit();
console.timeEnd("replay");
console.log(`Blocks: ${blocks} (through ${blockNumber})`);
console.log(`Leaves: ${storage.size} (nextFreeIndex = ${storage.nextFreeIndex})`);
console.log(`StorageRoot: ${storage.storageRoot}`);

const client = createPublicClient({ transport: http(determineProvider(chainInfo)) });

const slots = KNOWN_ADDRS.map(getPrimarySlot);
const real = await client.request<{
	Method: "linea_getProof";
	Parameters: [string, string[], string];
	ReturnType: {
		accountProof: { proof: { value: string } };
		storageProofs: LineaStorageProof[];
	};
}>({
	method: "linea_getProof",
	params: [registrarAddress, slots.map((x) => toHex(x)), numberToHex(blockNumber)],
});

// account value = nonce | balance | storageRoot | ...
const realRoot = toHex(toBytes(real.accountProof.proof.value).subarray(64, 96));
console.log(`StorageRoot Match: ${realRoot === storage.storageRoot}`);
slots.forEach((slot, i) => {
	const fake = storage.getProof(slot);
	console.log(
		`linea_getProof(${toHex(slot)}) Match:`,
		JSON.stringify(fake) === JSON.stringify(real.storageProofs[i]),
		"proof" in fake ? `(leaf #${fake.leafIndex})` : "(absent)",
	);
});
