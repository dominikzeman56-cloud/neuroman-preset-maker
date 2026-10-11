import { createHash } from "node:crypto";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import {
  asMap,
  decodeCbor,
  encodeCbor,
  mapGet,
  nodeNum,
  nodeStr,
  plainParams,
  setFloat,
  setStr,
  type CMap,
  type CNode,
} from "./cbor";
import { blankOsc, guessArchetype, type Study } from "./study";
import type { FilterPatch, LfoPatch, OscPatch } from "./types";

const MAGIC = Buffer.from("XferJson\0");
const MAX_IN = 1_500_000;
const MAX_RAW = 12_000_000;
const FX_LABEL = [
  "Distortion",
  "Flanger",
  "Phaser",
  "Chorus",
  "Delay",
  "Comp",
  "Reverb",
  "EQ",
  "Filter",
  "Hyper",
  "Bode",
  "Conv",
  "Utility",
  "Split",
  "Split3",
  "SplitMS",
];

const NUDGE: Record<string, [number, number, number, number]> = {
  kParamDetune: [0.06, 0, 1, 1.5],
  kParamUnisonStereo: [0.06, 0, 1, 1.5],
  kParamTablePos: [0.05, 0, 1, 1.5],
  kParamFreq: [0.04, 0, 1, 1.5],
  kParamReso: [4, 0, 100, 100],
  kParamDrive: [4, 0, 100, 100],
  kParamRate: [0.04, 0, 1, 1.5],
  kParamWet: [5, 0, 100, 100],
  kParamDepth: [4, 0, 100, 100],
  kParamFeedback: [3, 0, 80, 100],
  kParamVolume: [0.04, 0, 1, 1.5],
};

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function paramsOf(mod: CMap): CMap | null {
  const hit = mapGet(mod, "plainParams");
  return hit?.k === "m" ? hit : null;
}

function numAt(map: CMap | null, key: string, fallback: number) {
  if (!map) return fallback;
  const n = nodeNum(mapGet(map, key));
  return n ?? fallback;
}

function unit(n: number) {
  if (n > 1.5 && n <= 100) return n / 100;
  return n;
}

function openPreset(bytes: Buffer) {
  if (bytes.length < 24) throw new Error("Soubor je prázdný.");
  if (bytes.length > MAX_IN) throw new Error("Preset je větší než 1.5 MB.");
  if (!bytes.subarray(0, 9).equals(MAGIC)) throw new Error("Tohle není Serum preset.");
  let pos = 9;
  const metaLen = Number(bytes.readBigUInt64LE(pos));
  pos += 8;
  if (!Number.isFinite(metaLen) || metaLen < 2 || pos + metaLen > bytes.length) {
    throw new Error("Hlavička presetu nesedí.");
  }
  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(bytes.subarray(pos, pos + metaLen).toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new Error("Hlavička presetu není JSON.");
  }
  pos += metaLen;
  const uncomp = bytes.readUInt32LE(pos);
  pos += 4;
  const version = bytes.readUInt32LE(pos);
  pos += 4;
  if (uncomp > MAX_RAW) throw new Error("Rozbalený preset je moc velký.");
  let cbor: Buffer;
  try {
    cbor = zstdDecompressSync(bytes.subarray(pos));
  } catch {
    throw new Error("Preset nejde rozbalit. Čekám Serum 2.");
  }
  let root: CMap;
  try {
    root = asMap(decodeCbor(cbor), "preset");
  } catch {
    throw new Error("Tělo presetu má CBOR, který tenhle rozbor ještě nečte.");
  }
  return { meta, version, root };
}

function readOsc(root: CMap, index: number): OscPatch {
  const mod = mapGet(root, `Oscillator${index}`);
  if (!mod || mod.k !== "m") return blankOsc(0);
  const pp = paramsOf(mod);
  const wt = mapGet(mod, `WTOsc${index}`);
  const wpp = wt?.k === "m" ? paramsOf(wt) : null;
  const volume = clamp(unit(numAt(pp, "kParamVolume", 0)), 0, 1);
  const enable = numAt(pp, "kParamEnable", volume > 0.01 ? 1 : 0) > 0.5 ? 1 : 0;
  const warp = nodeStr(wpp ? mapGet(wpp, "kParamWarpMenu") : undefined);
  return {
    octave: clamp(Math.round(numAt(pp, "kParamOctave", 0)), -3, 3),
    volume,
    unison: clamp(Math.round(numAt(pp, "kParamUnison", 1)), 1, 16),
    detune: clamp(unit(numAt(pp, "kParamDetune", 0)), 0, 1),
    stereo: clamp(unit(numAt(pp, "kParamUnisonStereo", 0)), 0, 1),
    enable,
    warp: warp && warp !== "kNoWarp" ? warp : null,
    tablePos: clamp(unit(numAt(wpp, "kParamTablePos", 0)), 0, 1),
  };
}

