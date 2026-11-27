import { type Address, type Hex, parseAbi } from "viem";
import type { SlotStorage } from "../src/storage.js";
import { followSlot, toBytes } from "../src/utils.js";
import type { ChainInfo } from "./chains.js";

// https://docs.ens.domains/ensip/19/#annex-supported-chains
export function getRegistrarAddress(testnet?: boolean): Address {
	return testnet
		? "0x00000BeEF055f7934784D6d81b6BC86665630dbA"
		: "0x0000000000D8e504002cC26E3Ec46D81971C1664";
}

// https://github.com/ensdomains/ens-contracts/blob/staging/contracts/reverseRegistrar/StandaloneReverseRegistrar.sol
// https://github.com/ensdomains/ens-contracts/blob/staging/contracts/reverseRegistrar/L2ReverseRegistrar.sol
// https://github.com/ensdomains/ens-contracts/blob/staging/contracts/reverseRegistrar/L2ReverseRegistrarWithMigration.sol

export const REGISTRAR_ABI = parseAbi([
	"function owner() view returns (address)",
	"event NameForAddrChanged(address indexed addr, string name)",
]);

const SLOT_NAMES = 0n;
const SLOT_OWNER = 1n;
export function setOwner(storage: SlotStorage, owner: Hex) {
	storage.setStorage(toBytes(SLOT_OWNER, 32), toBytes(owner));
}

export function getPrimarySlot(addr: Hex): Uint8Array {
	return followSlot(SLOT_NAMES, toBytes(addr, 32));
}

export const KNOWN_ADDRS = [
	"0x69420f05A11f617B4B74fFe2E04B2D300dFA556F", // tate
	"0x51050ec063d393217B436747617aD1C2285Aeeee", // raffy
	"0x000000000000000000000000000000000000beef", // dne
] as const;

export type Registrar = {
	address: Address;
	createdAtBlock: number; // first block to sync
	ownable?: boolean; // owner() is stored in slot 1
};

// L2ReverseRegistrar deployments by chain id
const DEPLOYMENTS: Record<number, Omit<Registrar, "address">> = {
	42161: { createdAtBlock: 349263357 }, // arbitrum
	10: { createdAtBlock: 137403854 }, // optimism
	8453: { createdAtBlock: 31808582, ownable: true }, // base
	59144: { createdAtBlock: 20173340 }, // linea
};

export function getRegistrar(chain: ChainInfo): Registrar {
	const deployment = DEPLOYMENTS[chain.id];
	if (!deployment) throw new Error(`no registrar on ${chain.name}`);
	return { address: getRegistrarAddress(chain.testnet), ...deployment };
}

// sqlite database of NameForAddrChanged events (see scripts/demo.ts)
export function getDatabasePath(chain: ChainInfo) {
	return `${import.meta.dir}/data/${chain.name}.sqlite`;
}
