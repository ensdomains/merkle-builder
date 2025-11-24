import { keccak } from "@adraffy/keccak";

export function keccak256(v: Uint8Array): Uint8Array {
	return keccak().update(v).bytes;
}

export function followSlot(slot: bigint, key: Uint8Array) {
	// https://docs.soliditylang.org/en/latest/internals/layout_in_storage.html#mappings-and-dynamic-arrays
	return keccak256(Buffer.concat([key, toBytes(slot, 32)]));
}

export function trimLeadingZeros(v: Uint8Array): Uint8Array {
	let i = 0;
	while (v[i] === 0) ++i;
	return v.subarray(i);
}

export function toBytes(x: string | number | bigint, w?: number): Uint8Array {
	if (typeof x === 'string') {
		if (!/^0x[0-9a-f]*$/i.test(x)) throw new Error(`expected hex: ${x}`);
		x = x.slice(2);
	} else {
		x = x ? x.toString(16) : ""
	}
	w ??= (x.length + 1) >> 1;
	return Buffer.from(x.padStart(w << 1, "0"), "hex");
}

export function toBigInt(v: Uint8Array): bigint {
	return trimLeadingZeros(v).reduce<bigint>(
		(a, x) => (a << 8n) | BigInt(x),
		0n
	);
}

export function toHex(v: Uint8Array) {
	return '0x' + Buffer.from(v).toString('hex');
}
