import { getArchetype } from "./archetypes";
import type { ArchetypeId, FilterPatch, FxNode, OscPatch, Patch, VoicePatch } from "./types";

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

function varyAround(rng: Rng, base: number, span: number, variation: number) {
  const noise = (rng() * 2 - 1) * span * variation;
  return base + noise;
}

function varyOsc(rng: Rng, osc: OscPatch, variation: number): OscPatch {
  const silent = osc.enable < 0.5 || osc.volume === 0;
  const unisonLocked = osc.unison <= 1;
  const stereoLocked = osc.stereo === 0;
  const detuneLocked = osc.detune === 0;
  return {
    ...osc,
    octave: osc.octave,
    volume: silent ? osc.volume : round6(clamp(varyAround(rng, osc.volume, 0.05, variation), 0, 1)),
    unison: unisonLocked ? 1 : clamp(Math.round(varyAround(rng, osc.unison, 1, variation)), 1, 8),
    detune: detuneLocked ? 0 : round6(clamp(varyAround(rng, osc.detune, 0.04, variation), 0, 0.45)),
    stereo: stereoLocked ? 0 : round6(clamp(varyAround(rng, osc.stereo, 0.06, variation), 0, 1)),
    tablePos:
      silent || osc.tablePos > 1
        ? osc.tablePos
        : round6(clamp(varyAround(rng, osc.tablePos, 0.04, variation), 0, 1)),
  };
}

function varyFilter(rng: Rng, flt: FilterPatch, variation: number): FilterPatch {
  if (flt.enable < 0.5) return flt;
  return {
    ...flt,
    freq: round6(clamp(varyAround(rng, flt.freq, 0.04, variation), 0, 1)),
    reso: round6(clamp(varyAround(rng, flt.reso, 3, variation), 0, 100)),
    drive: round6(clamp(varyAround(rng, flt.drive, 3, variation), 0, 100)),
  };
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

const FROZEN = new Set([
  "kParamEnable",
  "kParamMultiband",
  "kParamBeatSync",
  "kParamFiltMode",
  "kParamMode",
  "kParamDefaultMode",
]);

/** Space and tone-balance stay on the recipe. Seed only nudges grit and the filter. */
const MOVABLE_FX = new Set([0, 8]);

function varyParam(rng: Rng, key: string, value: number, variation: number) {
  if (FROZEN.has(key)) {
    rng();
    return value;
  }
  if (key === "kParamNumStages") {
    return clamp(Math.round(varyAround(rng, value, 1, variation)), 1, 4);
  }
  const next = varyAround(rng, value, Math.abs(value) * 0.1 + 0.5, variation);
  if (key === "kParamFreq" || key === "kParamFilt" || key === "kParamFreq1" || key === "kParamFreq2") {
    if (value > 2) return clamp(next, 40, 20000);
    return clamp(next, 0, 1);
  }
  if (key === "kParamGain1" || key === "kParamGain2") return clamp(next, -18, 18);
  if (key === "kParamTimeL" || key === "kParamTimeR" || key === "kParamThresh") return clamp(next, 0, 1);
  return clamp(next, 0, 100);
}

function varyFx(rng: Rng, node: FxNode, variation: number): FxNode {
  const chains = node.chains?.map((chain) => chain.map((child) => varyFx(rng, child, variation)));
  if (!MOVABLE_FX.has(node.typeId)) return chains ? { ...node, chains } : node;
  const params: Record<string, number | string> = {};
  for (const key of Object.keys(node.params).sort()) {
    const value = node.params[key];
    if (typeof value === "number") params[key] = round6(varyParam(rng, key, value, variation));
    else params[key] = value;
  }
  const mix = node.mix == null ? null : clamp(varyAround(rng, node.mix, 6, variation), 0, 100);
  return {
    ...node,
    mix: mix == null ? null : round6(mix),
    params,
    chains,
  };
}

function round6(n: number) {
  return Math.round(n * 1e6) / 1e6;
}

function cloneVoice(voice: VoicePatch | undefined): VoicePatch | undefined {
  if (!voice) return undefined;
  return {
    ...voice,
    macros: voice.macros?.map((item) => ({ ...item })),
    mods: voice.mods?.map((item) => ({ ...item })),
  };
}

export function varyPatch(base: Patch, seed: number, variation: number): Patch {
  const v = clamp(variation, 0, 1);
  const safeSeed = Number.isFinite(seed) ? Math.abs(Math.trunc(seed)) % 2147483647 : 1;
  const rng = mulberry32(safeSeed || 1);
  const osc = base.osc.map((o) => varyOsc(rng, o, v)) as Patch["osc"];
  const filters = base.filters.map((f) => varyFilter(rng, f, v)) as Patch["filters"];
  const fx = base.fx.map((item) => varyFx(rng, item, v));
  const idx = 1000 + Math.floor(rng() * 9000);
  const stem = base.name.replace(/ #\d+$/, "");
  return {
    ...base,
    name: `${stem} #${idx}`.slice(0, 80),
    tags: [...base.tags],
    checks: [...base.checks],
    seed: safeSeed,
    variation: v,
    osc,
    filters,
    lfos: base.lfos.map((l) => ({ ...l })) as Patch["lfos"],
    fx,
    voice: cloneVoice(base.voice),
  };
}

export function generatePatch(archetype: ArchetypeId, seed: number, variation: number): Patch {
  const base = getArchetype(archetype);
  return varyPatch(
    {
      name: base.name,
      author: "NeuroMan",
      tags: [...base.tags],
      blurb: base.job,
      archetype,
      seed: 1,
      variation: 0,
      osc: base.osc,
      filters: base.filters,
      lfos: base.lfos.map((l) => ({ ...l })) as Patch["lfos"],
      fx: base.fx,
      job: base.job,
      checks: [...base.checks],
      voice: base.voice,
    },
    seed,
    variation,
  );
}
