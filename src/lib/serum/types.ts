export const ARCHETYPE_IDS = [
  "growl",
  "reese",
  "hybrid",
  "tech",
  "bounce",
  "pad",
  "skull",
  "lpreese",
  "wtneuro",
  "warm",
  "noise",
  "roar",
  "pyth",
  "pyth3",
  "fund",
  "pluck",
  "gate",
] as const;

export type ArchetypeId = (typeof ARCHETYPE_IDS)[number];

export type OscPatch = {
  octave: number;
  volume: number;
  unison: number;
  detune: number;
  stereo: number;
  enable: number;
  warp: string | null;
  tablePos: number;
  /** Second warp menu. Serum stores it as kParamWarpMenu2. */
  warp2?: string | null;
  /**
   * Static kParamWarp. On a lone second warp (Reese 3 osc B) this is the Bend+ amount,
   * not a first-warp knob.
   */
  warpAmount?: number;
  /** Static kParamWarp2, only when the file stores it beside both warp menus. */
  warp2Amount?: number;
  /** Relative wavetable path. Encoder accepts only tables that exist in the local Tables folder. */
  table?: string;
  /** kParamRandomPhase. Reese writes 0 so the two saws are not free-running. */
  phase?: number;
};

export type FilterPatch = {
  type: string;
  freq: number;
  reso: number;
  drive: number;
  enable: number;
  wet?: number;
};

export type LfoPatch = {
  mode: "Envelope" | "Free";
  rate: number;
  /** kParamBeatSync. 0 is free-running, which Reese 3 stores explicitly. */
  sync?: number;
};

export type ModRoute = {
  source: number;
  destType: string;
  destId: number;
  destParam: string;
  destParamId: number;
  amount: number;
  bipolar?: number;
};

export type MacroKnob = {
  index: number;
  value?: number;
  name?: string;
};

export type VoicePatch = {
  mono?: boolean;
  legato?: boolean;
  porta?: number;
  subVolume?: number;
  /** Absent means leave the Sub osc octave on Serum's default. Reese 2 does that. */
  subOctave?: number;
  subEnable?: number;
  macros?: MacroKnob[];
  mods?: ModRoute[];
  routeFilter?: boolean;
  busLevel?: number;
  busDest?: number;
  busVol?: number;
};

export type FxNode = {
  typeId: number;
  label: string;
  mix: number | null;
  params: Record<string, number | string>;
  chains?: FxNode[][];
};

export type Patch = {
  name: string;
  author: string;
  tags: string[];
  blurb: string;
  archetype: ArchetypeId;
  seed: number;
  variation: number;
  osc: [OscPatch, OscPatch, OscPatch];
  filters: [FilterPatch, FilterPatch];
  lfos: [LfoPatch, LfoPatch];
  fx: FxNode[];
  job: string;
  checks: string[];
  voice?: VoicePatch;
};
