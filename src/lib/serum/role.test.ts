import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generatePatch } from "./generate.ts";
import { archetypeHasSub, makeSub, shapeBody } from "./role.ts";
import { toFeatureVector } from "./vector.ts";

describe("resample pair", () => {
  it("drops delay and hall from a roar body and keeps the clip", () => {
    const raw = generatePatch("roar", 3, 0);
    const body = shapeBody(raw, "bounce", false);
    assert.equal(body.fx.some((item) => item.typeId === 4), false);
    assert.equal(body.fx.some((item) => item.typeId === 6), false);
    assert.equal(body.fx.some((item) => item.typeId === 0), true);
    assert.equal(body.osc[0].stereo, 0);
    assert.equal(body.checks.some((line) => line.includes("V souboru je sync delay")), false);
  });

  it("keeps the delay when the destination is the track", () => {
    const raw = generatePatch("roar", 3, 0);
    const body = shapeBody(raw, "print", false);
    assert.equal(body.fx.some((item) => item.typeId === 4), true);
    assert.equal(body.fx.find((item) => item.typeId === 4)?.mix, raw.fx.find((item) => item.typeId === 4)?.mix);
  });

  it("pulls a real sub out of the body and into its own file", () => {
    const raw = generatePatch("growl", 9, 0);
    assert.equal(archetypeHasSub("growl"), true);
    const body = shapeBody(raw, "bounce", true);
    const sub = makeSub(raw);
    assert.equal(body.osc[2].enable, 0);
    assert.equal(body.osc[2].volume, 0);
    assert.equal(sub.osc[2].octave, raw.osc[2].octave);
    assert.equal(sub.osc[2].enable, 1);
    assert.equal(sub.fx.some((item) => item.typeId === 0), false);
    assert.match(sub.name, /Sub$/);
  });

  it("follows the Pyth BS Reese 2 file instead of a detuned saw", () => {
    const patch = generatePatch("pyth", 4, 0);
    assert.equal(patch.osc[0].octave, -2);
    assert.equal(patch.osc[1].octave, -2);
    assert.equal(patch.osc[0].detune, 0);
    assert.equal(patch.osc[1].detune, 0);
    assert.equal(patch.filters[0].type, "N24");
    assert.equal(
      patch.fx.some((item) => item.params.kParamMode === "kAsym"),
      true,
    );
    assert.match(patch.checks.join(" "), /Fine/);
    assert.equal(patch.voice?.mono, true);
    assert.equal(patch.voice?.subVolume, 0.5625);
    assert.equal(patch.voice?.subOctave, undefined);
    assert.equal(patch.voice?.mods?.[0]?.amount, -100);
    assert.equal(patch.voice?.mods?.[1]?.amount, 100);
    assert.equal(patch.checks.some((line) => line.includes("nezapíše")), false);
  });

  it("keeps the Pyth matrix still when character is high", () => {
    const calm = generatePatch("pyth", 4, 0);
    const wild = generatePatch("pyth", 4, 1);
    assert.equal(wild.voice?.mods?.[0]?.amount, calm.voice?.mods?.[0]?.amount);
    assert.equal(wild.voice?.subVolume, calm.voice?.subVolume);
    assert.equal(wild.voice?.porta, calm.voice?.porta);
  });

  it("keeps Reese 3 on Plaits and PWM, with the table position above 1", () => {
    const patch = generatePatch("pyth3", 8, 1);
    assert.equal(patch.osc[0].warp, "kBendNeg");
    assert.equal(patch.osc[0].table, "S2 Tables/Analog/AT Plaits Wavetable.wav");
    assert.equal(patch.osc[1].warp2, "kBendPos");
    assert.equal(patch.osc[1].table, "Analog/PWM MG.wav");
    assert.ok(patch.osc[1].tablePos > 60);
    assert.equal(patch.voice?.subOctave, -1);
    assert.equal(patch.voice?.subVolume, 1);
    assert.equal(patch.filters[0].type, "Phase24N");
    assert.equal(patch.voice?.mods?.[3]?.bipolar, 1);
    assert.equal(toFeatureVector(patch).some((n) => Number.isFinite(n)), true);
  });

  it("moves the filter mod when bounce drops Hyper", () => {
    const raw = generatePatch("pyth", 4, 0);
    const body = shapeBody(raw, "bounce", false);
    const printed = shapeBody(raw, "print", false);
    assert.equal(body.fx.some((item) => item.typeId === 9), false);
    assert.equal(body.fx.some((item) => item.typeId === 0), true);
    assert.equal(body.voice?.mods?.find((item) => item.destType === "FXFilter")?.destId, 1);
    assert.equal(printed.voice?.mods?.find((item) => item.destType === "FXFilter")?.destId, 2);
    assert.equal(printed.voice?.subVolume, 0.5625);
  });

  it("does not invent a sub for a lead or the clean-sub recipe", () => {
    assert.equal(archetypeHasSub("roar"), false);
    assert.equal(archetypeHasSub("pad"), false);
    assert.equal(archetypeHasSub("bounce"), false);
  });

  it("does not let a high character smear the space or a silent oscillator", () => {
    const calm = generatePatch("roar", 11, 0);
    const wild = generatePatch("roar", 11, 1);
    const drive = wild.fx.find((item) => item.typeId === 0)?.params.kParamDrive;
    assert.equal(wild.fx.find((item) => item.typeId === 4)?.mix, calm.fx.find((item) => item.typeId === 4)?.mix);
    assert.equal(wild.osc[2].volume, 0);
    assert.equal(typeof drive, "number");
    assert.ok(typeof drive === "number" && drive > 15 && drive < 50);
  });
});
