import { useEffect, useMemo, useState } from "react";
import { Bookmark, Copy, Dices, Download } from "lucide-react";
import { LibraryPanel } from "@/components/library-panel";
import { ARCHETYPES, getArchetype } from "@/lib/serum/archetypes";
import { encodePreset, inspectPreset, varyPreset } from "@/lib/serum/api";
import { generatePatch, varyPatch } from "@/lib/serum/generate";
import { listSources, loadFile, removeSource, saveSource, type LibMeta } from "@/lib/serum/library";
import { analyzePcm, biasPatch } from "@/lib/serum/listen";
import { archetypeHasSub, makeSub, shapeBody, type Destination } from "@/lib/serum/role";
import { guessSample, studyToPatch } from "@/lib/serum/study";
import type { ArchetypeId, FilterPatch, FxNode, OscPatch, Patch } from "@/lib/serum/types";
import { FILTER_TYPES, VECTOR_DIM, WARP_LABEL, WARP_MENUS, toFeatureVector } from "@/lib/serum/vector";

const START_SEED = 17401;
const START_VAR = 0.35;
const BENCH_KEY = "neuroman.bench.v1";

const FAMILIES: { id: string; label: string; ids: ArchetypeId[] }[] = [
  { id: "body", label: "Tělo", ids: ["growl", "reese", "hybrid", "lpreese", "warm", "fund", "wtneuro", "bounce"] },
  { id: "edge", label: "Hrana", ids: ["tech", "noise", "roar", "pyth", "pyth3", "gate"] },
  { id: "other", label: "Mimo", ids: ["skull", "pad", "pluck"] },
];

function familyOf(id: ArchetypeId) {
  return FAMILIES.find((family) => family.ids.includes(id))?.id ?? "body";
}

type BenchItem = { id: string; patch: Patch };

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function slug(name: string) {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return s || "preset";
}

function sheetText(
  patch: Patch,
  bpm: string,
  key: string,
  destination: Destination,
  paired: boolean,
  uploaded: boolean,
) {
  const arch = getArchetype(patch.archetype);
  const oscLines = patch.osc
    .map((o, i) => {
      const warp = o.warp ? (WARP_LABEL[o.warp] ?? o.warp) : "default";
      const warp2 = o.warp2 ? `  warp2 ${WARP_LABEL[o.warp2] ?? o.warp2}` : "";
      const table = o.table ? `  ${o.table.split("/").pop()}` : "";
      const pos = o.tablePos > 1 ? `  pos ${Math.round(o.tablePos)}` : "";
      return `${arch.layers[i]}: oct ${o.octave}  uni ${o.unison}  det ${pct(o.detune)}  lvl ${pct(o.volume)}  warp ${warp}${warp2}${pos}${table}  enable ${o.enable}`;
    })
    .join("\n");
  const fx = patch.fx.map((f) => f.label).join(" → ") || "žádné";
  const subInside = (patch.voice?.subVolume ?? 0) > 0.05;
  return [
    `NEUROMAN  ${patch.name}`,
    `archetype: ${arch.code}`,
    `kam: ${uploaded ? "nahranej preset, řetěz beze změny" : destination === "bounce" ? "na bounce, suchý" : "s prostorem z receptu"}`,
    paired
      ? "sub: zvlášť soubor, stejnej seed"
      : subInside
        ? `sub osc: ${Math.round((patch.voice?.subVolume ?? 0) * 100)} % v tomhle souboru`
        : "sub: v tomhle souboru, nebo ho recept nemá",
    `bpm: ${bpm || "—"}   key: ${key || "—"}   seed: ${patch.seed}   variation: ${pct(patch.variation)}`,
    "",
    patch.job,
    "",
    oscLines,
    `Filter: ${patch.filters[0].type}  cut ${pct(patch.filters[0].freq)}  reso ${Math.round(patch.filters[0].reso)}`,
    `FX: ${fx}`,
    "",
    ...patch.checks.map((c) => `- ${c}`),
    "",
    patch.voice?.mods?.length
      ? "Matrix je v souboru. Charakter s ní nehýbe."
      : "Mod matrix se do souboru nezapisuje. LFO mód je uložený, cíl namapuj v Seru.",
  ].join("\n");
}

