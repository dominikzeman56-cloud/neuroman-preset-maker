import { createHash } from "node:crypto";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import {
  asMap,
  decodeCbor,
  encodeCbor,
  mapGet,
  plainParams,
  setFloat,
  setInt,
  setStr,
  type CMap,
  type CNode,
} from "./cbor";
import { TEMPLATE_B64 } from "./template";
import type { FxNode, Patch, VoicePatch } from "./types";

/** Frame counts taken from presets that already reference these tables. No embedded audio. */
const TABLE_FRAMES: Record<string, number> = {
  "S2 Tables/Default Shapes.wav": 18432,
  "S2 Tables/Analog/AT Plaits Wavetable.wav": 16384,
  "Analog/PWM MG.wav": 139264,
};

const MAGIC = Buffer.from("XferJson\0");

const FX_MOD = [
  "FXDistortion",
  "FXFlanger",
  "FXPhaser",
  "FXChorus",
  "FXDelay",
  "FXComp",
  "FXReverb",
  "FXEQ",
  "FXFilter",
  "FXHyperD",
  "FXBode",
  "FXConv",
  "FXUtils",
  "FXSplit",
  "FXSplit3",
  "FXSplitMS",
];

function loadTemplate() {
  const blob = Buffer.from(TEMPLATE_B64, "base64");
  if (!blob.subarray(0, 9).equals(MAGIC)) throw new Error("Template magic mismatch");
  let pos = 9;
  const metaLen = Number(blob.readBigUInt64LE(pos));
  pos += 8;
  const meta = JSON.parse(blob.subarray(pos, pos + metaLen).toString("utf8")) as Record<string, unknown>;
  pos += metaLen;
  pos += 4;
  const version = blob.readUInt32LE(pos);
  pos += 4;
  const cbor = zstdDecompressSync(blob.subarray(pos));
  return { meta, version, root: asMap(decodeCbor(cbor), "preset") };
}

function mustMap(parent: CMap, key: string) {
  const node = mapGet(parent, key);
  if (!node) throw new Error(`Missing ${key}`);
  return asMap(node, key);
}

function fxItem(node: FxNode): CMap {
  const pp: CMap = { k: "m", v: [] };
  for (const [key, value] of Object.entries(node.params)) {
    if (typeof value === "string") setStr(pp, key, value);
    else setFloat(pp, key, value);
  }
  const mod: CMap = { k: "m", v: [["plainParams", pp]] };
  const item: CMap = {
    k: "m",
    v: [
      ["type", { k: "i", v: node.typeId }],
      [FX_MOD[node.typeId] ?? "FXDistortion", mod],
    ],
  };
  if (node.mix != null) setFloat(item, "kUIParamMixOrGain", node.mix);
  node.chains?.forEach((chain, index) => {
    const arr: CNode = { k: "a", v: chain.map(fxItem) };
    item.v.push([`chain${index + 1}`, arr]);
    setFloat(item, `kParamModuleCount${index + 1}`, chain.length);
  });
  return item;
}

function apply(root: CMap, patch: Patch) {
  patch.osc.forEach((osc, i) => {
    const mod = mustMap(root, `Oscillator${i}`);
    const pp = plainParams(mod);
    setFloat(pp, "kParamOctave", osc.octave);
    setFloat(pp, "kParamVolume", osc.volume);
    setFloat(pp, "kParamUnison", osc.unison);
    setFloat(pp, "kParamDetune", osc.detune);
    setFloat(pp, "kParamUnisonStereo", osc.stereo);
    setFloat(pp, "kParamEnable", osc.enable);
    const wt = mapGet(mod, `WTOsc${i}`);
    if (wt && wt.k === "m") {
      const wpp = plainParams(wt);
      setFloat(wpp, "kParamTablePos", osc.tablePos);
      if (osc.warp) setStr(wpp, "kParamWarpMenu", osc.warp);
      if (osc.warp2) setStr(wpp, "kParamWarpMenu2", osc.warp2);
      if (osc.warpAmount != null) setFloat(wpp, "kParamWarp", osc.warpAmount);
      if (osc.warp2Amount != null) setFloat(wpp, "kParamWarp2", osc.warp2Amount);
      if (osc.phase != null) setFloat(wpp, "kParamRandomPhase", osc.phase);
      const frames = osc.table ? TABLE_FRAMES[osc.table] : undefined;
      if (osc.table && frames) {
        setStr(wt, "relativePathToWT", osc.table);
        setInt(wt, "numFrames", frames);
        setInt(wt, "numChannels", 1);
        setInt(wt, "sampleRate", 44100);
      }
    }
  });

  patch.filters.forEach((flt, i) => {
    const pp = plainParams(mustMap(root, `VoiceFilter${i}`));
    setStr(pp, "kParamType", flt.type);
    setFloat(pp, "kParamFreq", flt.freq);
    setFloat(pp, "kParamReso", flt.reso);
    setFloat(pp, "kParamDrive", flt.drive);
    setFloat(pp, "kParamEnable", flt.enable);
    if (flt.wet != null) setFloat(pp, "kParamWet", flt.wet);
  });

  patch.lfos.forEach((lfo, i) => {
    const pp = plainParams(mustMap(root, `LFO${i}`));
    setStr(pp, "kParamMode", lfo.mode);
    setFloat(pp, "kParamRate", lfo.rate);
    setFloat(pp, "kParamDefaultMode", lfo.mode === "Envelope" ? 0 : 1);
    if (lfo.sync != null) setFloat(pp, "kParamBeatSync", lfo.sync);
  });

  applyVoice(root, patch.voice);

  const rack = mustMap(root, "FXRack0");
  const chain: CNode = { k: "a", v: patch.fx.map(fxItem) };
  const fxIdx = rack.v.findIndex((e) => e[0] === "FX");
  if (fxIdx >= 0) rack.v[fxIdx][1] = chain;
  else rack.v.push(["FX", chain]);

  setStr(root, "presetName", patch.name);
  setStr(root, "presetAuthor", patch.author);
  const tags: CNode = { k: "a", v: patch.tags.map((tag) => ({ k: "s", v: tag })) };
  const tagIdx = root.v.findIndex((e) => e[0] === "tags");
  if (tagIdx >= 0) root.v[tagIdx][1] = tags;
  else root.v.push(["tags", tags]);
}

