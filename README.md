# merkle-builder

[![CI](https://github.com/ensdomains/merkle-builder/actions/workflows/main.yml/badge.svg)](https://github.com/ensdomains/merkle-builder/actions/workflows/main.yml)
[![npm](https://img.shields.io/npm/v/@ensdomains/merkle-builder)](https://www.npmjs.com/package/@ensdomains/merkle-builder)

* Rebuild a contract's storage trie from events and serve storage proofs without an archive node
* [`EthStorage`](./src/eth.ts) &mdash; Ethereum Merkle-Patricia trie (keccak) in memory, matches `eth_getProof`
	* For small tries and experiments: copy-on-write (free snapshots), branch nodes hash once, JSON (`toJSON` / `fromJSON`)
* [`EthRowStorage`](./src/rows.ts) &mdash; the same trie as rows in a database, for large tries: reads only the nodes along touched paths and writes back only the nodes that changed
* [`LineaStorage`](./src/linea.ts) &mdash; Linea sparse Merkle trie ([Poseidon2](./src/poseidon2.ts) over KoalaBear), matches `linea_getProof`
* All extend [`SlotStorage`](./src/storage.ts) (`getStorage` / `setStorage`), which provides the Solidity layout (`setBytes` / `getBytes`)
* Low-level node functions (`insertLeaf`, `getProof`, `encodeNode`, ...) are in the [`trie`](./src/trie.ts) namespace

```ts
import { EthStorage, LineaStorage, followSlot } from "@ensdomains/merkle-builder";

const eth = new EthStorage();
eth.setBytes(followSlot(0n, addr32), name);
eth.storageHash; // eth_getProof().storageHash
eth.getProof(slot); // eth_getProof().storageProof[i]
eth.node; // immutable root node (snapshot)

const linea = new LineaStorage();
linea.setBytes(followSlot(0n, addr32), name); // buffered
linea.commit(); // once per block: new slots are placed in hkey order
linea.storageRoot; // storageRoot of the account leaf
linea.getProof(slot); // linea_getProof().storageProofs[i]
```

#### Linea notes

* Leaves are placed in insertion order (never reused), so the trie depends on history: replay writes in block order and `commit()` after each block
* `LineaStorage.restore(nextFreeIndex, entries)` / `entries()` persist and restore state (or bootstrap from `linea_getProof` leaf indices)
* Linea switched from MiMC to Poseidon2 on 2026-04-01 (Beta v5.2); the MiMC trie is not supported
* Only `storageProofs` can be reproduced locally (`accountProof` depends on the global account trie)

#### Row storage

A trie as rows, so memory doesn't grow with the trie (eg. a SQLite table keyed by `path`):

* `path` &mdash; the node's absolute nibble path from the root, as lowercase hex (`""` is the root)
* `node` &mdash; [`encodeNode(node)`](./src/trie.ts) (RLP), or `null` when the node at that path was removed
* Every node has a row, including nodes < 32 bytes that are embedded in their parent's encoding (the same nodes as `getProof()`), so a slot's proof is the rows along its key path
* The empty trie has no rows (storage hash is `keccak256(0x80)`)

```ts
import { EthRowStorage, getProofFromRows, trieRows } from "@ensdomains/merkle-builder";

const rows = new Map<string, Uint8Array>(); // or SELECT node FROM rows WHERE path = ?
const read = (path: string) => rows.get(path); // synchronous

const storage = new EthRowStorage(read);
storage.setBytes(followSlot(0n, addr32), name); // buffered: reads see pending writes
const { rows: changed, storageHash } = storage.commit(); // only the rows that changed
for (const { path, node } of changed) {
	if (node) rows.set(path, hexToBytes(node));
	else rows.delete(path);
}

getProofFromRows(read, slot); // { proof, value }: eth_getProof().storageProof[i] without a trie
trieRows(eth.node); // every row of an in-memory trie (eg. to migrate an EthStorage)
```

* Nodes are read on demand and cached (along with the writes) until `commit()` or `rollback()`: persist the rows before the next read
* `commit()` hashes only the changed nodes and returns new and updated rows, plus `null` for removed paths
* `bun run bench:rows -s map|sqlite|eth` &mdash; replay ~1.9M synthetic names (the size of Base):

| store | names/s | rows written/s | peak RSS |
| --- | --: | --: | --: |
| `eth` &mdash; `EthStorage` (in memory) | 16,749 | | 2,473 MB |
| `map` &mdash; `EthRowStorage` + `Map` | 21,137 | 75,814 | 2,999 MB |
| `sqlite` &mdash; `EthRowStorage` + `bun:sqlite` (WAL) | 14,592 | 52,337 | 344 MB (69 MB after GC) |

<sub>10,000 names per commit, 2,665,120 rows, same storage hash; the `map` store holds every row in memory</sub>

#### Not supported

* ZKsync &mdash; all accounts share one global Blake2s tree with no per-contract storage root, so a contract's storage can't be reproduced from its own events ([`zks_getProof`](https://docs.zksync.io/zksync-protocol/api/zks-rpc) proofs fold to the batch root, and leaf indices are global)

---

### Setup

1. `foundryup`
1. `forge i`
1. `bun i`

### Test

* `bun test`
* `bun run check` &mdash; type check (`tsc`)
* `bun run lint` &mdash; [Biome](https://biomejs.dev) lint + import order
* `bun run lint:fix` &mdash; apply Biome fixes
* `bun run fuzz` &mdash; run [`storage.test.ts`](./test/storage.test.ts) until it fails

### Build

* `bun run build`

### Demo

* Replicate `eth_getProof` for [`L2ReverseRegistrar`](https://github.com/ensdomains/ens-contracts/blob/staging/contracts/reverseRegistrar/L2ReverseRegistrar.sol) (requires [`.env`](./.env.sample) for provider, or `RPC_URL=<rpc with eth_getProof>`)
    * `bun run demo -c <chain>` &mdash; syncs events into `scripts/data/<chain>.sqlite` and keeps the trie there as rows (`EthRowStorage`), so a restart only applies new events
        * ✅️ [`op`](https://optimistic.etherscan.io/address/0x0000000000D8e504002cC26E3Ec46D81971C1664) &rarr; `169` names as of `2026-11-22`
        * ✅️ [`base`](https://basescan.org/address/0x0000000000D8e504002cC26E3Ec46D81971C1664) &rarr; `1,899,502` names as of `2026-01-28`
        * ✅️ [`arb`](https://arbiscan.io/address/0x0000000000D8e504002cC26E3Ec46D81971C1664) &rarr; `272` names as of `2026-11-22`
        * ✅️ [`linea`](https://lineascan.build/address/0x0000000000D8e504002cC26E3Ec46D81971C1664) &rarr; `111` names as of `2026-11-22`
    * `--rebuild` rebuilds the rows from the synced names (also done automatically on first run) &bull; `--noSync` skips syncing
* Update the name counts and dates above from `scripts/data/*.sqlite`
    * `bun run readme`
* Replay the same events into `LineaStorage` and match `linea_getProof` (run `bun run demo -c linea` first to sync)
    * `bun run demo:linea`
* Replay ~1.9M synthetic names into `EthRowStorage` (`Map` or SQLite rows) or `EthStorage`
    * `bun run bench:rows -s map|sqlite|eth`
