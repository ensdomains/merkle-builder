import {
	EMPTY_BYTES,
	EMPTY_LEAF,
	isBranch,
	isEmptyLeaf,
	isExtension,
	toNibblePath,
	type MaybeNode,
} from "./trie.js";

const TY_NULL = 0;
const TY_BRANCH = 1;
const TY_EXTENSION = 2;
const TY_EMPTY_LEAF = 3;
const TY_LEAF = 4;

export const MAX_LENGTH = (1 << 22) - 1; // 4194304

export class Coder {
	public pos = 0;
	constructor(public buf: Uint8Array = new Uint8Array(1024)) {}
	expand(need: number) {
		const required = this.pos + need;
		let size = this.buf.length;
		if (required <= size) return;
		while (size < required) size <<= 1;
		const v = new Uint8Array(size);
		v.set(this.buf);
		this.buf = v;
	}
	require(need: number) {
		if (need && this.pos + need > this.buf.length) {
			throw new Error(`eof: ${this.pos + need} > ${this.buf.length}`);
		}
	}
	readByte() {
		this.require(1);
		return this.buf[this.pos++];
	}
	writeByte(x: number) {
		this.expand(1);
		this.buf[this.pos++] = x;
	}
	readLength() {
		let i = this.readByte();
		if (i & 128) {
			const next = this.readByte();
			i = (i & 127) + ((next & 127) << 7);
			if (next & 128) {
				i += this.readByte() << 14;
			}
		}
		return i;
	}
	writeLength(i: number) {
		if (i < 128) {
			this.writeByte(i);
		} else {
			this.writeByte(i | 128);
			i >>= 7;
			if (i < 128) {
				this.writeByte(i);
			} else {
				this.writeByte(i | 128);
				i >>= 7;
				if (i >> 8) throw new RangeError("overflow");
				this.writeByte(i);
			}
		}
	}
	readBytes(n: number) {
		if (!n) return EMPTY_BYTES;
		this.require(n);
		return this.buf.slice(this.pos, (this.pos += n));
	}
	writeBytes(v: Uint8Array) {
		this.expand(v.length);
		this.buf.set(v, this.pos);
		this.pos += v.length;
	}
	readPath() {
		const n = this.readByte();
		return toNibblePath(this.readBytes((n + 1) >> 1)).subarray(0, n);
	}
	writePath(v: Uint8Array) {
		const n = (v.length + 1) >> 1;
		this.expand(1 + n);
		this.buf[this.pos++] = v.length;
		for (let i = 0; i < v.length; i += 2) {
			this.buf[this.pos++] = (v[i] << 4) | (v[i + 1] ?? 0);
		}
	}
	readNode(): MaybeNode {
		const ty = this.readByte();
		switch (ty) {
			case TY_NULL:
				return;
			case TY_BRANCH:
				return {
					children: Array.from({ length: 16 }, () => this.readNode()),
				};
			case TY_EXTENSION: {
				const path = this.readPath();
				const child = this.readNode();
				if (!child) throw new Error("bug");
				return { path, child };
			}
			case TY_EMPTY_LEAF:
				return EMPTY_LEAF;
			case TY_LEAF:
				return {
					path: this.readPath(),
					value: this.readBytes(this.readLength()),
				};
			default:
				throw new Error(`unknown type: ${ty}`);
		}
	}
	writeNode(node: MaybeNode) {
		if (!node) {
			this.writeByte(TY_NULL);
		} else if (isBranch(node)) {
			this.writeByte(TY_BRANCH);
			for (const x of node.children) {
				this.writeNode(x);
			}
		} else if (isExtension(node)) {
			this.writeByte(TY_EXTENSION);
			this.writePath(node.path);
			this.writeNode(node.child);
		} else if (isEmptyLeaf(node)) {
			this.writeByte(TY_EMPTY_LEAF);
		} else {
			this.writeByte(TY_LEAF);
			this.writePath(node.path);
			this.writeLength(node.value.length);
			this.writeBytes(node.value);
		}
	}
	get bytes() {
		return this.buf.subarray(0, this.pos);
	}
}
