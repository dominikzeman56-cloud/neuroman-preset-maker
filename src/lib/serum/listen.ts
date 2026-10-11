import type { Patch } from "./types";
import type { SampleRead } from "./study";

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function hann(re: Float32Array) {
  const n = re.length;
  for (let i = 0; i < n; i++) re[i] *= 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
}

function fftMag(input: Float32Array) {
  const n = input.length;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  re.set(input);
  hann(re);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i] ?? 0;
      re[i] = re[j] ?? 0;
      re[j] = tr;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      for (let k = 0; k < len / 2; k++) {
        const j = i + k + len / 2;
        const tr = wr * (re[j] ?? 0) - wi * (im[j] ?? 0);
        const ti = wr * (im[j] ?? 0) + wi * (re[j] ?? 0);
        re[j] = (re[i + k] ?? 0) - tr;
        im[j] = (im[i + k] ?? 0) - ti;
        re[i + k] = (re[i + k] ?? 0) + tr;
        im[i + k] = (im[i + k] ?? 0) + ti;
        const nwr = wr * wlenRe - wi * wlenIm;
        wi = wr * wlenIm + wi * wlenRe;
        wr = nwr;
      }
    }
  }
  const mag = new Float32Array(n / 2);
  for (let i = 0; i < mag.length; i++) mag[i] = Math.hypot(re[i] ?? 0, im[i] ?? 0);
  return mag;
}

function band(mag: Float32Array, rate: number, lo: number, hi: number) {
  const n = mag.length * 2;
  const a = Math.max(1, Math.floor((lo * n) / rate));
  const b = Math.min(mag.length - 1, Math.ceil((hi * n) / rate));
  let e = 0;
  for (let i = a; i <= b; i++) e += (mag[i] ?? 0) ** 2;
  return e;
}

function loudStart(left: Float32Array, rate: number) {
  const win = Math.min(left.length, Math.floor(rate * 0.35));
  const hop = Math.max(1, Math.floor(win / 2));
  const limit = Math.min(left.length, Math.floor(rate * 45));
  let best = 0;
  let bestAt = 0;
  for (let i = 0; i + win < limit; i += hop) {
    let e = 0;
    for (let j = 0; j < win; j += 8) e += (left[i + j] ?? 0) ** 2;
    if (e > best) {
      best = e;
      bestAt = i;
    }
  }
  return { at: bestAt, win };
}

function modRate(left: Float32Array, rate: number, at: number) {
  const frames = 256;
  const hop = Math.max(32, Math.floor(rate / 180));
  const env = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const start = at + i * hop;
    let e = 0;
    const n = Math.min(hop, left.length - start);
    if (n <= 8) break;
    for (let j = 0; j < n; j += 2) e += Math.abs(left[start + j] ?? 0);
    env[i] = e / n;
  }
  let mean = 0;
  for (const v of env) mean += v;
  mean /= frames;
  let best = 0;
  let bestLag = 0;
  const minLag = Math.max(2, Math.round(rate / hop / 18));
  const maxLag = Math.min(frames - 2, Math.round(rate / hop / 1.5));
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0;
    for (let i = 0; i < frames - lag; i++) acc += ((env[i] ?? 0) - mean) * ((env[i + lag] ?? 0) - mean);
    if (acc > best) {
      best = acc;
      bestLag = lag;
    }
  }
  if (bestLag === 0 || best <= 0) return 0;
  return rate / hop / bestLag;
}

