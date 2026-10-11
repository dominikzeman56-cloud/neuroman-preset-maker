import type { ArchetypeId, FilterPatch, FxNode, LfoPatch, ModRoute, OscPatch, VoicePatch } from "./types";

/**
 * Recipes follow npos-v2 knowledge (2026-08), not the older
 * preset_archetypes.py centers where they conflict:
 * distortion before EQ, sub stays mono.
 * Pyth and Reese 3 copy the Pyth BS files: Fine matrix, Sub osc, mono.
 * Controlled bass ids from BLUEPRINT §3, plus the Skullstep build sheet.
 */
export type Archetype = {
  id: ArchetypeId;
  name: string;
  short: string;
  code: string;
  job: string;
  checks: string[];
  tags: string[];
  layers: [string, string, string];
  osc: [OscPatch, OscPatch, OscPatch];
  filters: [FilterPatch, FilterPatch];
  lfos: [LfoPatch, LfoPatch];
  fx: FxNode[];
  voice?: VoicePatch;
};

function osc(
  octave: number,
  volume: number,
  unison: number,
  detune: number,
  warp: string | null,
  tablePos = 0.15,
  stereo = 0,
  enable = 1,
): OscPatch {
  return { octave, volume, unison, detune, stereo, enable, warp, tablePos };
}

function flt(type: string, freq: number, reso: number, drive: number, enable = 1): FilterPatch {
  return { type, freq, reso, drive, enable };
}

function fx(
  typeId: number,
  label: string,
  mix: number | null,
  params: Record<string, number | string>,
  chains?: FxNode[][],
): FxNode {
  return { typeId, label, mix, params: { kParamEnable: 1, ...params }, chains };
}

/** destParamId is the integer stored next to the param name. Only ids seen in the Pyth files. */
function mod(
  source: number,
  destType: string,
  destId: number,
  destParam: string,
  destParamId: number,
  amount: number,
  bipolar?: number,
): ModRoute {
  return { source, destType, destId, destParam, destParamId, amount, ...(bipolar == null ? {} : { bipolar }) };
}

const dist = (mode: string, drive: number, wet: number, mix: number, extra: Record<string, number> = {}) =>
  fx(0, "Distortion", mix, { kParamMode: mode, kParamDrive: drive, kParamWet: wet, ...extra });

const eq = (f1: number, g1: number, f2: number, g2: number) =>
  fx(7, "EQ", null, {
    kParamFreq1: f1,
    kParamGain1: g1,
    kParamReso1: 48,
    kParamFreq2: f2,
    kParamGain2: g2,
    kParamReso2: 48,
  });