function readFilter(root: CMap, index: number): FilterPatch {
  const mod = mapGet(root, `VoiceFilter${index}`);
  if (!mod || mod.k !== "m") return { type: "MgL12", freq: 1, reso: 0, drive: 0, enable: 0 };
  const pp = paramsOf(mod);
  const type = nodeStr(pp ? mapGet(pp, "kParamType") : undefined) || "MgL12";
  return {
    type,
    freq: clamp(unit(numAt(pp, "kParamFreq", 1)), 0, 1),
    reso: clamp(numAt(pp, "kParamReso", 0), 0, 100),
    drive: clamp(numAt(pp, "kParamDrive", 0), 0, 100),
    enable: numAt(pp, "kParamEnable", 1) > 0.5 ? 1 : 0,
  };
}

function readLfo(root: CMap, index: number): LfoPatch {
  const mod = mapGet(root, `LFO${index}`);
  if (!mod || mod.k !== "m") return { mode: "Free", rate: 0 };
  const pp = paramsOf(mod);
  const modeRaw = nodeStr(pp ? mapGet(pp, "kParamMode") : undefined) ?? "";
  const mode = /env/i.test(modeRaw) ? "Envelope" : "Free";
  return { mode, rate: clamp(unit(numAt(pp, "kParamRate", 0)), 0, 1) };
}

const SOURCE_NAME: Record<number, string> = {
  1: "Mod wheel",
  16: "Velocity",
  17: "Note",
  20: "Noise",
};

function sourceName(id: number) {
  if (id >= 2 && id <= 5) return `Env ${id - 1}`;
  if (id >= 6 && id <= 15) return `LFO ${id - 5}`;
  if (id >= 25 && id <= 32) return `Macro ${id - 24}`;
  return SOURCE_NAME[id] ?? `zdroj ${id}`;
}

function paramShort(name: string) {
  return name.replace(/^kParam/, "");
}

function oscLetter(id: number) {
  return ["A", "B", "C", "Noise", "Sub"][id] ?? String(id + 1);
}

function destShort(type: string, id: number, param: string) {
  const knob = paramShort(param);
  if (type === "Oscillator") return `${oscLetter(id)} ${knob}`;
  if (type === "WTOsc") return `${oscLetter(id)} ${knob}`;
  if (type === "VoiceFilter") return `Filter ${id + 1} ${knob}`;
  if (type === "LFO") return `LFO ${id + 1} ${knob}`;
  if (type === "FXFilter") return `FX filtr ${knob}`;
  if (type.startsWith("FX")) return `${type.replace(/^FX/, "")} ${knob}`;
  return `${type} ${knob}`;
}

function readMods(root: CMap) {
  const rows: string[] = [];
  for (let index = 0; index < 16; index++) {
    const slot = mapGet(root, `ModSlot${index}`);
    if (!slot || slot.k !== "m") continue;
    const param = nodeStr(mapGet(slot, "destModuleParamName"));
    const type = nodeStr(mapGet(slot, "destModuleTypeString"));
    if (!param || !type) continue;
    const id = nodeNum(mapGet(slot, "destModuleID")) ?? 0;
    const source = mapGet(slot, "source");
    const sourceId = source?.k === "a" ? nodeNum(source.v[0]) : null;
    const amount = numAt(paramsOf(slot), "kParamAmount", 0);
    const who = sourceId == null ? "mod" : sourceName(sourceId);
    rows.push(`${who} → ${destShort(type, id, param)} ${Math.round(amount)}`);
  }
  return rows;
}

function untouched(root: CMap, name: string) {
  const mod = mapGet(root, name);
  if (!mod || mod.k !== "m") return true;
  const pp = mapGet(mod, "plainParams");
  if (!pp || pp.k === "s") return true;
  return pp.k === "m" && pp.v.length === 0;
}

function tableName(root: CMap, index: number) {
  const osc = mapGet(root, `Oscillator${index}`);
  if (!osc || osc.k !== "m") return "";
  const wt = mapGet(osc, `WTOsc${index}`);
  if (!wt || wt.k !== "m") return "";
  const display = nodeStr(mapGet(wt, "tableDisplayName"));
  if (display) return display;
  const path = nodeStr(mapGet(wt, "relativePathToWT"));
  if (!path) return "";
  const leaf = path.split("/").pop() ?? path;
  return leaf.replace(/\.wav$/i, "");
}

