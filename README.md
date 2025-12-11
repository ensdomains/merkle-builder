# merkle-builder

* Low-level Merkle-Patricia storage trie implementation
* Matches Ethereum RPC and Foundry results
* Memory efficient (copy-on-write, shared subexpressions)
* Compute efficient (branch nodes hash once)

### Setup

1. `foundryup`
1. `forge i`
1. `bun i`

### Test

* `bun test`
* `bun run fuzz` &mdash; run [`storage.test.ts`](./test/storage.test.ts) until cancelled

### Demo

Replicate `eth_getProof` for [`L2ReverseRegistrar`](https://github.com/ensdomains/ens-contracts/blob/staging/contracts/reverseRegistrar/L2ReverseRegistrar.sol) (requires [`.env`](./.env.sample) for provider)


* `bun demo/app.ts -c op` &rarr; [Optimism](https://optimistic.etherscan.io/address/0x0000000000D8e504002cC26E3Ec46D81971C1664)
    * ✅️ `78` names as of `2025-12-10`
* `bun demo/app.ts -c base` &rarr; [Base](https://basescan.org/address/0x0000000000D8e504002cC26E3Ec46D81971C1664)
    * ✅️ `975771` names as of `2025-12-10`
