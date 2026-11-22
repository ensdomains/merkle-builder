export type ChainInfo = {
	key: string; // -c argument (matches the README demo list)
	id: number;
	name: string;
	testnet?: boolean;
	explorer: string;
	logStep?: number; // eth_getLogs block range
	unfinalized?: boolean; // sync to "latest" instead of "finalized"
	// rpc info
	publicRPC?: string; // used for eth_getLogs when set
	drpcSlug?: string;
	alchemySlug?: string;
};

export function determineChain(name = "op"): ChainInfo {
	const key = name.toLowerCase();
	return { key, ...chainInfoFor(key) };
}

// rpc for proofs (and logs when there is no publicRPC)
export function determineRPC(info: ChainInfo, proto = "https") {
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

function chainInfoFor(key: string): Omit<ChainInfo, "key"> {
	switch (key) {
		case "arb":
			return {
				name: "arbitrum",
				id: 42161,
				explorer: "https://arbiscan.io",
				//publicRPC: "https://arb1.arbitrum.io/rpc",
				drpcSlug: "arbitrum",
				alchemySlug: "arb-mainnet",
				logStep: 50000, // 250ms blocks
			};
		case "op":
			return {
				name: "optimism",
				id: 10,
				explorer: "https://optimistic.etherscan.io",
				publicRPC: "https://mainnet.optimism.io",
				drpcSlug: "optimism",
				alchemySlug: "opt-mainnet",
			};
		case "base":
			return {
				name: "base",
				id: 8453,
				explorer: "https://basescan.org",
				//publicRPC: "https://mainnet.base.org", // 20261122: rate limits every eth_getLogs
				drpcSlug: "base",
				alchemySlug: "base-mainnet",
			};
		case "linea":
			return {
				name: "linea",
				id: 59144,
				explorer: "https://lineascan.build",
				publicRPC: "https://rpc.linea.build",
				drpcSlug: "linea",
				alchemySlug: "linea-mainnet",
			};
		case "scroll":
			return {
				name: "scroll",
				id: 534352,
				explorer: "https://scrollscan.com",
				publicRPC: "https://rpc.scroll.io",
				drpcSlug: "scroll",
				alchemySlug: "scroll-mainnet",
				unfinalized: true, // 20260219: not sure why finalized is being weird
			};
		default:
			throw new Error(`unsupported chain: ${key}`);
	}
}