function warp2(root: CMap, index: number) {
  const osc = mapGet(root, `Oscillator${index}`);
  if (!osc || osc.k !== "m") return "";
  const wt = mapGet(osc, `WTOsc${index}`);
  if (!wt || wt.k !== "m") return "";
  const pp = paramsOf(wt);
  if (!pp) return "";
  const menu = nodeStr(mapGet(pp, "kParamWarpMenu2"));
  return menu && menu !== "kNoWarp" ? menu.replace(/^k/, "") : "";
}

function readFxList(root: CMap): Study["fx"] {
  const rack = mapGet(root, "FXRack0");
  if (!rack || rack.k !== "m") return [];
  const chain = mapGet(rack, "FX");
  if (!chain || chain.k !== "a") return [];
  const out: Study["fx"] = [];
  for (const item of chain.v) {
    if (item.k !== "m") continue;
    const typeId = nodeNum(mapGet(item, "type"));
    if (typeId == null) continue;
    const mixRaw = nodeNum(mapGet(item, "kUIParamMixOrGain"));
    const mix = mixRaw == null ? null : Math.round(clamp(mixRaw <= 1.5 ? mixRaw * 100 : mixRaw, 0, 100));
    out.push({ typeId, label: FX_LABEL[typeId] ?? `FX ${typeId}`, mix });
    if (out.length >= 8) break;
  }
  return out;
}

function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, 12);
}

function summarize(meta: Record<string, unknown>, root: CMap): Study {
  const name = String(meta.presetName || nodeStr(mapGet(root, "presetName")) || "Bez jména");
  const author = String(meta.presetAuthor || nodeStr(mapGet(root, "presetAuthor")) || "");
  const description = String(meta.presetDescription || "");
  const osc = [readOsc(root, 0), readOsc(root, 1), readOsc(root, 2)] as Study["osc"];
  const filters = [readFilter(root, 0), readFilter(root, 1)] as Study["filters"];
  const lfos = [readLfo(root, 0), readLfo(root, 1)] as Study["lfos"];
  const fx = readFxList(root);
  const archetype = guessArchetype({ osc, filters, lfos, fx });
  const sub = mapGet(root, "Oscillator4");
  const subParams = sub?.k === "m" ? paramsOf(sub) : null;
  const subVol = numAt(subParams, "kParamVolume", -1);
  const subOct = numAt(subParams, "kParamOctave", 0);
  const noise = mapGet(root, "Oscillator3");
  const noiseVol = noise?.k === "m" ? numAt(paramsOf(noise), "kParamVolume", -1) : -1;
  const tables = [0, 1, 2].map((index) => tableName(root, index)).filter(Boolean);
  const second = [0, 1, 2]
    .map((index) => {
      const name2 = warp2(root, index);
      return name2 ? `${["A", "B", "C"][index]} ${name2}` : "";
    })
    .filter(Boolean);
  const mods = readMods(root);
  const aUntouched = untouched(root, "Oscillator0");
  const notes = [
    `${name}${author ? ` · ${author}` : ""}. Nejblíž receptu ${archetype}, ale matrix je ze souboru.`,
    aUntouched
      ? `A nechává factory default, soubor ho nepřepisuje. B oct ${osc[1].octave}, level ${Math.round(osc[1].volume * 100)}%.`
      : `A oct ${osc[0].octave} uni ${osc[0].unison} det ${Math.round(osc[0].detune * 100)}% warp ${osc[0].warp ?? "žádný"}. B oct ${osc[1].octave} warp ${osc[1].warp ?? "žádný"}.`,
    second.length ? `Druhý warp: ${second.join(", ")}.` : "Druhý warp preset nepřepisuje.",
    tables.length ? `Tabulky: ${tables.join(" · ")}.` : "Tabulka je init Default Shapes.",
    subVol >= 0
      ? `Sub osc, ne osc C: level ${Math.round(subVol * 100)}%${subParams && mapGet(subParams, "kParamOctave") ? `, oktáva ${subOct}` : ", oktávu nechává na defaultu"}.`
      : "Sub osc preset nepřepisuje.",
    noiseVol > 0.02 ? `Noise level ${Math.round(noiseVol * 100)}%.` : "Noise je potichu nebo default.",
    mods.length ? mods.slice(0, 6).join(" · ") : "Matrix je prázdná.",
    fx.length ? `FX: ${fx.map((item) => item.label).join(" → ")}.` : "Bez insert FX.",
    "Hod nechá matrix, tabulku a Sub osc v souboru. Mění jen slyšený oscilátory, filtr a LFO rate.",
  ];
  return {
    name: name.slice(0, 80),
    author: author.slice(0, 64),
    tags: strList(meta.tags),
    description: description.slice(0, 400),
    archetype,
    osc,
    filters,
    lfos,
    fx,
    notes,
  };
}

