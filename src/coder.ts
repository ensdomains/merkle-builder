import {
	EMPTY_BYTES,
	EMPTY_LEAF,
	isBranch,
	isEmptyLeaf,
	isExtension,
	toNibblePath,
	type MaybeNode,
} from "./trie.js";

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
		if (need && this.pos + need >= this.buf.length) {
			throw new Error("eof");
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
	readSmallBytes() {
		return this.readBytes(this.readByte());
	}
	writeSmallBytes(v: Uint8Array) {
		this.expand(1 + v.length);
		this.writeByte(v.length);
		this.writeBytes(v);
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
			case 0:
				return undefined;
			case 1:
				return {
					children: Array.from({ length: 16 }, () => this.readNode()),
				};
			case 2: {
				const path = this.readPath();
				const child = this.readNode();
				if (!child) throw new Error("bug");
				return { path, child };
			}
			case 3:
				return EMPTY_LEAF;
			case 4: {
				return {
					path: this.readPath(),
					value: this.readSmallBytes(),
				};
			}
			default:
				throw new Error(`unknown type: ${ty}`);
		}
	}
	writeNode(node: MaybeNode) {
		if (!node) {
			this.writeByte(0);
		} else if (isBranch(node)) {
			this.writeByte(1);
			for (const x of node.children) {
				this.writeNode(x);
			}
		} else if (isExtension(node)) {
			this.writeByte(2);
			this.writePath(node.path);
			this.writeNode(node.child);
		} else if (isEmptyLeaf(node)) {
			this.writeByte(3);
		} else {
			this.writeByte(4);
			this.writePath(node.path);
			this.writeSmallBytes(node.value);
		}
	}
	get bytes() {
		return this.buf.subarray(0, this.pos);
	}
}
