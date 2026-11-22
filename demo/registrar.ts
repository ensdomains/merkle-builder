import { parseAbi } from "viem";
import type { SlotStorage } from "../src/storage.js";
import { type Hex } from "viem";
import { followSlot, toBytes } from "../src/utils.js";

// https://docs.ens.domains/ensip/19/#annex-supported-chains
export function getRegistrarAddress(testnet?: boolean) {
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

export type ChainInfo = {
	id: number;
	name: string;
	testnet?: boolean;
	explorer: string;
	logStep?: number;
	// provider info
	publicRPC?: string;
	drpcSlug?: string;
	alchemySlug?: string;
	unfinalized?: boolean;
	// registrar info
	createdAtBlock: number;
	ownable?: boolean;
};

export function determineProvider(info: ChainInfo, proto = "https") {
	const { RPC_URL, DRPC_KEY, ALCHEMY_KEY } = process.env;
	if (RPC_URL) {
		return RPC_URL; // explicit override (must support eth_getProof)
	} else if (info.drpcSlug && DRPC_KEY) {
		return `${proto}://lb.drpc.live/${info.drpcSlug}/${DRPC_KEY}`;
	} else if (info.alchemySlug && ALCHEMY_KEY) {
		return `${proto}://${info.alchemySlug}.g.alchemy.com/v2/${ALCHEMY_KEY}`;
	} else {
		throw new Error(`missing .env: set RPC_URL, DRPC_KEY, or ALCHEMY_KEY`);
	}
}

export function determineChain(name = "op"): ChainInfo {
	switch (name.toLowerCase()) {
		case "arb": {
			return {
				name: "arbitrum",
				id: 42161,
				//publicRPC: "https://arb1.arbitrum.io/rpc",
				drpcSlug: "arbitrum",
				alchemySlug: "arb-mainnet",
				explorer: "https://arbiscan.io",
				createdAtBlock: 349263357,
				logStep: 50000, // 250ms blocks
			};
		}
		case "op":
			return {
				name: "optimism",
				id: 10,
				explorer: "https://optimistic.etherscan.io",
				publicRPC: "https://mainnet.optimism.io",
				drpcSlug: "optimism",
				alchemySlug: "opt-mainnet",
				createdAtBlock: 137403854,
			};
		case "base":
			return {
				name: "base",
				id: 8453,
				ownable: true,
				explorer: "https://basescan.org",
				publicRPC: "https://mainnet.base.org",
				drpcSlug: "base",
				alchemySlug: "base-mainnet",
				createdAtBlock: 31808582,
			};
		case "linea":
			return {
				name: "linea",
				id: 59144,
				explorer: "https://lineascan.build",
				publicRPC: "https://rpc.linea.build",
				drpcSlug: "linea",
				alchemySlug: "linea-mainnet",
				createdAtBlock: 20173340,
			};
		case "scroll":
			return {
				name: "scroll",
				id: 534352,
				explorer: "https://scrollscan.com",
				publicRPC: "https://rpc.scroll.io",
				drpcSlug: "scroll",
				alchemySlug: "scroll-mainnet",
				createdAtBlock: 16604272,
				unfinalized: true, // 20260219: not sure why finalized is being weird
			};
		default:
			throw new Error(`unsupported chain: ${name}`);
	}
}
