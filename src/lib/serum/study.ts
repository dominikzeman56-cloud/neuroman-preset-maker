import type { ArchetypeId, FilterPatch, FxNode, LfoPatch, OscPatch, Patch } from "./types";

export type FxRead = { typeId: number; label: string; mix: number | null };

export type Study = {
  name: string;
  author: string;
  tags: string[];
  description: string;
  archetype: ArchetypeId;
  osc: [OscPatch, OscPatch, OscPatch];
  filters: [FilterPatch, FilterPatch];
  lfos: [LfoPatch, LfoPatch];
  fx: FxRead[];
  notes: string[];
};

export type SampleRead = {
  name: string;
  seconds: number;
  centroidHz: number;
  sub: number;
  body: number;
  mid: number;
  air: number;
  modHz: number;
  crest: number;
  width: number;
};

export function blankOsc(enable = 0): OscPatch {
  return { octave: 0, volume: 0, unison: 1, detune: 0, stereo: 0, enable, warp: null, tablePos: 0 };
}

export function studyToPatch(study: Study): Patch {
  const fx: FxNode[] = study.fx.slice(0, 8).map((item) => ({
    typeId: item.typeId,
    label: item.label,
    mix: item.mix,
    params: { kParamEnable: 1 },
  }));
  return {
    name: study.name || "Import",
    author: study.author,
    tags: study.tags.slice(0, 12),
    blurb: study.description || study.notes[0] || "",
    archetype: study.archetype,
    seed: 1,
    variation: 0,
    osc: study.osc,
    filters: study.filters,
    lfos: study.lfos,
    fx,
    job: study.notes[0] ?? "Rozbor nahraného presetu.",
    checks: study.notes.slice(0, 9),
  };
}

export function guessArchetype(study: Pick<Study, "osc" | "filters" | "lfos" | "fx">): ArchetypeId {
  const [a, b, c] = study.osc;
  const flt = study.filters[0];
  const lfo = study.lfos[0].rate;
  const warp = `${a.warp ?? ""} ${b.warp ?? ""}`;
  const fx = study.fx.map((item) => item.label).join(" ");
  if (c.volume > 0.7 && a.volume < 0.25 && b.volume < 0.25) return "bounce";
  if (a.octave >= 0 && (fx.includes("Chorus") || a.stereo > 0.45)) return "pad";
  if (warp.includes("FM") && a.unison <= 3) return "tech";
  if (a.detune > 0.2 && b.detune > 0.15 && lfo < 0.25 && flt.reso < 40) return "reese";
  if (lfo >= 0.35 || (flt.reso >= 24 && flt.freq < 0.35)) return lfo < 0.28 ? "hybrid" : "growl";
  if (a.detune > 0.08 && b.enable > 0.5) return "reese";
  return "hybrid";
}

export function guessSample(read: SampleRead): ArchetypeId {
  if (read.centroidHz < 250 && read.mid < 0.25 && read.air < 0.15) return "bounce";
  if (read.centroidHz > 1600 && read.width > 0.32 && read.sub < 0.35) return "pad";
  if (read.modHz >= 4 && read.modHz <= 16 && read.mid > 0.25) return "growl";
  if (read.air > 0.28 && read.centroidHz > 1100) return "tech";
  if (read.modHz < 3.2 && read.mid > 0.2) return "reese";
  return "hybrid";
}
