import {
	EMPTY_BYTES,
	isBranch,
	isExtension,
	newBranch,
	newLeaf,
	type MaybeNode,
} from "./trie.js";
import { concat, toBytes } from "./utils.js";
import { hex_from_bytes } from "@adraffy/keccak"; // skips "0x"

const MORE = {
	[Symbol.for("nodejs.util.inspect.custom")]() {
		return "\x1b[37m...\x1b[0m";
	},
};

export function toJSON(node: MaybeNode, depth = Infinity): any {
	if (!node) return null;
	if (depth < 0) return MORE;
	if (isBranch(node)) {
		return Object.fromEntries(
			node.children.flatMap((x, i) =>
				x ? [[toNibbleChar(i), x && toJSON(x, depth - 1)]] : [],
			),
		);
	} else if (isExtension(node)) {
		return [nibbleStr(node.path), toJSON(node.child, depth - 1)];
	} else if (node.path.length) {
		return [nibbleStr(node.path), hex_from_bytes(node.data)];
	} else {
		return hex_from_bytes(node.data);
	}
}

export function fromJSON(json: any): MaybeNode {
	switch (typeof json) {
		case "string":
			return newLeaf(EMPTY_BYTES, toBytes(json));
		case "object": {
			if (json === null) return;
			if (Array.isArray(json) && json.length === 2) {
				const path = Uint8Array.from(json[0], fromNibbleChar);
				const child = fromJSON(json[1]);
				if (isBranch(child)) {
					return { path, child };
				} else if (isExtension(child)) {
					return { path: concat(path, child.path), child: child.child };
				} else if (child) {
					return newLeaf(concat(path, child.path), child.data);
				}
			} else if (json.constructor === Object) {
				const b = newBranch();
				for (const [k, x] of Object.entries(json)) {
					b.children[fromNibbleChar(k)] = fromJSON(x);
				}
				return b;
			}
		}
	}
	throw Object.assign(new TypeError("invalid json"), { json });
}

function nibbleStr(path: Iterable<number>) {
	return Array.from(path, toNibbleChar).join("");
}

function toNibbleChar(nibble: number) {
	return String.fromCharCode((nibble < 10 ? 48 : 55) + nibble);
}

function fromNibbleChar(ch: string): number {
	if (ch.length === 1) {
		const cp = ch.charCodeAt(0);
		if (cp >= 48 && cp <= 57) {
			return cp - 48;
		} else if (cp >= 65 && cp <= 70) {
			return cp - 55;
		}
	}
	throw new TypeError(`invalid nibble: "${ch}"`);
}
