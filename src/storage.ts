import { EMPTY_BYTES } from "./trie.js";
import keccak256 from "@adraffy/keccak/256";
import { toBigInt, toBytes, toWord } from "./utils.js";

// word-level view of a contract's storage + solidity layout helpers
export abstract class SlotStorage {
	// returns the trimmed big-endian word (empty if zero)
	abstract getStorage(slot: Uint8Array): Uint8Array;
	// value is big-endian (<= 32 bytes, leading zeros allowed); zero clears the slot
	abstract setStorage(slot: Uint8Array, value: Uint8Array): void;

	// write value using the solidity "bytes" / "string" storage layout
	// https://docs.soliditylang.org/en/latest/internals/layout_in_storage.html#bytes-and-string
	// data slots of a prior longer value are cleared (like solidity)
	setBytes(slot: Uint8Array, value: Uint8Array) {
		assertSlot(slot);
		const oldSize = getLongSize(this.getStorage(slot));
		const key = keccak256(slot); // first data slot (mutated by increment)
		let pos = 0;
		if (value.length < 32) {
			const word = new Uint8Array(32);
			word.set(value);
			word[31] = value.length << 1;
			this.setStorage(slot, word);
		} else {
			this.setStorage(slot, toBytes((BigInt(value.length) << 1n) | 1n));
			for (; pos < value.length; increment(key)) {
				const end = pos + 32;
				const word = new Uint8Array(32);
				word.set(value.subarray(pos, end));
				this.setStorage(key.slice(), word);
				pos = end;
			}
		}
		for (; pos < oldSize; increment(key), pos += 32) {
			this.setStorage(key.slice(), EMPTY_BYTES);
		}
	}

	// read value using the solidity "bytes" / "string" storage layout
	getBytes(slot: Uint8Array): Uint8Array {
		assertSlot(slot);
		const header = this.getStorage(slot);
		const size = getLongSize(header);
		if (!size) {
			const word = toWord(header);
			return word.slice(0, word[31] >> 1);
		}
		const key = keccak256(slot);
		const v = new Uint8Array(size);
		for (let pos = 0; pos < size; pos += 32, increment(key)) {
			v.set(toWord(this.getStorage(key)).subarray(0, size - pos), pos);
		}
		return v;
	}
}

// size of a long bytes value from its header word, otherwise 0
function getLongSize(header: Uint8Array): number {
	// if this is too large, likely theres an encoding error
	// evm will run out of gas trying to clear it
	return header.length && header[header.length - 1] & 1
		? Number(toBigInt(header) >> 1n)
		: 0;
}

function assertSlot(slot: Uint8Array) {
	if (slot.length !== 32) throw new Error(`expected bytes32 slot`);
}

function increment(v: Uint8Array) {
	let i = v.length;
	while (i && v[i - 1] === 255) --i;
	if (i) {
		++v[i - 1];
		v.fill(0, i);
	} else {
		v.fill(0);
	}
}
