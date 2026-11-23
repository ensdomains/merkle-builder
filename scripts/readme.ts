// update the README demo list (name counts and dates) from scripts/data/*.sqlite
// chains without a local database are left unchanged
// usage: bun run readme
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { createPublicClient, http } from "viem";
import * as chains from "viem/chains";
import { type ChainInfo, determineChain } from "./chains.js";
import { getDatabasePath, getRegistrar } from "./ens-registrar.js";

// "* ✅️ [`op`](...) &rarr; `125` names as of `2026-05-31`"
// note: the README uses non-breaking spaces around &rarr;
const LINE = /^(\s*\* \S+ \[`(\w+)`\]\([^)]*\)\s&rarr;\s)`([\d,]+)` names as of `([\d-]+)`/gm;

const file = Bun.file(`${import.meta.dir}/../README.md`);
const readme = await file.text();

const updates = new Map<string, { count: number; date?: string }>();
for (const [, , key] of readme.matchAll(LINE)) {
	const info = determineChain(key);
	const path = getDatabasePath(info);
	if (!existsSync(path)) {
		console.log(`${key}: skipped (no database)`);
		continue;
	}
	const db = new Database(path, { readonly: true });
	const state = Object.fromEntries(
		db
			.query<{ key: string; value: string }, []>("SELECT * FROM state")
			.all()
			.map((x) => [x.key, x.value]),
	);
	const block0 = Number(state.block0 ?? getRegistrar(info).createdAtBlock);
	const count =
		db
			.query<{ n: number }, [number]>("SELECT count(*) AS n FROM names WHERE block < ?")
			.get(block0)?.n ?? 0;
	db.close();
	// timestamp of the last synced block (saved by scripts/demo.ts), otherwise ask a public rpc
	const last = block0 - 1;
	const timestamp =
		Number(state.timestampBlock) === last // state values are numeric (STRING column affinity)
			? Number(state.timestamp)
			: await fetchTimestamp(info, last);
	const date = timestamp ? new Date(timestamp * 1000).toISOString().slice(0, 10) : undefined;
	updates.set(key, { count, date });
	console.log(`${key}: ${count.toLocaleString("en-US")} names as of ${date ?? "(unknown date)"}`);
}

const next = readme.replace(LINE, (line, prefix, key, _count, oldDate) => {
	const update = updates.get(key);
	if (!update) return line;
	return `${prefix}\`${update.count.toLocaleString("en-US")}\` names as of \`${update.date ?? oldDate}\``;
});
if (next !== readme) {
	await Bun.write(file, next);
	console.log("README updated");
} else {
	console.log("README unchanged");
}

async function fetchTimestamp(info: ChainInfo, blockNumber: number) {
	const chain = Object.values(chains).find((x) => "id" in x && x.id === info.id);
	const rpc = info.publicRPC ?? chain?.rpcUrls.default.http[0];
	if (!rpc) return;
	try {
		const client = createPublicClient({ transport: http(rpc) });
		const block = await client.getBlock({ blockNumber: BigInt(blockNumber) });
		return Number(block.timestamp);
	} catch (err) {
		console.log(`${info.key}: timestamp lookup failed (${rpc}): ${err}`);
		return;
	}
}
