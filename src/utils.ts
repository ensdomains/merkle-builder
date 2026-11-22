import keccak256 from "@adraffy/keccak/256";
import { bytesToHex, concat, hexToBytes } from "viem";

export function followSlot(slot: bigint, key: Uint8Array): Uint8Array {
	// https://docs.soliditylang.org/en/latest/internals/layout_in_storage.html#mappings-and-dynamic-arrays
	return keccak256(concat([key, toBytes(slot, 32)]));
}

// viem has no bytes equality helper
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

// always makes a copy
export function trimLeadingZeros(v: Uint8Array): Uint8Array {
	let i = 0;
	while (v[i] === 0) ++i;
	return v.slice(i);
}

// big-endian bytes of a non-negative integer or hex string (with or without 0x)
// without size: minimal encoding (0 => empty)
// with size: left-padded, throws if the value does not fit
export function toBytes(x: string | number | bigint, size?: number): Uint8Array {
	let hex: string;
	if (typeof x === "string") {
		hex = x.startsWith("0x") ? x.slice(2) : x;
	} else {
		if (x < 0) throw new RangeError(`expected unsigned: ${x}`);
		hex = x ? x.toString(16) : "";
	}
	if (size === undefined) {
		size = (hex.length + 1) >> 1;
	} else {
		hex = hex.replace(/^0+/, "");
	}
	if (hex.length > size << 1) {
		throw new RangeError(`overflow: ${hex.length >> 1} > ${size} bytes`);
	}
	return hexToBytes(`0x${hex.padStart(size << 1, "0")}`);
}

// left-pad (trimmed) big-endian bytes to a 32-byte word
export function toWord(v: Uint8Array): Uint8Array {
	if (v.length > 32) throw new RangeError(`expected <= 32 bytes: ${v.length}`);
	if (v.length === 32) return v;
	const word = new Uint8Array(32);
	word.set(v, 32 - v.length);
	return word;
}

// unlike viem bytesToBigInt, accepts empty bytes
export function toBigInt(v: Uint8Array): bigint {
	return v.length ? BigInt(bytesToHex(v)) : 0n;
}
