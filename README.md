# merkle-builder

[![CI](https://github.com/ensdomains/merkle-builder/actions/workflows/main.yml/badge.svg)](https://github.com/ensdomains/merkle-builder/actions/workflows/main.yml)
[![npm](https://img.shields.io/npm/v/@ensdomains/merkle-builder)](https://www.npmjs.com/package/@ensdomains/merkle-builder)

* Rebuild a contract's storage trie from events and serve storage proofs without an archive node
* [`EthStorage`](./src/eth.ts) &mdash; Ethereum Merkle-Patricia trie (keccak), matches `eth_getProof`
	* Memory efficient (copy-on-write, shared subexpressions)
	* Compute efficient (branch nodes hash once)
	* Multiple storage encodings (object, [bytes](./src/coder.ts), [JSON](./src/json.ts)) and [surgery](./src/surgery.ts) (trunk + limbs)
* [`LineaStorage`](./src/linea.ts) &mdash; Linea sparse Merkle trie ([Poseidon2](./src/poseidon2.ts) over KoalaBear), matches `linea_getProof`
* Both extend [`SlotStorage`](./src/storage.ts) (`getStorage` / `setStorage`), which provides the Solidity layout (`setBytes` / `getBytes`)

```ts
import { EthStorage, LineaStorage, followSlot } from "@ensdomains/merkle-builder";

const eth = new EthStorage();
eth.setBytes(followSlot(0n, addr32), name);
eth.storageHash; // eth_getProof().storageHash
eth.getProof(slot); // eth_getProof().storageProof[i]

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

#### Roadmap

* ZKSync
    * ☐ `Blake2S`
    * ☐ `ZKSyncSMT`
    * ☐ [`zks_getProof`](https://docs.zksync.io/zksync-protocol/api/zks-rpc)

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
    * `bun run demo -c <chain>` (`--readme` updates the line below with the name count and date)
        * ✅️ [`op`](https://optimistic.etherscan.io/address/0x0000000000D8e504002cC26E3Ec46D81971C1664) &rarr; `125` names as of `2025-05-31`
        * ✅️ [`base`](https://basescan.org/address/0x0000000000D8e504002cC26E3Ec46D81971C1664) &rarr; `1,846,927` names as of `2026-05-31`
        * ✅️ [`arb`](https://arbiscan.io/address/0x0000000000D8e504002cC26E3Ec46D81971C1664) &rarr; `190` names as of `2026-05-31`
        * ✅️ [`linea`](https://lineascan.build/address/0x0000000000D8e504002cC26E3Ec46D81971C1664) &rarr; `95` names as of `2026-05-31`
        * ✅️ [`scroll`](https://scrollscan.com/address/0x0000000000D8e504002cC26E3Ec46D81971C1664) &rarr; `57` names as of `2026-05-31`
* Replay the same events into `LineaStorage` and match `linea_getProof` (run `bun run demo -c linea` first to sync)
    * `bun run demo:linea`
* Deserialize from *trunk* and *limb* with precomputed hashes, perform surgery, and produce correct `eth_getProof`
    * `bun run demo:memory -c <chain> -d <depth>`
