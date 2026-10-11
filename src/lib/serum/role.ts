import { getArchetype } from "./archetypes";
import type { ArchetypeId, FxNode, Patch, VoicePatch } from "./types";

export type Destination = "bounce" | "print";

/** Flanger, phaser, chorus, delay, reverb, dimension. These bake into a resample. */
const SPACE = new Set([1, 2, 3, 4, 6, 9]);

const BOUNCE_LINE =
  "Tělo je suchý. Delay, hall, chorus a dimension v souboru nejsou — prostor až po resample.";
const PAIR_LINE =
  "Sub je druhej soubor, stejnej seed. V těle je vypnutej, ať se dva fundamenty nesčítaj.";

export function archetypeHasSub(id: ArchetypeId) {
  if (id === "bounce") return false;
  const sub = getArchetype(id).osc[2];
  return sub.enable > 0.5 && sub.volume >= 0.3;
}

export function stripSpace(nodes: FxNode[]): FxNode[] {
  const out: FxNode[] = [];
  for (const node of nodes) {
    if (SPACE.has(node.typeId)) continue;
    if (!node.chains) {
      out.push(node);
      continue;
    }
    const chains = node.chains.map((chain) => stripSpace(chain)).filter((chain) => chain.length > 0);
    if (chains.length === 0) continue;
    out.push({ ...node, chains });
  }
  return out;
}

function keptFxIndexes(nodes: FxNode[]) {
  const kept: number[] = [];
  nodes.forEach((node, index) => {
    if (SPACE.has(node.typeId)) return;
    if (!node.chains) {
      kept.push(index);
      return;
    }
    if (node.chains.some((chain) => stripSpace(chain).length > 0)) kept.push(index);
  });
  return kept;
}

function shapeVoice(voice: VoicePatch | undefined, paired: boolean, before: FxNode[], after: FxNode[]) {
  if (!voice) return undefined;
  let next = voice;
  if (paired && (voice.subVolume != null || voice.subEnable != null)) {
    next = { ...next, subVolume: 0, subEnable: 0 };
  }
  if (before === after || !next.mods?.length) return next;
  const nextIndex = new Map(keptFxIndexes(before).map((index, position) => [index, position]));
  const mods = next.mods.flatMap((route) => {
    if (!route.destType.startsWith("FX")) return [route];
    const destId = nextIndex.get(route.destId);
    if (destId == null) return [];
    return [{ ...route, destId }];
  });
  return { ...next, mods };
}

export function shapeBody(patch: Patch, destination: Destination, paired: boolean): Patch {
  let osc = patch.osc;
  if (paired) {
    osc = osc.map((item, index) =>
      index === 2 ? { ...item, enable: 0, volume: 0, stereo: 0, unison: 1, detune: 0 } : item,
    ) as Patch["osc"];
  }
  const notes = patch.checks
    .filter((line) => line !== BOUNCE_LINE && line !== PAIR_LINE)
    .map((line) =>
      destination === "bounce"
        ? line.replace(
            "V souboru je sync delay, triplet přepni.",
            "Na bounce delay v souboru není. Triplet patří až na send po resample.",
          )
        : line,
    );
  if (paired) notes.unshift(PAIR_LINE);
  const fx = destination === "bounce" ? stripSpace(patch.fx) : patch.fx;
  const voice = shapeVoice(patch.voice, paired, patch.fx, fx);
  if (destination === "bounce") {
    osc = osc.map((item) => ({ ...item, stereo: 0 })) as Patch["osc"];
    notes.unshift(BOUNCE_LINE);
    return { ...patch, osc, fx, checks: notes, voice };
  }
  return { ...patch, osc, checks: notes, voice };
}

export function makeSub(body: Patch): Patch {
  const base = getArchetype("bounce");
  const octave = body.osc[2].octave;
  const stem = body.name.replace(/ #\d+$/, "").replace(/ Sub$/, "");
  return {
    name: `${stem} Sub`.slice(0, 80),
    author: body.author || "NeuroMan",
    tags: ["Neurofunk", "Sub", "Bass"],
    blurb: "Fundament k tělu. Bez saturace, bez šířky.",
    archetype: "bounce",
    seed: body.seed,
    variation: 0,
    osc: [base.osc[0], base.osc[1], { ...base.osc[2], octave }],
    filters: base.filters.map((item) => ({ ...item })) as Patch["filters"],
    lfos: base.lfos.map((item) => ({ ...item })) as Patch["lfos"],
    fx: base.fx.map((item) => ({ ...item, params: { ...item.params } })),
    job: base.job,
    checks: [...base.checks],
  };
}
