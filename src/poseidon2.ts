// Poseidon2 over KoalaBear (p = 2^31 - 2^24 + 1), width 16, x^3 s-box, 3+21+3 rounds
// Merkle-Damgard over 32-byte blocks (8 big-endian u32 limbs), as used by Linea (>= 2026-04)
// reference: https://github.com/LFDT-Lineth/lineth-monorepo/blob/main/contracts/src/libraries/Poseidon2.sol

export const KOALABEAR_PRIME = 2130706433;

const P = KOALABEAR_PRIME;
const WIDTH = 16;

const INV_P = 1 / P;

// x mod P for 0 <= x < 2^53 (avoids slow float %)
function reduce(x: number): number {
	const r = x - Math.floor(x * INV_P) * P; // estimate may be off by one
	return r < 0 ? r + P : r >= P ? r - P : r;
}

// a * b mod P without exceeding 2^53
function mul(a: number, b: number): number {
	return reduce(reduce(a * (b >>> 16)) * 65536 + a * (b & 0xffff));
}

function sbox(x: number): number {
	return mul(x, mul(x, x));
}

// unpack a uint256 into 8 big-endian u32 limbs
function limbs(x: bigint): number[] {
	return Array.from({ length: 8 }, (_, i) =>
		Number((x >> BigInt(224 - 32 * i)) & 0xffffffffn)
	);
}

function fullRoundKeys(hi: bigint, lo: bigint): Uint32Array {
	return Uint32Array.from([...limbs(hi), ...limbs(lo)]);
}

const FULL_RK_BEGIN = [
	fullRoundKeys(
		52691802021506155758914962750280372212207119203515444126415105344946620971042n,
		32207471970256316655474490955553459742787419335289228299095903266455798739660n
	),
	fullRoundKeys(
		22163791677048831312463448776400028385347383911100916908889018061663075177430n,
		52176870515245694198691020358647906763460864198395806999480367588806463375956n
	),
	fullRoundKeys(
		20057732892593326318373784289292844513497509146673516636435948826170767804894n,
		18178750968836063378915279115560606579387492034215281114134869585318875352069n
	),
];

const PARTIAL_RK = Uint32Array.of(
	271263440, 648183298, 1662653166, 1984135584, 594964655, 108023522, 849546096,
	1961993938, 1546336947, 1036613726, 452088758, 275827416, 763236035, 1068717067,
	1580958419, 1376393748, 892777736, 1345121022, 908739241, 908871000, 1053550888
);

const FULL_RK_END = [
	fullRoundKeys(
		7748602703960850726417234176553190502144764796409545305676706613632081374108n,
		14236178139181542176197168604443439317755831764127965411495610808590768539130n
	),
	fullRoundKeys(
		4390545490380878999875851257118004037103299792992754784803412502652715488373n,
		15895992674755709583772916119416271803214403026810424648839392700430632374893n
	),
	fullRoundKeys(
		37373517675827041221658956101645979913006475784844873469590649853964048342988n,
		46010512812451809471058691124553676654818408969360806522307687423952321374687n
	),
];

// internal matrix = 1 + diag(D)
// D = [-2, 1, 2, 1/2, 3, 4, -1/2, -3, -4, 1/2^8, 1/8, 1/2^24, -1/2^8, -1/8, -1/16, -1/2^24]
const DIAG = Uint32Array.of(
	P - 2, 1, 2, 1065353217, 3, 4, 1065353216, P - 3,
	P - 4, 2122383361, 1864368129, 2130706306, 8323072, 266338304, 133169152, 127
);

// external matrix = circ(2*M4, M4, M4, M4)
function matMulExternal(s: Uint32Array) {
	for (let k = 0; k < WIDTH; k += 4) {
		const a = s[k], b = s[k + 1], c = s[k + 2], d = s[k + 3];
		const t01 = a + b;
		const t23 = c + d;
		const t0123 = t01 + t23;
		const t01123 = t0123 + b;
		const t01233 = t0123 + d;
		s[k] = reduce(t01 + t01123); // 2a + 3b + c + d
		s[k + 1] = reduce(c + c + t01123); // a + 2b + 3c + d
		s[k + 2] = reduce(t23 + t01233); // a + b + 2c + 3d
		s[k + 3] = reduce(a + a + t01233); // 3a + b + c + 2d
	}
	for (let j = 0; j < 4; j++) {
		const t = s[j] + s[j + 4] + s[j + 8] + s[j + 12];
		for (let k = j; k < WIDTH; k += 4) s[k] = reduce(s[k] + t);
	}
}

function matMulInternal(s: Uint32Array) {
	let sum = 0;
	for (let i = 0; i < WIDTH; i++) sum += s[i];
	sum = reduce(sum);
	for (let i = 0; i < WIDTH; i++) s[i] = reduce(sum + mul(DIAG[i], s[i]));
}

function fullRound(s: Uint32Array, rk: Uint32Array) {
	for (let i = 0; i < WIDTH; i++) s[i] = sbox(reduce(s[i] + rk[i]));
	matMulExternal(s);
}

export function poseidon2Permute(s: Uint32Array) {
	if (s.length !== WIDTH) throw new Error(`expected ${WIDTH} limbs`);
	matMulExternal(s);
	for (const rk of FULL_RK_BEGIN) fullRound(s, rk);
	for (const rk of PARTIAL_RK) {
		s[0] = sbox(reduce(s[0] + rk));
		matMulInternal(s);
	}
	for (const rk of FULL_RK_END) fullRound(s, rk);
}

// hash 32-byte aligned data into a 32-byte digest (8 limbs)
export function poseidon2(data: Uint8Array): Uint8Array {
	if (!data.length || data.length & 31) {
		throw new Error(`expected non-empty 32-byte aligned data: ${data.length}`);
	}
	const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const h = new Uint32Array(8);
	const s = new Uint32Array(WIDTH);
	for (let pos = 0; pos < data.length; pos += 32) {
		for (let i = 0; i < 8; i++) {
			s[i] = h[i];
			s[8 + i] = reduce(dv.getUint32(pos + 4 * i));
		}
		const m = s.slice(8);
		poseidon2Permute(s);
		for (let i = 0; i < 8; i++) h[i] = reduce(s[8 + i] + m[i]);
	}
	const out = new Uint8Array(32);
	const ov = new DataView(out.buffer);
	for (let i = 0; i < 8; i++) ov.setUint32(4 * i, h[i]);
	return out;
}

// spread 32 bytes into 64 bytes so every limb is a field element: 0xAAAABBBB.. => 0x0000AAAA0000BBBB..
export function poseidon2Pad(word: Uint8Array): Uint8Array {
	if (word.length !== 32) throw new Error(`expected 32 bytes: ${word.length}`);
	const out = new Uint8Array(64);
	for (let i = 0; i < 16; i++) {
		out[4 * i + 2] = word[2 * i];
		out[4 * i + 3] = word[2 * i + 1];
	}
	return out;
}
