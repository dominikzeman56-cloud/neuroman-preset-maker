/** Minimal CBOR codec for Serum 2 presets. Preserves int vs float64. */

export type CKey = string | number;

export type CNode =
  | { k: "i"; v: number }
  | { k: "f"; v: number; w: 16 | 32 | 64 }
  | { k: "b"; v: boolean }
  | { k: "s"; v: string }
  | { k: "u"; v: Uint8Array }
  | { k: "z" }
  | { k: "a"; v: CNode[] }
  | { k: "m"; v: Array<[CKey, CNode]> };

export type CMap = Extract<CNode, { k: "m" }>;

class R {
  private i = 0;
  private readonly b: Uint8Array;
  constructor(b: Uint8Array) {
    this.b = b;
  }
  get done() {
    return this.i >= this.b.length;
  }
  u8() {
    const v = this.b[this.i++];
    if (v === undefined) throw new Error("CBOR truncated");
    return v;
  }
  u16() {
    return (this.u8() << 8) | this.u8();
  }
  u32() {
    return this.u16() * 65536 + this.u16();
  }
  bytes(n: number) {
    const s = this.b.subarray(this.i, this.i + n);
    if (s.length !== n) throw new Error("CBOR truncated");
    this.i += n;
    return s;
  }
  f32() {
    const dv = new DataView(this.b.buffer, this.b.byteOffset + this.i, 4);
    this.i += 4;
    return dv.getFloat32(0, false);
  }
  f64() {
    const dv = new DataView(this.b.buffer, this.b.byteOffset + this.i, 8);
    this.i += 8;
    return dv.getFloat64(0, false);
  }
}

function f16(u: number) {
  const sign = u & 0x8000 ? -1 : 1;
  const exp = (u >> 10) & 0x1f;
  const frac = u & 0x3ff;
  if (exp === 0) return sign * 2 ** -14 * (frac / 1024);
  if (exp === 31) return frac ? Number.NaN : sign * Infinity;
  return sign * 2 ** (exp - 15) * (1 + frac / 1024);
}

function readLen(r: R, ai: number): number {
  if (ai < 24) return ai;
  if (ai === 24) return r.u8();
  if (ai === 25) return r.u16();
  if (ai === 26) return r.u32();
  throw new Error(`CBOR length ai ${ai} not used by Serum presets`);
}

function readNode(r: R): CNode {
  const ib = r.u8();
  const major = ib >> 5;
  const ai = ib & 31;
  if (major === 0) return { k: "i", v: readLen(r, ai) };
  if (major === 1) return { k: "i", v: -1 - readLen(r, ai) };
  if (major === 2) {
    const n = readLen(r, ai);
    return { k: "u", v: new Uint8Array(r.bytes(n)) };
  }
  if (major === 3) {
    const n = readLen(r, ai);
    return { k: "s", v: new TextDecoder().decode(r.bytes(n)) };
  }
  if (major === 4) {
    const n = readLen(r, ai);
    const v: CNode[] = [];
    for (let i = 0; i < n; i++) v.push(readNode(r));
    return { k: "a", v };
  }
  if (major === 5) {
    const n = readLen(r, ai);
    const v: Array<[CKey, CNode]> = [];
    for (let i = 0; i < n; i++) {
      const key = readNode(r);
      if (key.k === "s" || key.k === "i") v.push([key.v, readNode(r)]);
      else throw new Error("CBOR map key is not a string or int");
    }
    return { k: "m", v };
  }
  if (major === 6) throw new Error("CBOR tag not expected");
  if (major === 7) {
    if (ai === 20) return { k: "b", v: false };
    if (ai === 21) return { k: "b", v: true };
    if (ai === 22) return { k: "z" };
    if (ai === 25) return { k: "f", v: f16(r.u16()), w: 16 };
    if (ai === 26) return { k: "f", v: r.f32(), w: 32 };
    if (ai === 27) return { k: "f", v: r.f64(), w: 64 };
    throw new Error(`CBOR simple ${ai} not expected`);
  }
  throw new Error(`CBOR major ${major}`);
}

