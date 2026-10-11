import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { zstdDecompressSync } from "node:zlib";
import { asMap, decodeCbor, mapGet, nodeNum, nodeStr, type CMap } from "./cbor.ts";
import { inspectBytes } from "./decode.server.ts";
import { encodePatch } from "./encode.server.ts";
import { generatePatch } from "./generate.ts";
import { shapeBody } from "./role.ts";

function rootOf(base64: string): CMap {
  const bytes = Buffer.from(base64, "base64");
  let pos = 9;
  const metaLen = Number(bytes.readBigUInt64LE(pos));
  pos += 8 + metaLen + 8;
  return asMap(decodeCbor(zstdDecompressSync(bytes.subarray(pos))), "preset");
}

function params(root: CMap, key: string): CMap {
  const mod = mapGet(root, key);
  if (!mod || mod.k !== "m") throw new Error(`missing ${key}`);
  const pp = mapGet(mod, "plainParams");
  if (!pp || pp.k !== "m") throw new Error(`missing params ${key}`);
  return pp;
}

function wt(root: CMap, index: number): CMap {
  const osc = mapGet(root, `Oscillator${index}`);
  if (!osc || osc.k !== "m") throw new Error(`missing osc ${index}`);
  const table = mapGet(osc, `WTOsc${index}`);
  if (!table || table.k !== "m") throw new Error(`missing wt ${index}`);
  return table;
}

describe("preset writer", () => {
  it("writes the Reese 2 matrix, sub and mono into a fresh file", () => {
    const patch = shapeBody(generatePatch("pyth", 4, 0), "print", false);
    const file = encodePatch(patch);
    const root = rootOf(file.base64);
    const global = params(root, "Global0");
    assert.equal(nodeNum(mapGet(global, "kParamMonoToggle")), 1);
    assert.equal(nodeNum(mapGet(global, "kParamLegato")), 1);
    assert.ok(Math.abs((nodeNum(mapGet(global, "kParamPortamentoTime")) ?? 0) - 0.066256) < 0.0001);

    const sub = params(root, "Oscillator4");
    assert.equal(nodeNum(mapGet(sub, "kParamVolume")), 0.5625);
    assert.equal(mapGet(sub, "kParamOctave"), undefined);

    const slot0 = mapGet(root, "ModSlot0");
    if (!slot0 || slot0.k !== "m") throw new Error("slot");
    assert.equal(nodeStr(mapGet(slot0, "destModuleParamName")), "kParamFine");
    assert.equal(nodeNum(mapGet(slot0, "destModuleParamID")), 5);
    assert.equal(nodeStr(mapGet(slot0, "destModuleTypeString")), "Oscillator");
    const source = mapGet(slot0, "source");
    assert.equal(source?.k === "a" ? nodeNum(source.v[0]) : null, 25);
    assert.equal(nodeNum(mapGet(params(root, "ModSlot0"), "kParamAmount")), -100);
    assert.equal(nodeNum(mapGet(params(root, "ModSlot1"), "kParamAmount")), 100);

    const macro = mapGet(root, "Macro0");
    assert.equal(macro?.k === "m" ? nodeStr(mapGet(macro, "name")) : null, "Macro1");
    assert.ok(Math.abs((nodeNum(mapGet(params(root, "Macro0"), "kParamValue")) ?? 0) - 23.4255) < 0.001);

    const table = wt(root, 0);
    assert.equal(nodeStr(mapGet(table, "relativePathToWT")), "S2 Tables/Default Shapes.wav");
    assert.equal(nodeStr(mapGet(params(root, "VoiceFilter0"), "kParamType")), "N24");

    const notes = inspectBytes(Buffer.from(file.base64, "base64")).notes.join(" ");
    assert.match(notes, /Macro 1 → A Fine -100/);
    assert.match(notes, /Sub osc, ne osc C: level 56%/);
    assert.match(notes, /oktávu nechává na defaultu/);
  });

  it("writes Reese 3 warps, table paths and the bipolar EQ mod", () => {
    const patch = shapeBody(generatePatch("pyth3", 2, 0), "print", false);
    const file = encodePatch(patch);
    const root = rootOf(file.base64);
    const a = wt(root, 0);
    const b = wt(root, 1);
    assert.equal(nodeStr(mapGet(a, "relativePathToWT")), "S2 Tables/Analog/AT Plaits Wavetable.wav");
    assert.equal(nodeNum(mapGet(a, "numFrames")), 16384);
    assert.equal(nodeStr(mapGet(wtParams(a), "kParamWarpMenu")), "kBendNeg");
    assert.equal(nodeStr(mapGet(b, "relativePathToWT")), "Analog/PWM MG.wav");
    assert.equal(nodeNum(mapGet(b, "numFrames")), 139264);
    assert.equal(nodeStr(mapGet(wtParams(b), "kParamWarpMenu2")), "kBendPos");
    assert.ok((nodeNum(mapGet(wtParams(b), "kParamTablePos")) ?? 0) > 60);

    const sub = params(root, "Oscillator4");
    assert.equal(nodeNum(mapGet(sub, "kParamVolume")), 1);
    assert.equal(nodeNum(mapGet(sub, "kParamOctave")), -1);
    assert.equal(nodeNum(mapGet(params(root, "ModSlot3"), "kParamBipolar")), 1);
    const slot2 = mapGet(root, "ModSlot2");
    assert.equal(slot2?.k === "m" ? nodeStr(mapGet(slot2, "destModuleParamName")) : null, "kParamWarp2");
    assert.equal(slot2?.k === "m" ? nodeNum(mapGet(slot2, "destModuleParamID")) : null, 3);

    const notes = inspectBytes(Buffer.from(file.base64, "base64")).notes.join(" ");
    assert.match(notes, /AT Plaits Wavetable/);
    assert.match(notes, /PWM MG/);
    assert.match(notes, /B BendPos/);
    assert.match(notes, /LFO 1 → A Warp 71/);
    assert.match(notes, /oktáva -1/);
  });
});

function wtParams(table: CMap): CMap {
  const pp = mapGet(table, "plainParams");
  if (!pp || pp.k !== "m") throw new Error("wt params");
  return pp;
}