export const ARCHETYPES: Archetype[] = [
  {
    id: "growl",
    name: "Grid Growl",
    short: "Growl",
    code: "grid-locked-filter-growl",
    job: "Pohyb je na mřížce, ne z detune. Filtr nese growl, distortion až po něm, EQ řeže bláto a nezvedá fundament před saturací.",
    checks: [
      "LFO v Seru syncni na 1/8 nebo 1/16. Off-grid rate z toho udělá reese.",
      "Sub mono, unison 1. Šířka patří tělu, ne pod 250 Hz.",
      "EQ je až za distortion. Boost fundamentu před saturací ti zabije sub.",
      "Když je to generic, nejdřív uber layer. Noise až když sub a body sedí.",
    ],
    tags: ["Neurofunk", "Growl", "Bass", "Grid"],
    layers: ["Body", "Movement", "Sub"],
    osc: [
      osc(-1, 0.82, 3, 0.1, "kBendPos", 0.3, 0.18),
      osc(-1, 0.62, 1, 0.04, "kFM_OSC", 0.55, 0.12),
      osc(-2, 0.7, 1, 0, null, 0, 0),
    ],
    filters: [flt("MgL24", 0.16, 32, 8), flt("BandReject", 0.35, 12, 0, 0)],
    lfos: [
      { mode: "Free", rate: 0.5 },
      { mode: "Envelope", rate: 0.7 },
    ],
    fx: [
      fx(8, "Filter", 75, { kParamType: "MgL24", kParamFreq: 0.22, kParamReso: 28, kParamDrive: 4 }),
      dist("kSoftClip", 36, 48, 42, { kParamNumStages: 2 }),
      eq(280, -3, 3200, 2),
    ],
  },
  {
    id: "reese",
    name: "Detuned Reese",
    short: "Reese",
    code: "detuned-unison-reese",
    job: "Dva sawy, jemný detune proti sobě, phase na startu stejná. Pohyb je beating, ne LFO. Distortion, pak filtr, pak EQ.",
    checks: [
      "Unison nech na 1. Reese tady jsou dva oscilátory, ne hromada hlasů.",
      "Detune je jemný. Semitonový posun už není ten beating. Random phase nech 0.",
      "Chorus na reese rozbije mono. Šířku, když vůbec, až po tom, co střed sedí.",
      "Sub přidej potichu a znova zkontroluj pohyb. Hlasitý čistý sub beating srovná.",
      "Po distortion neboostuj fundament. Řez 200–400 Hz je až za saturací.",
    ],
    tags: ["Neurofunk", "Reese", "Bass"],
    layers: ["Saw A", "Saw B", "Sub"],
    osc: [
      osc(-1, 0.8, 1, 0.06, "kBendPos", 0.08, 0.28),
      osc(-1, 0.8, 1, 0.16, "kBendNeg", 0.08, 0.28),
      osc(-2, 0.42, 1, 0, null, 0, 0),
    ],
    filters: [flt("MgL18", 0.2, 14, 4), flt("MgL12", 0.45, 6, 0, 0)],
    lfos: [
      { mode: "Free", rate: 0.06 },
      { mode: "Free", rate: 0.11 },
    ],
    fx: [
      dist("kOverdrive", 30, 42, 48),
      fx(8, "Filter", 62, { kParamType: "MgL18", kParamFreq: 0.18, kParamReso: 12, kParamDrive: 2 }),
      eq(240, -3.5, 1800, 1),
    ],
  },
  {
    id: "hybrid",
    name: "Slow Growl",
    short: "Slow",
    code: "slow-grid-growl",
    job: "Stejná growl kostra, pomalejší mřížka. Tmavší cutoff, míň FM, pořád mono sub.",
    checks: [
      "Rate drž u 1/4 nebo pomalé 1/8. Není to ambient LFO.",
      "Míň resonance než u grid growlu, ať dlouhá nota nemaskuje kick.",
      "Body a movement nesmí hrát stejně nahlas celou frázi.",
      "EQ po distortion, řez low-mid, žádný pre-boost.",
    ],
    tags: ["Neurofunk", "Growl", "Bass", "Slow"],
    layers: ["Body", "Movement", "Sub"],
    osc: [
      osc(-1, 0.8, 2, 0.08, "kBendPosNeg", 0.22, 0.14),
      osc(-1, 0.5, 1, 0.03, "kFM_SUB", 0.4, 0.08),
      osc(-2, 0.68, 1, 0, null, 0, 0),
    ],
    filters: [flt("MgL24", 0.09, 22, 6), flt("LH12", 0.28, 10, 0, 0)],
    lfos: [
      { mode: "Free", rate: 0.18 },
      { mode: "Envelope", rate: 0.4 },
    ],
    fx: [
      fx(8, "Filter", 68, { kParamType: "MgL24", kParamFreq: 0.12, kParamReso: 18, kParamDrive: 3 }),
      dist("kDiode1", 26, 40, 36),
      eq(300, -3, 2500, 1.5),
    ],
  },
  {
    id: "tech",
    name: "FM Body",
    short: "FM",
    code: "fm-distorted-body",
    job: "Kovové tělo z FM, ne z unisonu. Distortion reaguje na FM, textura je až druhý oscilátor, sub jde mimo FM.",
    checks: [
      "Unison 1. Šířka z FM poměru, ne z osmi hlasů.",
      "FM nepouštěj do sub oscilátoru.",
      "Distortion až na FM těle. Fundament před tím nezvedej.",
      "Když fráze polyká snare, uber texturu, nepřidávej další EQ pásmo.",
    ],
    tags: ["Neurofunk", "FM", "Bass"],
    layers: ["FM body", "Texture", "Sub"],
    osc: [
      osc(0, 0.74, 1, 0.04, "kFM_OSC", 0.58, 0.16),
      osc(0, 0.4, 1, 0.02, "kFM_NOISE", 0.7, 0.22),
      osc(-2, 0.66, 1, 0, null, 0, 0),
    ],
    filters: [flt("CombP", 0.32, 24, 6), flt("BandReject", 0.42, 18, 0, 0)],
    lfos: [
      { mode: "Envelope", rate: 0.62 },
      { mode: "Free", rate: 0.28 },
    ],
    fx: [
      dist("kHardClip", 34, 50, 40),
      fx(8, "Filter", 60, { kParamType: "BandReject", kParamFreq: 0.38, kParamReso: 20, kParamDrive: 4 }),
      eq(360, -2.5, 5500, 2),
    ],
  },
  {
    id: "bounce",
    name: "Clean Sub",
    short: "Sub",
    code: "clean-sub-sine",
    job: "Jen fundament. Žádný distortion, žádná šířka. Tělo a pohyb jsou vypnuté, dokud sub nesedí s kickem.",
    checks: [
      "Nejdřív tenhle layer sám proti kicku. Sidechain 2–4 dB, nebo srovnej pitch.",
      "Nic pod 250 Hz nesmí být stereo.",
      "Gate na 1/16 patří na reese, ne sem. Hladkej sub, jinak zmizí spodek.",
      "Slabý bass neopravuj dalším oscilátorem. Nejdřív hlasitost a mono.",
      "Až sub drží, teprve přidej body z jiného archetypu.",
    ],
    tags: ["Neurofunk", "Sub", "Bass"],
    layers: ["Off", "Off", "Sub"],
    osc: [
      osc(-1, 0, 1, 0, null, 0, 0, 0),
      osc(0, 0, 1, 0, null, 0, 0, 0),
      osc(-1, 0.9, 1, 0, null, 0, 0),
    ],
    filters: [flt("MgL12", 0.35, 0, 0, 0), flt("MgL12", 0.5, 0, 0, 0)],
    lfos: [
      { mode: "Envelope", rate: 0.5 },
      { mode: "Free", rate: 0 },
    ],
    fx: [eq(180, -1, 4000, 0)],
  },
  {
    id: "pad",
    name: "Overlay Chords",
    short: "Chords",
    code: "serum-overlay-chords",
    job: "Akordy nad bassem, ne druhý bass. Šířka, chorus, žádná saturace fundamentu. Volá a bass odpovídá.",
    checks: [
      "Hrají nad body. Když lezou do 150–400 Hz, uber je, neřež celý mix.",
      "Bez distortion. Saturace akordů se slepí s reese.",
      "Sidechain na kick stačí 1–3 dB.",
      "Role je answer / hook, ne continuous wall.",
    ],
    tags: ["Neurofunk", "Chords", "Overlay"],
    layers: ["Chord", "Chord", "Low"],
    osc: [
      osc(0, 0.55, 4, 0.2, "kPWM", 0.4, 0.7),
      osc(1, 0.48, 4, 0.2, "kBendPos", 0.5, 0.7),
      osc(-1, 0.12, 1, 0, null, 0, 0),
    ],
    filters: [flt("MgL12", 0.52, 6, 0), flt("LadderEMS", 0.6, 4, 0, 0)],
    lfos: [
      { mode: "Free", rate: 0.05 },
      { mode: "Free", rate: 0.08 },
    ],
    fx: [
      fx(3, "Chorus", 36, {
        kParamRate: 0.35,
        kParamDepth: 28,
        kParamFeedback: 10,
        kParamFiltMode: 1,
        kParamFilt: 6000,
        kParamWet: 36,
      }),
      fx(9, "Dimension", 22, { kParamDimEWet: 18, kParamDimESize: 16, kParamWet: 22 }),
      eq(220, -3, 7000, 1),
    ],
  },
  {
    id: "skull",
    name: "Skullstep Lead",
    short: "Skull",
    code: "skullstep-rave-lead",
    job: "Rave lead ze starého build sheetu. Saw unison, HP chorus, distortion, EQ až po něm, splitter na delay a verb.",
    checks: [
      "Level oscilátorů je 0 — otevři je obálkou. Mod matrix se pořád nezapisuje.",
      "Chorus je high-pass, ať lead nesedí na subu.",
      "EQ až za distortion. Split ~900 Hz: dole sucho, nahoře delay a verb.",
      "Není to bass patch. Sub osc nech potichu, nebo ho vypni.",
    ],
    tags: ["Lead", "Rave", "Skullstep", "DnB"],
    layers: ["Saw A", "Saw B", "Sub"],
    osc: [
      osc(-1, 0, 3, 0.38, "kBendPosNeg", 0.1, 0),
      osc(-1, 0, 3, 0.38, "kPWM", 0.18, 0),
      osc(-2, 0, 1, 0, null, 0, 0),
    ],
    filters: [flt("LH12", 0.05, 4, 5), flt("MgL12", 0.4, 0, 0, 0)],
    lfos: [
      { mode: "Envelope", rate: 0.8 },
      { mode: "Envelope", rate: 0.8 },
    ],
    fx: [
      fx(3, "Chorus", 30, {
        kParamFiltMode: 1,
        kParamFilt: 20000,
        kParamDepth: 10,
        kParamRate: 0.5,
        kParamWet: 25,
      }),
      fx(9, "Dimension", 4, { kParamDimEWet: 4, kParamDimESize: 4, kParamWet: 4 }),
      dist("kSoftClip", 80, 100, 28, { kParamNumStages: 3 }),
      eq(300, -3, 8000, 2),
      fx(13, "Split L/H", null, { kParamFreq: 900 }, [
        [],
        [
          fx(4, "Delay", 50, {
            kParamBeatSync: 1,
            kParamTimeL: 0.25,
            kParamTimeR: 0.25,
            kParamFeedback: 20,
            kParamMode: 1,
            kParamWet: 40,
          }),
          fx(6, "Reverb", 30, {
            kParamType: "kVintage",
            kParamSize: 50,
            kParamWet: 30,
            kParamFeedback: 50,
            kParamWidth: 50,
          }),
        ],
      ]),
    ],
  },
  {
    id: "lpreese",
    name: "LP Reese",
    short: "LP",
    code: "abis-lowpass-reese",
    job: "Z Abis Bass 01: dva sawy, jemný detune, pak lehká saturace a tmavý low-pass. Moody intro, ne drop.",
    checks: [
      "Pohyb je pomalý LFO na cutoff. Namapuj ho v Seru, retrigger nech vypnutý.",
      "Reverb jen náznak. Ať low-pass reese nezablátí intro.",
      "EQ řeže pod saturací, fundament před distortion nezvedej.",
      "Sub potichu. Hlasitý sine ten beating srovná.",
    ],
    tags: ["Reese", "Intro", "Abis", "Bass"],
    layers: ["Saw A", "Saw B", "Sub"],
    osc: [
      osc(-1, 0.74, 1, 0.05, "kBendPos", 0.1, 0.16),
      osc(-1, 0.74, 1, 0.12, "kBendNeg", 0.1, 0.16),
      osc(-2, 0.36, 1, 0, null, 0, 0),
    ],
    filters: [flt("MgL24", 0.1, 8, 2), flt("MgL12", 0.4, 0, 0, 0)],
    lfos: [
      { mode: "Free", rate: 0.08 },
      { mode: "Free", rate: 0.04 },
    ],
    fx: [
      dist("kOverdrive", 18, 30, 32),
      fx(8, "Filter", 70, { kParamType: "MgL24", kParamFreq: 0.1, kParamReso: 8, kParamDrive: 0 }),
      eq(180, -2, 2400, 0),
      fx(6, "Reverb", 12, { kParamType: "kVintage", kParamSize: 35, kParamWet: 12, kParamFeedback: 20, kParamWidth: 20 }),
    ],
  },
  {
    id: "wtneuro",
    name: "WT Neuro",
    short: "WT",
    code: "abis-wavetable-neuro",
    job: "Z Abis Bass 01, druhý průchod: pozice wavetable, FM z druhého oscilátoru, sub o oktávu níž, distortion mírnější než growl.",
    checks: [
      "Init šablona má Default Shapes, ne MB triangle. Až nahraješ svůj preset, wavetable zůstane jeho.",
      "LFO na cutoff nespouštěj znovu s každou notou.",
      "Sub je -1, ne další FM oscilátor.",
      "OTT a chorus na basu nech stranou. Chorus phasuje low end.",
    ],
    tags: ["Neuro", "Wavetable", "Abis", "Bass"],
    layers: ["WT", "FM", "Sub"],
    osc: [
      osc(-1, 0.78, 3, 0.16, "kFM_OSC", 0.42, 0.22),
      osc(-1, 0.42, 1, 0.04, "kFM_SUB", 0.55, 0.08),
      osc(-1, 0.58, 1, 0, null, 0, 0),
    ],
    filters: [flt("MgL18", 0.22, 20, 4), flt("BandReject", 0.4, 10, 0, 0)],
    lfos: [
      { mode: "Free", rate: 0.36 },
      { mode: "Envelope", rate: 0.5 },
    ],
    fx: [
      dist("kSoftClip", 24, 40, 36),
      fx(8, "Filter", 64, { kParamType: "MgL18", kParamFreq: 0.24, kParamReso: 18, kParamDrive: 2 }),
      eq(260, -2.5, 4200, 1.5),
    ],
  },
  {
    id: "warm",
    name: "Warm Body",
    short: "Warm",
    code: "mefjus-warm-body",
    job: "Ze zápisků k Mefjusovi: nejdřív čistý sub, teplé tělo, jemná saturace. Pohyb filtrem, ne křikem.",
    checks: [
      "V mixu počítej se 3–4 vrstvami. Tenhle patch je jen sub a body.",
      "Saturace je dioda, potichu, až za filtrem.",
      "Dokud sub není čistý a mono, nepřidávej noise.",
      "Agresivnější growl je jiný recept. Tady vyhraje teplo.",
    ],
    tags: ["Bass", "Warm", "Mefjus", "Sub"],
    layers: ["Body", "Air", "Sub"],
    osc: [
      osc(-1, 0.7, 2, 0.08, "kBendPos", 0.2, 0.12),
      osc(0, 0.22, 1, 0.02, "kPWM", 0.35, 0.1),
      osc(-2, 0.78, 1, 0, null, 0, 0),
    ],
    filters: [flt("MgL12", 0.18, 10, 2), flt("LH12", 0.4, 4, 0, 0)],
    lfos: [
      { mode: "Free", rate: 0.14 },
      { mode: "Envelope", rate: 0.3 },
    ],
    fx: [
      fx(8, "Filter", 55, { kParamType: "MgL12", kParamFreq: 0.2, kParamReso: 10, kParamDrive: 0 }),
      dist("kDiode1", 16, 28, 30),
      eq(240, -2, 1800, 1),
    ],
  },
  {
    id: "noise",
    name: "FM Noise",
    short: "Noise",
    code: "noisia-fm-noise",
    job: "Ze zápisků k Noisia: čistý sub, FM tělo, noise jako hrana, víc než jedna saturace. Sub se do špíny nemíchá.",
    checks: [
      "Noise osc nech pod tělem. Je to hrana, ne základ.",
      "Sub mono a bez FM.",
      "Druhá saturace je filtr s drive, ne další EQ boost.",
      "Tohle není kopie jejich presetu. Je to postup z poznámek.",
    ],
    tags: ["FM", "Noise", "Noisia", "Bass"],
    layers: ["FM", "Noise", "Sub"],
    osc: [
      osc(0, 0.7, 1, 0.03, "kFM_OSC", 0.62, 0.1),
      osc(0, 0.28, 1, 0, "kFM_NOISE", 0.5, 0.18),
      osc(-2, 0.64, 1, 0, null, 0, 0),
    ],
    filters: [flt("CombP", 0.28, 26, 8), flt("BandReject", 0.45, 14, 0, 0)],
    lfos: [
      { mode: "Envelope", rate: 0.55 },
      { mode: "Free", rate: 0.22 },
    ],
    fx: [
      dist("kHardClip", 28, 44, 34),
      dist("kDiode1", 18, 30, 28),
      fx(8, "Filter", 58, { kParamType: "CombP", kParamFreq: 0.3, kParamReso: 22, kParamDrive: 6 }),
      eq(320, -2, 6000, 1.5),
    ],
  },
  {
    id: "roar",
    name: "Phenom Roar",
    short: "Roar",
    code: "phenom-roar",
    job: "Phenom, Serum 2, 174 BPM. Dva sawy, unison 4, width 0, detune 0.17 a 0.15. Tohle je ten slušnej synth. Roar je až pitch obálka, a tu soubor neumí.",
    checks: [
      "Random phase 0. Phase A ~64°, B ~180°. Phase se nezapisuje.",
      "Filter 2 přepni na Flg HL6+. Ten typ encoder nezná, proto je filtr vypnutý.",
      "Noise Fizz zapni ručně. Cutoff nad ním doladit, ve videu ‚at 8', reso ~20, drive ~50.",
      "LFO1 sync 1/2, retrig, na cutoff, amount ~20. Tvar náběh a pád, ne trojúhelník z Initu.",
      "FX filtr Phs 48L6+, cutoff ~60, reso ~36, drive ~30. Typ se nezapisuje.",
      "LFO2 Envelope → Main Tuning, 3 semitóny, rate 1/4, tvar nahoru a hned dolů. Opačný tvar je nuda. Matrix se nezapisuje.",
      "Delay: ping-pong, obě strany 1/4 triplet, freq ~1 kHz, mix 10. V souboru je sync delay, triplet přepni.",
      "Hall je ve videu Crystal Hall, decay 3 s, size 30, mix 10. IR se do presetu nevloží.",
    ],
    tags: ["Neuro", "Lead", "Phenom", "Roar"],
    layers: ["Saw A", "Saw B", "Off"],
    osc: [
      osc(0, 0.8, 4, 0.17, null, 0, 0),
      osc(0, 0.8, 4, 0.15, null, 0, 0),
      osc(0, 0, 1, 0, null, 0, 0, 0),
    ],
    filters: [flt("H12", 0.62, 20, 50), flt("MgL12", 0.4, 0, 0, 0)],
    lfos: [
      { mode: "Free", rate: 0.5 },
      { mode: "Envelope", rate: 0.25 },
    ],
    fx: [
      dist("kSoftClip", 30, 100, 40, { kParamNumStages: 3 }),
      fx(4, "Delay", 10, {
        kParamBeatSync: 1,
        kParamTimeL: 0.25,
        kParamTimeR: 0.25,
        kParamFeedback: 8,
        kParamMode: 1,
        kParamWet: 10,
      }),
      fx(6, "Reverb", 10, { kParamType: "kVintage", kParamSize: 30, kParamWet: 10, kParamFeedback: 20, kParamWidth: 40 }),
    ],
  },
  {
    id: "pyth",
    name: "Pythius Reese",
    short: "Pyth",
    code: "pythius-reese",
    job: "Pyth BS Reese 2. Dva oscilátory na -2, detune 0, Default Shapes. Rozejití dělá Macro 1 na Fine, A −100 a B +100. Macro sedí na 23.",
    checks: [
      "Macro 1 → Fine, A −100 a B +100. Macro v souboru je na 23. Detune i unison jsou na nule.",
      "Macro 2 roztáhne pan A a B do protisměru, jen pár procent.",
      "Note vede frekvenci FX filtru. To je tracking, ne LFO.",
      "Hlas je notch N24. Na print: Hyper, Asymmetric drive 75, Phase 24+, multiband. Na bounce Hyper spadne.",
      "Sub osc je v souboru, level 56 %, oktávu nechává na defaultu. Mono, legato, portamento 0.066.",
      "Reese 3 je chip vedle. Plaits a PWM, Bend − / Bend +. Neslepovat.",
    ],
    tags: ["Reese", "Pythius", "Bass"],
    layers: ["Saw A", "Saw B", "Off"],
    osc: [
      { ...osc(-2, 1, 1, 0, null, 0, 0), phase: 0, table: "S2 Tables/Default Shapes.wav" },
      { ...osc(-2, 1, 1, 0, null, 0, 0), phase: 0, table: "S2 Tables/Default Shapes.wav" },
      osc(0, 0, 1, 0, null, 0, 0, 0),
    ],
    filters: [flt("N24", 0.45, 31.9, 30.76), flt("MgL12", 0.5, 0, 0, 0)],
    lfos: [
      { mode: "Free", rate: 0.06 },
      { mode: "Free", rate: 0.04 },
    ],
    fx: [
      fx(9, "Hyper", null, { kParamDimESize: 25, kParamDimEWet: 17, kParamWet: 19 }),
      fx(0, "Distortion", null, { kParamMode: "kAsym", kParamDrive: 74.8 }),
      fx(8, "Filter", null, { kParamType: "Phase24P", kParamFreq: 0.258, kParamReso: 39, kParamDrive: 49.8 }),
      fx(5, "Comp", null, { kParamMultiband: 1, kParamThresh: 0.19, kParamMakeup: 5.5, kParamGain0: 4.6, kParamGain2: 2.9 }),
    ],
    voice: {
      mono: true,
      legato: true,
      porta: 0.066256,
      subVolume: 0.5625,
      routeFilter: true,
      macros: [
        { index: 0, name: "Macro1", value: 23.4255 },
        { index: 1, name: "Macro2" },
      ],
      mods: [
        mod(25, "Oscillator", 0, "kParamFine", 5, -100),
        mod(25, "Oscillator", 1, "kParamFine", 5, 100),
        mod(17, "FXFilter", 2, "kParamFreq", 3, 17.82),
        mod(26, "Oscillator", 0, "kParamPan", 2, -6.528),
        mod(26, "Oscillator", 1, "kParamPan", 2, 7.449),
      ],
    },
  },
  {
    id: "pyth3",
    name: "Pythius Reese 3",
    short: "Reese 3",
    code: "pythius-reese-3",
    job: "Pyth BS Reese 3. Plaits Bend − a PWM MG Bend +. Rozejití dělá LFO 1 na warp, ne detune.",
    checks: [
      "A je AT Plaits, Bend −. B je PWM MG na pozici 66, Bend +. Druhej warp je v souboru.",
      "LFO 1 vede warp A a warp 2 na B. Note zvedá rate LFO 1. To je tracking.",
      "LFO 1 na EQ gain 2 je bipolární. Tichej sine na osc C se do souboru nepeče.",
      "Filtr je Phase 24−, hodně reso a drive. Řetěz: Hyper, EQ, Asymmetric, EQ, multiband.",
      "Sub osc oktáva −1 naplno. Mono, legato, portamento 0.141.",
      "Neslepovat s Pyth. Tam rozejití dělá Macro na Fine a tabulka je Default Shapes.",
    ],
    tags: ["Reese", "Pythius", "Bass"],
    layers: ["Plaits", "PWM", "Off"],
    osc: [
      {
        ...osc(-2, 1, 1, 0, "kBendNeg", 0, 0),
        phase: 0,
        table: "S2 Tables/Analog/AT Plaits Wavetable.wav",
      },
      {
        ...osc(-2, 1, 1, 0, null, 66.2398, 0),
        phase: 0,
        warp2: "kBendPos",
        warpAmount: 0.3579,
        table: "Analog/PWM MG.wav",
      },
      osc(0, 0, 1, 0, null, 0, 0, 0),
    ],
    filters: [{ ...flt("Phase24N", 0.7767, 94.58, 97.32), wet: 54.22 }, flt("MgL12", 0.5, 0, 0, 0)],
    lfos: [
      { mode: "Free", rate: 0, sync: 0 },
      { mode: "Free", rate: 0, sync: 0 },
    ],
    fx: [
      fx(9, "Hyper", null, { kParamUnison: 4, kParamDimESize: 5.49, kParamDimEWet: 18.41, kParamWet: 28.28 }),
      fx(7, "EQ", null, { kParamFreq1: 1362, kParamGain1: 1.75, kParamReso1: 38.98, kParamType1: 1 }),
      fx(7, "EQ", null, { kParamEnable: 0, kParamFreq1: 246, kParamGain1: 19.25 }),
      fx(0, "Distortion", null, { kParamMode: "kAsym", kParamDrive: 100 }),
      fx(7, "EQ", null, { kParamFreq1: 136.2, kParamFreq2: 183.5, kParamGain1: 7.77, kParamReso1: 33.55 }),
      fx(5, "Comp", null, {
        kParamMultiband: 1,
        kParamThresh: 0.271,
        kParamMakeup: 3.52,
        kParamGain0: 5.39,
        kParamGain2: 3.43,
        kParamThreshUD0: 126.1,
        kParamThreshUD2: 128.1,
      }),
    ],
    voice: {
      mono: true,
      legato: true,
      porta: 0.140551,
      subVolume: 1,
      subOctave: -1,
      routeFilter: true,
      busLevel: 100,
      busDest: 1,
      busVol: 0.4487,
      mods: [
        mod(6, "WTOsc", 0, "kParamWarp", 0, 71.467),
        mod(17, "LFO", 0, "kParamRate", 0, 92.65),
        mod(6, "WTOsc", 1, "kParamWarp2", 3, 55.363),
        mod(6, "FXEQ", 4, "kParamGain2", 6, 44.812, 1),
        mod(6, "WTOsc", 2, "kParamWarp", 0, -100),
      ],
    },
  },
  {
    id: "fund",
    name: "Burr Fundament",
    short: "Fund",
    code: "burr-fundament",
    job: "Burr Oak. Jeden oscilátor, unison 1. Harmonická řada 2× 3× 4× vzniká ze dvou saturací, ne z dalších vrstev.",
    checks: [
      "Žádný unison stack. Jeden fundament, ať se vrstvy neperou o stejný pásmo.",
      "Nejdřív měkká saturace, potom tvrdší. Jeden drive to neudělá.",
      "Filtr nad harmonikama, ať to nezůstane tenké. Pohyb pomalý, ne 1/16 wobble.",
      "Sub, když ho přidáš, ať je potichu a mono. Fundament už basu nese.",
    ],
    tags: ["Growl", "Burr Oak", "Bass"],
    layers: ["Fund", "Off", "Off"],
    osc: [
      osc(-1, 0.86, 1, 0.02, null, 0, 0),
      osc(0, 0, 1, 0, null, 0, 0, 0),
      osc(0, 0, 1, 0, null, 0, 0, 0),
    ],
    filters: [flt("MgL24", 0.34, 8, 4), flt("MgL12", 0.5, 0, 0, 0)],
    lfos: [
      { mode: "Free", rate: 0.1 },
      { mode: "Envelope", rate: 0.22 },
    ],
    fx: [
      dist("kSoftClip", 18, 36, 40),
      dist("kHardClip", 16, 28, 32),
      eq(200, -2, 1400, 1),
    ],
  },
  {
    id: "pluck",
    name: "Breakdown Pluck",
    short: "Pluck",
    code: "tactics-pluck",
    job: "TR Tactics, breakdown. Krátkej saw pluck, unison 2. Mezi notama musí být ticho. Není to bass.",
    checks: [
      "Amp a filtr: attack 0, decay ~150–200 ms, sustain skoro 0. Obálku namapuj, soubor ji nekreslí.",
      "Cutoff začíná otevřený a sjede dolů. Jas kolem 2.5–3 kHz, ne growl.",
      "OSC B jen jako tichej vršek. Default Shapes není sine, frame přepni ručně.",
      "Delay a room dej na send v DAW, ne do basovýho řetězu. V dropu send vysuš.",
      "Noty: rozloženej mollovej kvintakord, zhruba jedna na dobu. Ne 16tinovej běh.",
    ],
    tags: ["Pluck", "Arp", "Breakdown"],
    layers: ["Saw", "Top", "Off"],
    osc: [
      osc(0, 0.72, 2, 0.1, null, 0, 0.12),
      osc(1, 0.22, 1, 0, null, 0.5, 0),
      osc(0, 0, 1, 0, null, 0, 0, 0),
    ],
    filters: [flt("MgL24", 0.58, 6, 0), flt("MgL12", 0.4, 0, 0, 0)],
    lfos: [
      { mode: "Envelope", rate: 0.72 },
      { mode: "Envelope", rate: 0.55 },
    ],
    fx: [eq(350, -2, 8000, 1)],
  },
  {
    id: "gate",
    name: "Gated Reese",
    short: "Gate",
    code: "prolix-gate",
    job: "Prolix a Don't Play. Dva sawy, unison 3, detune proti sobě. Groove dělá gate na 1/16, ne melodie subu.",
    checks: [
      "Random phase 0. Fine pár centů, ať vlny nezačínaj jako jedna.",
      "LFO na level, sync 1/16, hloubka 15–25 %, mode Trigger. Druhej LFO 1/4 na cutoff. Matrix se nezapisuje.",
      "Gate dej na tenhle reese. Clean Sub nech hladkej, jinak zmizí spodek.",
      "Filtr je high-pass, ať sub zůstane na svým tracku. Key track zapni v Seru.",
      "U 172 BPM je 1/16 zhruba 11.5 Hz. Off-grid rate z toho udělá jinej pohyb.",
    ],
    tags: ["Reese", "Gate", "Prolix", "Bass"],
    layers: ["Saw A", "Saw B", "Off"],
    osc: [
      osc(-1, 0.76, 3, 0.1, null, 0, 0.08),
      osc(-1, 0.76, 3, 0.18, null, 0, 0.08),
      osc(0, 0, 1, 0, null, 0, 0, 0),
    ],
    filters: [flt("H12", 0.22, 16, 4), flt("MgL12", 0.4, 0, 0, 0)],
    lfos: [
      { mode: "Free", rate: 0.62 },
      { mode: "Free", rate: 0.36 },
    ],
    fx: [
      dist("kSoftClip", 26, 40, 36),
      eq(220, -3, 2200, 2),
    ],
  },
];

export function getArchetype(id: ArchetypeId) {
  const found = ARCHETYPES.find((a) => a.id === id);
  if (!found) throw new Error(`Unknown archetype ${id}`);
  return found;
}