export function analyzePcm(leftIn: Float32Array, rightIn: Float32Array | null, sampleRate: number, name: string): SampleRead {
  const left = leftIn;
  const { at } = loudStart(left, sampleRate);
  const n = 2048;
  const frame = new Float32Array(n);
  for (let i = 0; i < n; i++) frame[i] = left[at + i] ?? 0;
  const mag = fftMag(frame);
  const sub = band(mag, sampleRate, 20, 60);
  const body = band(mag, sampleRate, 60, 250);
  const mid = band(mag, sampleRate, 250, 2000);
  const air = band(mag, sampleRate, 2000, 8000);
  const total = sub + body + mid + air || 1;
  let num = 0;
  let den = 0;
  for (let i = 1; i < mag.length; i++) {
    const f = (i * sampleRate) / (n);
    const m = mag[i] ?? 0;
    num += f * m;
    den += m;
  }
  let peak = 0;
  let rms = 0;
  const span = Math.min(left.length - at, Math.floor(sampleRate * 0.35));
  for (let i = 0; i < span; i++) {
    const s = Math.abs(left[at + i] ?? 0);
    peak = Math.max(peak, s);
    rms += s * s;
  }
  rms = Math.sqrt(rms / Math.max(1, span));
  let width = 0;
  if (rightIn && rightIn.length === left.length) {
    let midE = 0;
    let sideE = 0;
    const step = Math.max(1, Math.floor(span / 4000));
    for (let i = 0; i < span; i += step) {
      const m = ((left[at + i] ?? 0) + (rightIn[at + i] ?? 0)) * 0.5;
      const s = ((left[at + i] ?? 0) - (rightIn[at + i] ?? 0)) * 0.5;
      midE += m * m;
      sideE += s * s;
    }
    width = sideE / (midE + sideE + 1e-9);
  }
  return {
    name,
    seconds: Math.round((left.length / sampleRate) * 10) / 10,
    centroidHz: Math.round(den > 0 ? num / den : 0),
    sub: sub / total,
    body: body / total,
    mid: mid / total,
    air: air / total,
    modHz: Math.round(modRate(left, sampleRate, at) * 10) / 10,
    crest: rms > 0 ? Math.round((peak / rms) * 10) / 10 : 0,
    width: Math.round(width * 100) / 100,
  };
}

export function sampleNotes(read: SampleRead): string[] {
  const weight =
    read.sub > read.body && read.sub > read.mid
      ? "váha je v subu"
      : read.body >= read.mid
        ? "váha je v těle"
        : "váha je ve středech";
  const move = read.modHz >= 1.5 ? `pohyb kolem ${read.modHz} Hz` : "bez výrazného opakovaného pohybu";
  const wide = read.width > 0.25 ? "stereo je otevřené" : "nízko je to spíš mono";
  return [
    `${read.centroidHz} Hz těžiště, ${weight}.`,
    `${move}. ${wide}.`,
    "Sample nasměruje recept. Wavetable z audia se neskládá.",
  ];
}

export function biasPatch(patch: Patch, read: SampleRead): Patch {
  const darkness = clamp(1 - read.centroidHz / 3500, 0, 1);
  const freq = clamp(patch.filters[0].freq * 0.45 + (1 - darkness) * 0.55, 0.04, 0.9);
  const subBoost = read.sub > 0.4 ? 0.12 : 0;
  const bodyCut = read.sub > read.body ? 0.08 : 0;
  const lfoRate = read.modHz > 1.5 ? clamp(read.modHz / 16, 0.05, 0.9) : patch.lfos[0].rate;
  const osc = patch.osc.map((o, i) => {
    if (i === 2) return { ...o, volume: clamp(o.volume + subBoost, 0, 1), stereo: 0, unison: Math.min(o.unison, 1) };
    return {
      ...o,
      volume: clamp(o.volume - bodyCut, 0, 1),
      stereo: o.stereo === 0 ? 0 : clamp(o.stereo * 0.5 + read.width * 0.5, 0, 1),
    };
  }) as Patch["osc"];
  const filters = patch.filters.map((f, i) => (i === 0 ? { ...f, freq, drive: clamp(f.drive + read.air * 18, 0, 100) } : f)) as Patch["filters"];
  return {
    ...patch,
    name: `${patch.name.replace(/ #\d+$/, "")} · ${read.name}`.slice(0, 80),
    osc,
    filters,
    lfos: [{ ...patch.lfos[0], rate: lfoRate }, patch.lfos[1]],
    job: sampleNotes(read)[0] ?? patch.job,
    checks: sampleNotes(read),
    blurb: `Sample ${read.name}: ${sampleNotes(read).join(" ")}`,
  };
}
