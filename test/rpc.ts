import type { Foundry } from "@adraffy/blocksmith";
import { toHex } from "../src/utils.js";

export type EthStorageProof = {
	key: string;
	value: string;
	proof: string[];
};
export type EthGetProof = {
	storageHash: string;
	storageProof: EthStorageProof[];
};

// partial eth_getProof helper
export async function ethGetProof(
	foundry: Foundry,
	address: string,
	slots: Uint8Array[] = []
): Promise<EthGetProof> {
	return foundry.provider.send("eth_getProof", [
		address,
		slots.map(toHex),
		"latest",
	]);
}