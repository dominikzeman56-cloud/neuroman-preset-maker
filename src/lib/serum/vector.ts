import type { FxNode, Patch } from "./types";

export const WARP_MENUS = [
  "kPD_OSC",
  "kSync",
  "kBendPos",
  "kPD_SUB",
  "kDistTube",
  "kFM_OSC",
  "kFM_SUB",
  "kPWM",
  "kDistSoftSat",
  "kFM_OSC2",
  "kBendNeg",
  "kBendPosNeg",
  "kPD_OSC2",
  "kFM_NOISE",
  "kAM_OSC",
] as const;

export const FILTER_TYPES = [
  "MgL18",
  "MgL24",
  "LadderEMS",
  "H24",
  "LadderMg",
  "H12",
  "LadderAcid",
  "H18",
  "MgL6",
  "Diffuser",
  "DirtyMg",
  "LH12",
  "Comb2",
  "Reverb1",
  "CombP",
  "L24",
  "Wsp",
  "BandReject",
  "L18",
  "ExpBPF",
] as const;

export const WARP_LABEL: Record<string, string> = {
  kPD_OSC: "PD osc",
  kSync: "Sync",
  kBendPos: "Bend +",
  kPD_SUB: "PD sub",
  kDistTube: "Tube",
  kFM_OSC: "FM osc",
  kFM_SUB: "FM sub",
  kPWM: "PWM",
  kDistSoftSat: "Soft sat",
  kFM_OSC2: "FM osc 2",
  kBendNeg: "Bend −",
  kBendPosNeg: "Bend ±",
  kPD_OSC2: "PD osc 2",
  kFM_NOISE: "FM noise",
  kAM_OSC: "AM",
};

const NUM_OSC = 3;
const NUM_FILTERS = 2;
const MAX_FX = 6;
const PER_OSC = 5 + WARP_MENUS.length + 1;
const PER_FILTER = 4 + FILTER_TYPES.length + 1;
const PER_FX = 17 + 3;

export const VECTOR_DIM = NUM_OSC * PER_OSC + NUM_FILTERS * PER_FILTER + MAX_FX * PER_FX;

function norm(val: number, lo: number, hi: number) {
  if (hi === lo) return 0;
  return Math.min(1, Math.max(0, (val - lo) / (hi - lo)));
}

function oneHot(value: string | null | undefined, vocab: readonly string[]) {
  const slot = new Array<number>(vocab.length + 1).fill(0);
  const idx = value ? vocab.indexOf(value) : -1;
  slot[idx >= 0 ? idx : vocab.length] = 1;
  return slot;
}

function fxDrive(fx: FxNode) {
  const d = fx.params.kParamDrive;
  return typeof d === "number" ? d : 0;
}
function fxWet(fx: FxNode) {
  const w = fx.params.kParamWet;
  if (typeof w === "number") return w;
  return fx.mix ?? 0;
}
function fxFreq(fx: FxNode) {
  const f = fx.params.kParamFreq;
  return typeof f === "number" ? f : 0;
}

/** Same layout as neuroman/tools/feature_vector.py (233 floats). */
export function toFeatureVector(patch: Patch): number[] {
  const vec: number[] = [];
  for (const osc of patch.osc) {
    vec.push(
      norm(osc.octave, -3, 3),
      norm(osc.volume, 0, 1),
      norm(osc.unison, 1, 16),
      norm(osc.detune, 0, 1),
      norm(osc.enable, 0, 1),
      ...oneHot(osc.warp, WARP_MENUS),
    );
  }
  for (const flt of patch.filters) {
    vec.push(
      norm(flt.freq, 0, 1),
      norm(flt.reso, 0, 100),
      norm(flt.drive, 0, 100),
      norm(flt.enable, 0, 1),
      ...oneHot(flt.type, FILTER_TYPES),
    );
  }
  for (let i = 0; i < MAX_FX; i++) {
    const fx = patch.fx[i];
    if (!fx) {
      const empty = new Array<number>(17).fill(0);
      empty[16] = 1;
      vec.push(...empty, 0, 0, 0);
      continue;
    }
    const type = new Array<number>(17).fill(0);
    if (fx.typeId >= 0 && fx.typeId < 16) type[fx.typeId] = 1;
    else type[16] = 1;
    vec.push(
      ...type,
      norm(fxDrive(fx), 0, 100),
      norm(fxWet(fx), 0, 100),
      norm(fxFreq(fx), 0, 1),
    );
  }
  if (vec.length !== VECTOR_DIM) throw new Error(`vector ${vec.length} != ${VECTOR_DIM}`);
  return vec;
}
