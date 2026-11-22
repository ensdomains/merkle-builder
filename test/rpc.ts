import { type Hex, toHex } from "viem";
import type { EthStorageProof } from "../src/eth.js";

export interface RawProvider {
	send(method: string, params: any[]): Promise<any>;
}

export type EthGetProof = {
	address: Hex;
	storageHash: Hex;
	storageProof: EthStorageProof[];
};

// partial eth_getProof helper
export async function ethGetProof(
	provider: RawProvider,
	address: string,
	slots: Uint8Array[] = [],
	blockTag = "latest"
): Promise<EthGetProof> {
	return provider.send("eth_getProof", [address, slots.map((x) => toHex(x)), blockTag]);
}
