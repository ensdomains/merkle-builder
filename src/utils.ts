import { keccak, bytes_from_hex, hex_from_bytes } from "@adraffy/keccak";

export type Hex = `0x${string}`;

export function keccak256(v: Uint8Array): Uint8Array {
	return keccak().update(v).bytes;
}

export function concat(...args: Uint8Array[]): Uint8Array {
	const n = args.reduce((a, x) => a + x.length, 0);
	const v = new Uint8Array(n);
	let pos = 0;
	for (const x of args) {
		v.set(x, pos);
		pos += x.length;
	}
	return v;
}

export function followSlot(slot: bigint, key: Uint8Array) {
	// https://docs.soliditylang.org/en/latest/internals/layout_in_storage.html#mappings-and-dynamic-arrays
	return keccak256(concat(key, toBytes(slot, 32)));
}

export function trimLeadingZeros(v: Uint8Array): Uint8Array {
	let i = 0;
	while (v[i] === 0) ++i;
	return v.subarray(i);
}

export function toBytes(x: string | number | bigint, size?: number): Uint8Array {
	if (typeof x === "string") {
		if (!/^0x[0-9a-f]*$/i.test(x)) throw new Error(`expected hex: ${x}`);
		x = x.slice(2);
	} else {
		x = x ? x.toString(16) : "";
	}
	size ??= (x.length + 1) >> 1;
	size <<= 1;
	return bytes_from_hex(x.padStart(size, "0").slice(-size));
}

export function toBigInt(v: Uint8Array): bigint {
	return trimLeadingZeros(v).reduce<bigint>(
		(a, x) => (a << 8n) | BigInt(x),
		0n
	);
}

export function toHex(v: Uint8Array): Hex {
	return `0x${hex_from_bytes(v)}`;
}
