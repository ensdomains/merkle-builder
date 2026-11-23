// minimal RLP + hex-prefix helpers for trie node encodings (internal)
import { concat } from "viem";

function encodeRlpLength(start: number, length: number): Uint8Array {
	const max = 55;
	if (length <= max) return Uint8Array.of(start + length);
	const v = new Uint8Array(8);
	let i = v.length;
	for (; length; length >>= 8, ++start) {
		v[--i] = length;
	}
	v[--i] = start + max;
	return v.subarray(i);
}

export function encodeRlpList(m: Uint8Array[]): Uint8Array {
	return concat([
		encodeRlpLength(
			0xc0,
			m.reduce((a, x) => a + x.length, 0),
		),
		...m,
	]);
}

export function encodeRlpBytes(v: Uint8Array): Uint8Array {
	const max = 0x80;
	if (v.length === 1 && v[0] < max) return v;
	return concat([encodeRlpLength(max, v.length), v]);
}

// [payload start, payload end, isList] of the item at pos
function readRlpHeader(v: Uint8Array, pos: number): [number, number, boolean] {
	const b = v[pos];
	if (b === undefined) throw new Error("rlp: eof");
	if (b < 0x80) return [pos, pos + 1, false];
	const list = b >= 0xc0;
	const short = (list ? 0xc0 : 0x80) + 55;
	let start = pos + 1;
	let size: number;
	if (b <= short) {
		size = b - (short - 55);
	} else {
		const n = b - short;
		size = 0;
		for (let i = 0; i < n; i++) size = size * 256 + v[start + i];
		start += n;
	}
	const end = start + size;
	if (end > v.length) throw new Error("rlp: eof");
	return [start, end, list];
}

// raw encodings of the items of an RLP list (subarrays, not copies)
export function decodeRlpList(v: Uint8Array): Uint8Array[] {
	const [start, end, list] = readRlpHeader(v, 0);
	if (!list || end !== v.length) throw new Error("rlp: expected list");
	const items: Uint8Array[] = [];
	for (let pos = start; pos < end; ) {
		const [, next] = readRlpHeader(v, pos);
		items.push(v.subarray(pos, next));
		pos = next;
	}
	return items;
}

// payload of an RLP string item (subarray, not a copy)
export function decodeRlpBytes(v: Uint8Array): Uint8Array {
	const [start, end, list] = readRlpHeader(v, 0);
	if (list || end !== v.length) throw new Error("rlp: expected bytes");
	return v.subarray(start, end);
}

// hex-prefix encoding of a nibble path
export function encodePath(path: Uint8Array, leaf: boolean): Uint8Array {
	const v = new Uint8Array(1 + (path.length >> 1));
	if (leaf) v[0] = 32;
	const odd = path.length & 1;
	if (odd) v[0] |= 16 | path[0];
	for (let i = odd, j = 1; i < path.length; i += 2, ++j) {
		v[j] = (path[i] << 4) | path[i + 1];
	}
	return v;
}

export function decodePath(v: Uint8Array): { path: Uint8Array; leaf: boolean } {
	const flag = v[0] >> 4;
	if (flag > 3) throw new Error("invalid path prefix");
	const odd = flag & 1;
	const path = new Uint8Array(((v.length - 1) << 1) + odd);
	let i = 0;
	if (odd) path[i++] = v[0] & 15;
	for (let j = 1; j < v.length; j++) {
		path[i++] = v[j] >> 4;
		path[i++] = v[j] & 15;
	}
	return { path, leaf: flag >= 2 };
}
