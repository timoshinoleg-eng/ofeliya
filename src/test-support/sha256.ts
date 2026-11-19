/**
 * Minimal incremental SHA-256 (FIPS 180-4) — test-only, zero dependencies.
 *
 * The harness hashes input/state streams synchronously on every frame, so the
 * async WebCrypto API (`crypto.subtle.digest`) is unusable here. This small
 * implementation exists only under `src/test-support/` and is dead-code
 * eliminated from production builds together with the rest of the harness.
 *
 * `digest()` finalizes a COPY of the internal state, so `update()` may
 * continue afterwards and `getRunLog()` can be called repeatedly without
 * disturbing the running hashes.
 */

/** SHA-256 round constants (first 32 bits of the cube roots of the first 64 primes). */
const K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** Initial hash values (first 32 bits of the square roots of the first 8 primes). */
const H0: readonly number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

export class Sha256 {
  private h: number[] = [...H0];
  private readonly block = new Uint8Array(64);
  private blockLen = 0;
  private totalLen = 0;
  private readonly w = new Int32Array(64);
  private readonly encoder = new TextEncoder();

  update(data: string): this {
    const bytes = this.encoder.encode(data);
    this.feed(bytes, true);
    return this;
  }

  digest(): string {
    const clone = new Sha256();
    clone.h = [...this.h];
    clone.block.set(this.block);
    clone.blockLen = this.blockLen;
    clone.totalLen = this.totalLen;
    return clone.finalize();
  }

  /** Feed bytes into the compression function. `counted` bytes extend totalLen. */
  private feed(bytes: Uint8Array, counted: boolean): void {
    if (counted) this.totalLen += bytes.length;
    let offset = 0;
    if (this.blockLen > 0) {
      const take = Math.min(64 - this.blockLen, bytes.length);
      this.block.set(bytes.subarray(0, take), this.blockLen);
      this.blockLen += take;
      offset = take;
      if (this.blockLen === 64) {
        this.compress(this.block);
        this.blockLen = 0;
      }
    }
    while (offset + 64 <= bytes.length) {
      this.compress(bytes.subarray(offset, offset + 64));
      offset += 64;
    }
    if (offset < bytes.length) {
      this.block.set(bytes.subarray(offset), 0);
      this.blockLen = bytes.length - offset;
    }
  }

  private finalize(): string {
    // Padding: 0x80, then zeros until length ≡ 56 (mod 64), then the 64-bit
    // big-endian bit length. totalLen stays far below 2^29 bytes here, so the
    // high word of the bit length is always 0.
    const bitLen = this.totalLen * 8;
    const padLen = this.blockLen < 56 ? 56 - this.blockLen : 120 - this.blockLen;
    const pad = new Uint8Array(padLen + 8);
    pad[0] = 0x80;
    const view = new DataView(pad.buffer);
    view.setUint32(padLen, 0, false);
    view.setUint32(padLen + 4, bitLen >>> 0, false);
    this.feed(pad, false);
    return this.h.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }

  private compress(chunk: Uint8Array): void {
    const w = this.w;
    for (let i = 0; i < 16; i++) {
      w[i] =
        (chunk[i * 4] << 24) | (chunk[i * 4 + 1] << 16) | (chunk[i * 4 + 2] << 8) | chunk[i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = this.h[0];
    let b = this.h[1];
    let c = this.h[2];
    let d = this.h[3];
    let e = this.h[4];
    let f = this.h[5];
    let g = this.h[6];
    let h = this.h[7];
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + K[i] + w[i]) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    this.h[0] = (this.h[0] + a) | 0;
    this.h[1] = (this.h[1] + b) | 0;
    this.h[2] = (this.h[2] + c) | 0;
    this.h[3] = (this.h[3] + d) | 0;
    this.h[4] = (this.h[4] + e) | 0;
    this.h[5] = (this.h[5] + f) | 0;
    this.h[6] = (this.h[6] + g) | 0;
    this.h[7] = (this.h[7] + h) | 0;
  }
}