function setSource(slot: CMap, id: number) {
  const node: CNode = {
    k: "a",
    v: [
      { k: "i", v: id },
      { k: "i", v: 0 },
    ],
  };
  const index = slot.v.findIndex((entry) => entry[0] === "source");
  if (index >= 0) slot.v[index][1] = node;
  else slot.v.push(["source", node]);
}

function applyVoice(root: CMap, voice: VoicePatch | undefined) {
  if (!voice) return;
  const global = plainParams(mustMap(root, "Global0"));
  if (voice.mono != null) setFloat(global, "kParamMonoToggle", voice.mono ? 1 : 0);
  if (voice.legato != null) setFloat(global, "kParamLegato", voice.legato ? 1 : 0);
  if (voice.porta != null) setFloat(global, "kParamPortamentoTime", voice.porta);
  if (voice.busDest != null) setFloat(global, "kParamFXBus1Dest", voice.busDest);
  if (voice.busVol != null) setFloat(global, "kParamFXBus1Vol", voice.busVol);

  if (voice.subVolume != null || voice.subOctave != null || voice.subEnable != null) {
    const sub = plainParams(mustMap(root, "Oscillator4"));
    if (voice.subVolume != null) setFloat(sub, "kParamVolume", voice.subVolume);
    if (voice.subOctave != null) setFloat(sub, "kParamOctave", voice.subOctave);
    if (voice.subEnable != null) setFloat(sub, "kParamEnable", voice.subEnable);
  }

  for (const macro of voice.macros ?? []) {
    const mod = mustMap(root, `Macro${macro.index}`);
    if (macro.name) setStr(mod, "name", macro.name);
    if (macro.value != null) setFloat(plainParams(mod), "kParamValue", macro.value);
  }

  for (const [index, route] of (voice.mods ?? []).entries()) {
    if (index > 63) break;
    const slot = mustMap(root, `ModSlot${index}`);
    setInt(slot, "destModuleID", route.destId);
    setInt(slot, "destModuleParamID", route.destParamId);
    setStr(slot, "destModuleParamName", route.destParam);
    setStr(slot, "destModuleTypeString", route.destType);
    const params = plainParams(slot);
    setFloat(params, "kParamAmount", route.amount);
    if (route.bipolar != null) setFloat(params, "kParamBipolar", route.bipolar);
    setSource(slot, route.source);
  }

  if (voice.routeFilter) {
    setStr(plainParams(mustMap(root, "RoutingSlot1")), "kParamRoutingDest", "kRoutingDestFilter");
  }
  if (voice.busLevel != null) {
    const route = plainParams(mustMap(root, "RoutingSlot2"));
    setFloat(route, "kParamFXBus1Level", voice.busLevel);
    setStr(route, "kParamRoutingDest", "kRoutingDestNone");
  }
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

export function encodePatch(patch: Patch) {
  const { meta, version, root } = loadTemplate();
  apply(root, patch);
  meta.presetName = patch.name;
  meta.presetAuthor = patch.author;
  meta.tags = patch.tags;
  meta.presetDescription = patch.blurb;
  const file = wrap(meta, encodeCbor(root), version);
  return {
    base64: file.toString("base64"),
    bytes: file.length,
    hash: String(meta.hash),
    name: patch.name,
  };
}