function nudge(node: CNode, rng: Rng, variation: number, depth = 0) {
  if (variation <= 0 || depth > 14) return;
  if (node.k === "a") {
    for (const child of node.v) nudge(child, rng, variation, depth + 1);
    return;
  }
  if (node.k !== "m") return;
  for (const [key, child] of node.v) {
    const spec = typeof key === "string" ? NUDGE[key] : undefined;
    if (spec && (child.k === "f" || child.k === "i") && child.v <= spec[3]) {
      const next = clamp(child.v + (rng() * 2 - 1) * spec[0] * variation, spec[1], spec[2]);
      child.v = child.k === "i" ? Math.round(next) : next;
    } else {
      nudge(child, rng, variation, depth + 1);
    }
  }
}

function setUnit(pp: CMap, key: string, value: number, max: number) {
  const cur = nodeNum(mapGet(pp, key));
  if (cur != null && cur > max) return;
  setFloat(pp, key, value);
}

function applyHeard(
  root: CMap,
  osc: [OscPatch, OscPatch, OscPatch],
  filters: [FilterPatch, FilterPatch],
  lfos: [LfoPatch, LfoPatch],
) {
  osc.forEach((item, i) => {
    const mod = mapGet(root, `Oscillator${i}`);
    if (!mod || mod.k !== "m") return;
    const pp = plainParams(mod);
    setUnit(pp, "kParamOctave", item.octave, 8);
    setUnit(pp, "kParamVolume", item.volume, 1.5);
    setUnit(pp, "kParamUnison", item.unison, 16);
    setUnit(pp, "kParamDetune", item.detune, 1.5);
    setUnit(pp, "kParamUnisonStereo", item.stereo, 1.5);
    setUnit(pp, "kParamEnable", item.enable, 1.5);
    const wt = mapGet(mod, `WTOsc${i}`);
    if (wt?.k === "m") {
      const wpp = plainParams(wt);
      setUnit(wpp, "kParamTablePos", item.tablePos, 1.5);
      if (item.warp) setStr(wpp, "kParamWarpMenu", item.warp);
    }
  });
  filters.forEach((item, i) => {
    const mod = mapGet(root, `VoiceFilter${i}`);
    if (!mod || mod.k !== "m") return;
    const pp = plainParams(mod);
    setStr(pp, "kParamType", item.type);
    setUnit(pp, "kParamFreq", item.freq, 1.5);
    setUnit(pp, "kParamReso", item.reso, 100);
    setUnit(pp, "kParamDrive", item.drive, 100);
    setUnit(pp, "kParamEnable", item.enable, 1.5);
  });
  lfos.forEach((item, i) => {
    const mod = mapGet(root, `LFO${i}`);
    if (!mod || mod.k !== "m") return;
    const pp = plainParams(mod);
    const cur = nodeNum(mapGet(pp, "kParamRate"));
    if (cur == null || cur <= 1.5) {
      setStr(pp, "kParamMode", item.mode);
      setFloat(pp, "kParamRate", item.rate);
    }
  });
}

function wrap(meta: Record<string, unknown>, cbor: Uint8Array, version: number) {
  const compressed = zstdCompressSync(cbor);
  meta.hash = createHash("md5").update(compressed).digest("hex");
  const metaBytes = Buffer.from(JSON.stringify(meta));
  const head = Buffer.alloc(8);
  head.writeBigUInt64LE(BigInt(metaBytes.length));
  const size = Buffer.alloc(4);
  size.writeUInt32LE(cbor.length);
  const ver = Buffer.alloc(4);
  ver.writeUInt32LE(version);
  return Buffer.concat([MAGIC, head, metaBytes, size, ver, compressed]);
}

export function inspectBytes(bytes: Buffer): Study {
  const { meta, root } = openPreset(bytes);
  return summarize(meta, root);
}

export function varyBytes(
  bytes: Buffer,
  spec: {
    seed: number;
    variation: number;
    name: string;
    osc: [OscPatch, OscPatch, OscPatch];
    filters: [FilterPatch, FilterPatch];
    lfos: [LfoPatch, LfoPatch];
  },
) {
  const { meta, version, root } = openPreset(bytes);
  const seed = Number.isFinite(spec.seed) ? Math.abs(Math.trunc(spec.seed)) % 2147483647 : 1;
  nudge(root, mulberry32(seed || 1), clamp(spec.variation, 0, 1));
  applyHeard(root, spec.osc, spec.filters, spec.lfos);
  const name = spec.name.slice(0, 80);
  setStr(root, "presetName", name);
  meta.presetName = name;
  const file = wrap(meta, encodeCbor(root), version);
  return { base64: file.toString("base64"), bytes: file.length, hash: String(meta.hash), name };
}
