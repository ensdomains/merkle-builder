import { type Hex, toHex } from "../src/utils.js";

export type EthStorageProof = {
	key: Hex;
	value: Hex;
	proof: Hex[];
};
export type EthGetProof = {
	address: Hex;
	storageHash: Hex;
	storageProof: EthStorageProof[];
};

// partial eth_getProof helper
export async function ethGetProof(
	provider: { send(method: string, params: any[]): Promise<any> },
	address: string,
	slots: Uint8Array[] = [],
	blockTag = "latest"
): Promise<EthGetProof> {
	return provider.send("eth_getProof", [address, slots.map(toHex), blockTag]);
}