export function Maker() {
  const [seed, setSeed] = useState(START_SEED);
  const [variation, setVariation] = useState(START_VAR);
  const [destination, setDestination] = useState<Destination>("bounce");
  const [familyId, setFamilyId] = useState("body");
  const [raw, setRaw] = useState(() => generatePatch("growl", START_SEED, START_VAR));
  const [patch, setPatch] = useState(() => shapeBody(generatePatch("growl", START_SEED, START_VAR), "bounce", true));
  const [bpm, setBpm] = useState("174");
  const [musicKey, setMusicKey] = useState("Em");
  const [bench, setBench] = useState<BenchItem[]>([]);
  const [sources, setSources] = useState<LibMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(BENCH_KEY);
      if (raw) setBench(JSON.parse(raw) as BenchItem[]);
    } catch {
      /* ignore broken bench */
    }
    listSources()
      .then(setSources)
      .catch(() => setError("Knihovna v prohlížeči nejde otevřít."));
  }, []);

  const vector = useMemo(() => toFeatureVector(patch), [patch]);
  const arch = getArchetype(patch.archetype);
  const active = sources.find((item) => item.id === activeId) ?? null;
  const uploaded = active?.kind === "preset";
  const paired = !uploaded && archetypeHasSub(raw.archetype);
  const family = FAMILIES.find((item) => item.id === familyId) ?? FAMILIES[0];

  function freshSeed() {
    return Math.floor(Math.random() * 999983) + 1;
  }

  function commit(nextRaw: Patch, nextDest: Destination, fromUpload: boolean) {
    setRaw(nextRaw);
    setDestination(nextDest);
    setFamilyId(familyOf(nextRaw.archetype));
    setPatch(fromUpload ? nextRaw : shapeBody(nextRaw, nextDest, archetypeHasSub(nextRaw.archetype)));
    setError("");
    setNote("");
  }

  function roll(nextId = patch.archetype, nextSeed = seed, nextVar = variation, keepDest = true) {
    const safe = Number.isFinite(nextSeed) ? Math.abs(Math.trunc(nextSeed)) : START_SEED;
    const nextRaw = generatePatch(nextId, safe, nextVar);
    const nextDest: Destination = keepDest ? destination : archetypeHasSub(nextId) ? "bounce" : "print";
    setActiveId(null);
    setSeed(safe);
    commit(nextRaw, nextDest, false);
  }

  function rollActive(nextSeed: number, nextVar: number) {
    if (!active) {
      roll(patch.archetype, nextSeed, nextVar);
      return;
    }
    setSeed(nextSeed);
    setVariation(nextVar);
    if (active.kind === "preset") {
      commit(varyPatch(studyToPatch(active.study), nextSeed, nextVar), destination, true);
      return;
    }
    const guessed = biasPatch(generatePatch(guessSample(active.read), nextSeed, nextVar), active.read);
    commit(guessed, destination, false);
  }

  function pickDestination(next: Destination) {
    setDestination(next);
    if (uploaded) return;
    setPatch(shapeBody(raw, next, archetypeHasSub(raw.archetype)));
    setNote("");
  }

  function bufToB64(buf: ArrayBuffer) {
    const bytes = new Uint8Array(buf);
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(text);
  }

  async function ingest(files: FileList | null) {
    if (!files?.length) return;
    setError("");
    let lastId = "";
    for (const file of Array.from(files)) {
      const lower = file.name.toLowerCase();
      try {
        if (lower.endsWith(".serumpreset")) {
          if (file.size > 1_500_000) throw new Error(`${file.name} je nad 1.5 MB.`);
          const buf = await file.arrayBuffer();
          const study = await inspectPreset({ data: { base64: bufToB64(buf) } });
          const id = crypto.randomUUID();
          await saveSource({
            id,
            kind: "preset",
            name: study.name || file.name,
            author: study.author,
            added: Date.now(),
            study,
            file: buf,
          });
          lastId = id;
        } else if (file.type.startsWith("audio/") || /\.(wav|mp3|ogg|flac|aiff|aif|m4a)$/.test(lower)) {
          const ctx = new AudioContext();
          const audio = await ctx.decodeAudioData(await file.arrayBuffer());
          const left = audio.getChannelData(0);
          const right = audio.numberOfChannels > 1 ? audio.getChannelData(1) : null;
          const read = analyzePcm(left, right, audio.sampleRate, file.name.replace(/\.[^.]+$/, ""));
          await ctx.close();
          const id = crypto.randomUUID();
          await saveSource({ id, kind: "sample", name: read.name, added: Date.now(), read });
          lastId = id;
        } else {
          throw new Error(`${file.name} není preset ani audio.`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Soubor se nepodařilo přečíst.");
      }
    }
    const next = await listSources().catch(() => sources);
    setSources(next);
    if (lastId) pickSource(lastId, next);
  }

  function pickSource(id: string, list = sources) {
    const item = list.find((row) => row.id === id);
    if (!item) return;
    setActiveId(id);
    const next = freshSeed();
    setSeed(next);
    if (item.kind === "preset") {
      commit(varyPatch(studyToPatch(item.study), next, variation), destination, true);
      setNote(item.study.notes[0] ?? "");
      return;
    }
    const guessed = biasPatch(generatePatch(guessSample(item.read), next, variation), item.read);
    const nextDest: Destination = archetypeHasSub(guessed.archetype) ? "bounce" : "print";
    commit(guessed, nextDest, false);
    setNote(`${item.read.centroidHz} Hz, pohyb ${item.read.modHz} Hz.`);
  }

  async function dropSource(id: string) {
    await removeSource(id);
    if (activeId === id) setActiveId(null);
    setSources(await listSources());
  }

  function updateOsc(index: number, partial: Partial<OscPatch>) {
    setPatch((p) => {
      const osc = p.osc.map((o, i) => (i === index ? { ...o, ...partial } : o)) as Patch["osc"];
      return { ...p, osc };
    });
  }

  function updateFilter(index: number, partial: Partial<FilterPatch>) {
    setPatch((p) => {
      const filters = p.filters.map((f, i) => (i === index ? { ...f, ...partial } : f)) as Patch["filters"];
      return { ...p, filters };
    });
  }

  function updateFx(index: number, partial: Partial<FxNode>) {
    setPatch((p) => ({
      ...p,
      fx: p.fx.map((f, i) => (i === index ? { ...f, ...partial } : f)),
    }));
  }

  function saveBench() {
    const item: BenchItem = { id: `${patch.seed}-${patch.name}`, patch };
    const next = [item, ...bench.filter((b) => b.id !== item.id)].slice(0, 8);
    setBench(next);
    localStorage.setItem(BENCH_KEY, JSON.stringify(next));
    setNote("Uložené v tomhle prohlížeči.");
  }

  async function downloadTarget(target: Patch, fromUpload: boolean) {
    setBusy(true);
    setError("");
    try {
      const fromFile = fromUpload && active?.kind === "preset" ? await loadFile(active.id) : null;
      const res = fromFile
        ? await varyPreset({
            data: {
              base64: bufToB64(fromFile),
              seed: target.seed,
              variation: target.variation,
              name: target.name,
              osc: target.osc,
              filters: target.filters,
              lfos: target.lfos,
            },
          })
        : await encodePreset({ data: target });
      const bin = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bin], { type: "application/octet-stream" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug(target.name)}.SerumPreset`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      setNote(fromFile ? `${res.bytes} B · variace nahraného presetu` : `${res.bytes} B · Serum 2`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Soubor se nepodařilo složit.");
    } finally {
      setBusy(false);
    }
  }

  async function copySheet() {
    const text = sheetText(patch, bpm, musicKey, destination, paired, Boolean(uploaded));
    try {
      await navigator.clipboard.writeText(text);
      setNote("Sheet je ve schránce.");
    } catch {
      setNote(text);
    }
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-bg pb-28 text-fg">
      <header className="border-b border-line px-4 py-4 md:px-6">
        <div className="mx-auto flex max-w-5xl flex-col gap-1 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-mono text-xs tracking-widest text-acid">SERUM 2</p>
            <h1 className="text-2xl font-semibold tracking-tight">NEUROMAN</h1>
          </div>
          <p className="text-sm text-muted md:max-w-xs md:text-right">Sub a tělo jsou dva soubory. Na resample je tělo suchý.</p>
        </div>
      </header>

      <main className="mx-auto grid max-w-5xl gap-4 px-4 py-4 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] md:px-6">
        <LibraryPanel
          items={sources}
          activeId={activeId}
          onFiles={(files) => void ingest(files)}
          onPick={(id) => pickSource(id)}
          onRemove={(id) => void dropSource(id)}
        />
        <section className="flex min-w-0 flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={uploaded}
              onClick={() => pickDestination("bounce")}
              className={
                destination === "bounce"
                  ? "min-h-11 rounded-md border border-acid bg-acid-dim px-3 py-2 text-left disabled:opacity-50"
                  : "min-h-11 rounded-md border border-line bg-surface px-3 py-2 text-left disabled:opacity-50"
              }
            >
              <span className="block text-sm font-semibold">Na bounce</span>
              <span className="block text-xs text-muted">suchý zdroj</span>
            </button>
            <button
              type="button"
              disabled={uploaded}
              onClick={() => pickDestination("print")}
              className={
                destination === "print"
                  ? "min-h-11 rounded-md border border-acid bg-acid-dim px-3 py-2 text-left disabled:opacity-50"
                  : "min-h-11 rounded-md border border-line bg-surface px-3 py-2 text-left disabled:opacity-50"
              }
            >
              <span className="block text-sm font-semibold">S prostorem</span>
              <span className="block text-xs text-muted">recept jak je</span>
            </button>
          </div>

          <div className="flex gap-2">
            {FAMILIES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFamilyId(item.id)}
                className={
                  item.id === familyId
                    ? "min-h-11 flex-1 rounded-md border border-acid bg-acid-dim px-2 text-sm font-semibold"
                    : "min-h-11 flex-1 rounded-md border border-line bg-surface px-2 text-sm"
                }
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="flex w-full min-w-0 gap-2 overflow-x-auto pb-1">
            {family.ids.map((id) => {
              const a = ARCHETYPES.find((item) => item.id === id);
              if (!a) return null;
              const on = a.id === patch.archetype && !uploaded;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => roll(a.id, seed, variation, false)}
                  className={
                    on
                      ? "min-h-11 shrink-0 rounded-md border border-acid bg-acid-dim px-3 py-2 text-left"
                      : "min-h-11 shrink-0 rounded-md border border-line bg-surface px-3 py-2 text-left"
                  }
                >
                  <span className="block text-sm font-semibold">{a.short}</span>
                </button>
              );
            })}
          </div>

          <div className="grid gap-3 rounded-md border border-line bg-surface p-3">
            <label className="flex min-h-11 flex-col justify-center gap-1">
              <span className="flex justify-between font-mono text-xs text-muted">
                <span>Charakter</span>
                <span className="text-fg">{pct(variation)}</span>
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={variation}
                aria-label="Charakter"
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setVariation(next);
                  if (active) rollActive(seed, next);
                  else roll(patch.archetype, seed, next);
                }}
              />
            </label>
            <p className="text-xs text-muted">Charakter hýbe levelem, detune a distortion. EQ, delay, hall a matrix nechá na receptu.</p>
            <div className="flex items-center gap-2">
              <label className="flex min-h-11 flex-1 items-center gap-2 rounded-md border border-line bg-raised px-3">
                <span className="font-mono text-xs text-muted">Seed</span>
                <input
                  inputMode="numeric"
                  value={seed}
                  aria-label="Seed"
                  onChange={(e) => setSeed(Number(e.target.value.replace(/[^\d]/g, "")) || 0)}
                  className="w-full bg-transparent font-mono text-sm text-fg outline-none"
                />
              </label>
              <button
                type="button"
                onClick={() => (active ? rollActive(freshSeed(), variation) : roll(patch.archetype, freshSeed(), variation))}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-md border border-line bg-raised text-fg"
                aria-label="Nový seed"
              >
                <Dices className="size-5" />
              </button>
              <button
                type="button"
                onClick={() => (active ? rollActive(freshSeed(), variation) : roll(patch.archetype, freshSeed(), variation))}
                className="min-h-11 rounded-md bg-acid px-4 text-sm font-semibold text-ink"
              >
                Hoď
              </button>
            </div>
            <input
              value={patch.name}
              aria-label="Jméno presetu"
              onChange={(e) => setPatch((p) => ({ ...p, name: e.target.value.slice(0, 80) }))}
              className="min-h-11 rounded-md border border-line bg-raised px-3 text-sm text-fg outline-none"
            />
          </div>

          {patch.osc.map((o, i) => (
            <article key={arch.layers[i]} className="rounded-md border border-line bg-surface p-3">
              <header className="mb-2 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">{arch.layers[i]}</h2>
                <span className="font-mono text-xs text-muted">OSC {i === 2 ? "C" : i === 1 ? "B" : "A"}</span>
              </header>
              {(o.warp2 || o.table || o.tablePos > 1) && (
                <p className="mb-2 font-mono text-xs text-muted">
                  {[
                    o.warp2 ? `warp 2 ${WARP_LABEL[o.warp2] ?? o.warp2}` : "",
                    o.tablePos > 1 ? `pozice ${Math.round(o.tablePos)}` : "",
                    o.table?.split("/").pop() ?? "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="flex min-h-11 flex-col gap-1 text-xs text-muted">
                  Octave
                  <select
                    value={o.octave}
                    onChange={(e) => updateOsc(i, { octave: Number(e.target.value) })}
                    className="min-h-11 rounded-md border border-line bg-raised px-2 text-sm text-fg"
                  >
                    {[-3, -2, -1, 0, 1, 2, 3].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-h-11 flex-col gap-1 text-xs text-muted">
                  Warp
                  <select
                    value={o.warp ?? ""}
                    onChange={(e) => updateOsc(i, { warp: e.target.value || null })}
                    className="min-h-11 rounded-md border border-line bg-raised px-2 text-sm text-fg"
                  >
                    <option value="">default</option>
                    {WARP_MENUS.map((w) => (
                      <option key={w} value={w}>
                        {WARP_LABEL[w]}
                      </option>
                    ))}
                  </select>
                </label>
                <Slider
                  label="Unison"
                  min={1}
                  max={16}
                  step={1}
                  value={o.unison}
                  display={String(o.unison)}
                  onChange={(n) => updateOsc(i, { unison: n })}
                />
                <Slider
                  label="Detune"
                  min={0}
                  max={1}
                  step={0.01}
                  value={o.detune}
                  display={pct(o.detune)}
                  onChange={(n) => updateOsc(i, { detune: n })}
                />
                <Slider
                  label="Level"
                  min={0}
                  max={1}
                  step={0.01}
                  value={o.volume}
                  display={pct(o.volume)}
                  onChange={(n) => updateOsc(i, { volume: n })}
                />
                <Slider
                  label="Stereo"
                  min={0}
                  max={1}
                  step={0.01}
                  value={o.stereo}
                  display={pct(o.stereo)}
                  onChange={(n) => updateOsc(i, { stereo: n })}
                />
              </div>
              <button
                type="button"
                onClick={() => updateOsc(i, { enable: o.enable > 0.5 ? 0 : 1 })}
                className="mt-2 min-h-11 text-sm text-muted"
              >
                {o.enable > 0.5 ? "Zapnuto" : "Vypnuto"}
              </button>
            </article>
          ))}

          <article className="rounded-md border border-line bg-surface p-3">
            <h2 className="mb-2 text-sm font-semibold">Filter</h2>
            <label className="mb-3 flex flex-col gap-1 text-xs text-muted">
              Typ
              <select
                value={patch.filters[0].type}
                onChange={(e) => updateFilter(0, { type: e.target.value })}
                className="min-h-11 rounded-md border border-line bg-raised px-2 text-sm text-fg"
              >
                {filterOptions(patch.filters[0].type).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-3 gap-3">
              <Slider
                label="Cut"
                min={0}
                max={1}
                step={0.01}
                value={patch.filters[0].freq}
                display={pct(patch.filters[0].freq)}
                onChange={(n) => updateFilter(0, { freq: n })}
              />
              <Slider
                label="Reso"
                min={0}
                max={100}
                step={1}
                value={patch.filters[0].reso}
                display={String(Math.round(patch.filters[0].reso))}
                onChange={(n) => updateFilter(0, { reso: n })}
              />
              <Slider
                label="Drive"
                min={0}
                max={100}
                step={1}
                value={patch.filters[0].drive}
                display={String(Math.round(patch.filters[0].drive))}
                onChange={(n) => updateFilter(0, { drive: n })}
              />
            </div>
          </article>

          <article className="rounded-md border border-line bg-surface p-3">
            <h2 className="mb-2 text-sm font-semibold">FX</h2>
            {active?.kind === "preset" ? (
              <>
                <ol className="flex flex-col gap-2">
                  {active.study.fx.map((item) => (
                    <li key={`${item.label}-${item.typeId}`} className="flex min-h-11 items-center justify-between text-sm">
                      <span>{item.label}</span>
                      <span className="font-mono text-xs text-muted">{item.mix == null ? "" : item.mix}</span>
                    </li>
                  ))}
                  {active.study.fx.length === 0 && <li className="text-sm text-muted">V souboru nejsou inserty.</li>}
                </ol>
                <p className="mt-2 text-sm text-muted">
                  Řetěz a wavetable zůstávají z nahraného souboru. Hod zapíše oscilátory, filtr a drobný rozptyl.
                </p>
              </>
            ) : (
            <ol className="flex flex-col gap-3">
              {patch.fx.map((f, i) => (
                <li key={`${f.label}-${i}`} className="border-t border-line pt-3 first:border-0 first:pt-0">
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-sm font-medium">{f.label}</span>
                    <span className="font-mono text-xs text-muted">{modeOf(f)}</span>
                  </div>
                  {f.mix != null && (
                    <Slider
                      label="Mix"
                      min={0}
                      max={100}
                      step={1}
                      value={f.mix}
                      display={String(Math.round(f.mix))}
                      onChange={(n) => updateFx(i, { mix: n })}
                    />
                  )}
                  {nestedLabels(f)}
                </li>
              ))}
              {patch.fx.length === 0 && <li className="text-sm text-muted">Bez insertů. Čistý sub.</li>}
            </ol>
            )}
          </article>
        </section>

        <aside className="flex min-w-0 flex-col gap-4">
          <article className="rounded-md border border-line bg-surface p-3">
            <p className="font-mono text-xs break-all text-acid">{arch.code}</p>
            <p className="mt-2 text-sm leading-relaxed">{patch.job}</p>
            <ul className="mt-3 flex flex-col gap-2">
              {patch.checks.map((c) => (
                <li key={c} className="text-sm text-muted">
                  {c}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-muted">
              {uploaded
                ? "Nahranej preset si řetěz nechá. Bounce řež až v Abletonu, tady by se ti ztratil wavetable."
                : paired
                  ? "Stáhni sub i tělo. Stejnej seed, sub je mono a bez saturace."
                  : (patch.voice?.subVolume ?? 0) > 0.05
                    ? "Sub osc je v tomhle souboru. Není to druhej download."
                    : "Jeden soubor. Tenhle recept nemá oddělenej fundament."}
            </p>
            <p className="mt-2 text-sm text-muted">
              {patch.voice?.mods?.length
                ? "Matrix je v souboru. Charakter s ní nehýbe."
                : `LFO 1 ${patch.lfos[0].mode} · LFO 2 ${patch.lfos[1].mode}. Kam LFO vede, soubor pořád nezapíše — je to první řádek v checklistu.`}
            </p>
          </article>

          <article className="rounded-md border border-line bg-surface p-3">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Sheet</h2>
              <button type="button" onClick={copySheet} className="flex min-h-11 items-center gap-2 text-sm text-acid">
                <Copy className="size-4" />
                Kopírovat
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex min-h-11 items-center gap-2 rounded-md border border-line bg-raised px-3 text-sm">
                <span className="text-muted">BPM</span>
                <input
                  value={bpm}
                  aria-label="BPM"
                  onChange={(e) => setBpm(e.target.value.slice(0, 6))}
                  className="w-full bg-transparent font-mono text-fg outline-none"
                />
              </label>
              <label className="flex min-h-11 items-center gap-2 rounded-md border border-line bg-raised px-3 text-sm">
                <span className="text-muted">Key</span>
                <input
                  value={musicKey}
                  aria-label="Tónina"
                  onChange={(e) => setMusicKey(e.target.value.slice(0, 8))}
                  className="w-full bg-transparent font-mono text-fg outline-none"
                />
              </label>
            </div>
          </article>

          <article className="rounded-md border border-line bg-surface p-3">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Feature vector</h2>
              <span className="font-mono text-xs text-muted">{VECTOR_DIM}</span>
            </div>
            <div
              className="grid w-full gap-px"
              style={{ gridTemplateColumns: "repeat(20, minmax(0, 1fr))" }}
              aria-hidden
            >
              {vector.map((v, i) => (
                <span key={i} className="h-3 bg-acid" style={{ opacity: 0.12 + v * 0.88 }} />
              ))}
            </div>
          </article>

          {bench.length > 0 && (
            <article className="rounded-md border border-line bg-surface p-3">
              <h2 className="mb-2 text-sm font-semibold">Uložené</h2>
              <ul className="flex flex-col">
                {bench.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveId(null);
                        setRaw(item.patch);
                        setPatch(item.patch);
                        setSeed(item.patch.seed);
                        setVariation(item.patch.variation);
                        setFamilyId(familyOf(item.patch.archetype));
                      }}
                      className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm"
                    >
                      <span>{item.patch.name}</span>
                      <span className="font-mono text-xs text-muted">{item.patch.seed}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </article>
          )}

          {(note || error) && (
            <p className={error ? "text-sm text-acid" : "text-sm text-muted"}>{error || note}</p>
          )}
        </aside>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/95 px-4 py-3">
        <div className="mx-auto flex max-w-5xl gap-2">
          {paired && !uploaded && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void downloadTarget(makeSub(raw), false)}
              className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-line text-sm font-semibold disabled:opacity-60"
            >
              <Download className="size-4" />
              Sub
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => void downloadTarget(patch, Boolean(uploaded))}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md bg-acid text-sm font-semibold text-ink disabled:opacity-60"
          >
            <Download className="size-4" />
            {busy ? "Skladám…" : paired && !uploaded ? "Tělo" : "Stáhnout .SerumPreset"}
          </button>
          <button
            type="button"
            onClick={saveBench}
            className="flex min-h-11 items-center gap-2 rounded-md border border-line px-4 text-sm"
            aria-label="Uložit preset"
          >
            <Bookmark className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  display,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex min-h-11 flex-col justify-center gap-1">
      <span className="flex justify-between font-mono text-xs text-muted">
        <span>{label}</span>
        <span className="text-fg">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function filterOptions(current: string) {
  const all: string[] = [...FILTER_TYPES];
  if (!all.includes(current)) all.unshift(current);
  return all;
}

function modeOf(fx: FxNode) {
  const mode = fx.params.kParamMode ?? fx.params.kParamType;
  return typeof mode === "string" ? mode.replace(/^k/, "") : "";
}

function nestedLabels(fx: FxNode) {
  const rows = fx.chains?.flatMap((chain, ci) =>
    chain.map((child) => ({ key: `${ci}-${child.label}`, label: child.label })),
  );
  if (!rows?.length) return null;
  return (
    <p className="mt-1 font-mono text-xs text-muted">
      {rows.map((r) => r.label).join(" · ")}
    </p>
  );
}