export function decodeCbor(buf: Uint8Array): CNode {
  const r = new R(buf);
  const node = readNode(r);
  if (!r.done) throw new Error("CBOR trailing bytes");
  return node;
}

class W {
  private readonly parts: number[] = [];
  u8(n: number) {
    this.parts.push(n & 255);
  }
  bytes(b: Uint8Array) {
    for (const x of b) this.parts.push(x);
  }
  head(major: number, n: number) {
    if (n < 24) this.u8((major << 5) | n);
    else if (n < 256) {
      this.u8((major << 5) | 24);
      this.u8(n);
    } else if (n < 65536) {
      this.u8((major << 5) | 25);
      this.u8(n >> 8);
      this.u8(n);
    } else if (n < 2 ** 32) {
      this.u8((major << 5) | 26);
      this.u8(n >>> 24);
      this.u8(n >>> 16);
      this.u8(n >>> 8);
      this.u8(n);
    } else throw new Error("CBOR length too big");
  }
  text(s: string) {
    const b = new TextEncoder().encode(s);
    this.head(3, b.length);
    this.bytes(b);
  }
  f32(n: number) {
    this.u8((7 << 5) | 26);
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, n, false);
    this.bytes(new Uint8Array(buf));
  }
  f64(n: number) {
    this.u8((7 << 5) | 27);
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, n, false);
    this.bytes(new Uint8Array(buf));
  }
  toUint8() {
    return Uint8Array.from(this.parts);
  }
}

function writeNode(w: W, node: CNode) {
  switch (node.k) {
    case "i": {
      if (node.v >= 0) w.head(0, node.v);
      else w.head(1, -1 - node.v);
      return;
    }
    case "f":
      if (node.w === 64) w.f64(node.v);
      else w.f32(node.v);
      return;
    case "b":
      w.u8(node.v ? 0xf5 : 0xf4);
      return;
    case "s":
      w.text(node.v);
      return;
    case "u":
      w.head(2, node.v.length);
      w.bytes(node.v);
      return;
    case "z":
      w.u8(0xf6);
      return;
    case "a":
      w.head(4, node.v.length);
      for (const c of node.v) writeNode(w, c);
      return;
    case "m":
      w.head(5, node.v.length);
      for (const [k, v] of node.v) {
        if (typeof k === "number") writeNode(w, { k: "i", v: k });
        else w.text(k);
        writeNode(w, v);
      }
      return;
  }
}

export function encodeCbor(node: CNode): Uint8Array {
  const w = new W();
  writeNode(w, node);
  return w.toUint8();
}

export function asMap(node: CNode, label: string): CMap {
  if (node.k !== "m") throw new Error(`${label} is not a map`);
  return node;
}

export function mapGet(map: CMap, key: string): CNode | undefined {
  return map.v.find((e) => e[0] === key)?.[1];
}

export function nodeNum(node: CNode | undefined): number | null {
  if (!node) return null;
  if (node.k === "f" || node.k === "i") return node.v;
  return null;
}

export function nodeStr(node: CNode | undefined): string | null {
  return node?.k === "s" ? node.v : null;
}

export function plainParams(mod: CMap): CMap {
  const hit = mod.v.find((e) => e[0] === "plainParams");
  if (!hit || hit[1].k !== "m") {
    const created: CMap = { k: "m", v: [] };
    if (hit) hit[1] = created;
    else mod.v.push(["plainParams", created]);
    return created;
  }
  return hit[1];
}

export function setFloat(map: CMap, key: string, n: number) {
  const node: CNode = { k: "f", v: n, w: 32 };
  const i = map.v.findIndex((e) => e[0] === key);
  if (i >= 0) map.v[i][1] = node;
  else map.v.push([key, node]);
}

export function setInt(map: CMap, key: string, n: number) {
  const node: CNode = { k: "i", v: Math.round(n) };
  const i = map.v.findIndex((e) => e[0] === key);
  if (i >= 0) map.v[i][1] = node;
  else map.v.push([key, node]);
}

export function setStr(map: CMap, key: string, s: string) {
  const node: CNode = { k: "s", v: s };
  const i = map.v.findIndex((e) => e[0] === key);
  if (i >= 0) map.v[i][1] = node;
  else map.v.push([key, node]);
}
