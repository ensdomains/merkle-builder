# merkle-builder

* Low-level Merkle-Patricia storage trie implementation
* Matches [Ethereum](https://ethereum.org/developers/docs/apis/json-rpc/) and [Foundry](https://getfoundry.sh/) results
* Memory efficient (copy-on-write, shared subexpressions)
* Compute efficient (branch nodes hash once)
* Multiple storage encodings (object, [bytes](./src/coder.ts), [JSON](./src/json.ts))

`npm i @ensdomains/merkle-builder` [&check;](https://www.npmjs.com/package/@ensdomains/merkle-builder)

#### Roadmap

* Linea
    * ☑︎ [`MIMC`](./src/mimc.ts)
    * ☐ [`SparseMerkleProof`](https://github.com/Consensys/linea-ens/blob/main/packages/linea-state-verifier/contracts/lib/SparseMerkleProof.sol)
    * ☐ [`linea_getProof`](https://docs.linea.build/api/reference/linea-getproof)
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
* `bun run fuzz` &mdash; run [`storage.test.ts`](./test/storage.test.ts) until cancelled

### Demo

* Replicate `eth_getProof` for [`L2ReverseRegistrar`](https://github.com/ensdomains/ens-contracts/blob/staging/contracts/reverseRegistrar/L2ReverseRegistrar.sol) (requires [`.env`](./.env.sample) for provider)
    * `bun demo/app.ts -c <chain>`
        * ✅️ [`op`](https://optimistic.etherscan.io/address/0x0000000000D8e504002cC26E3Ec46D81971C1664) &rarr; `95` names as of `2026-01-25`
        * ✅️ [`base`](https://basescan.org/address/0x0000000000D8e504002cC26E3Ec46D81971C1664) &rarr; `1,846,927` names as of `2026-01-25`
        * ✅️ [`arb`](https://arbiscan.io/address/0x0000000000D8e504002cC26E3Ec46D81971C1664) &rarr; `151` names as of `2026-01-25`
        * ✅️ [`linea`](https://lineascan.build/address/0x0000000000D8e504002cC26E3Ec46D81971C1664) &rarr; `77` names as of `2026-01-25`
        * ✅️ [`scroll`](https://scrollscan.com/address/0x0000000000D8e504002cC26E3Ec46D81971C1664) &rarr; `49` names as of `2026-01-25`
* Deserialize from *trunk* and *limb* with precomputed hashes, perform surgery, and produce correct `eth_getProof`
    * `bun demo/memory.ts -c <chain> -d <depth>`
