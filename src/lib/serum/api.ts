import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ARCHETYPE_IDS, type Patch } from "./types";

const scalar = z.union([z.number().finite(), z.string().max(64)]);

const fxSchema: z.ZodType<{
  typeId: number;
  label: string;
  mix: number | null;
  params: Record<string, number | string>;
  chains?: Array<Array<unknown>>;
}> = z.lazy(() =>
  z.object({
    typeId: z.number().int().min(0).max(15),
    label: z.string().min(1).max(48),
    mix: z.number().finite().min(0).max(100).nullable(),
    params: z.record(z.string().max(64), scalar),
    chains: z.array(z.array(fxSchema)).max(3).optional(),
  }),
);

const oscSchema = z.object({
  octave: z.number().int().min(-3).max(3),
  volume: z.number().min(0).max(1),
  unison: z.number().min(1).max(16),
  detune: z.number().min(0).max(1),
  stereo: z.number().min(0).max(1),
  enable: z.number().min(0).max(1),
  warp: z.string().max(32).nullable(),
  tablePos: z.number().min(0).max(512),
  warp2: z.string().max(32).nullable().optional(),
  warpAmount: z.number().min(0).max(1).optional(),
  warp2Amount: z.number().min(0).max(1).optional(),
  table: z.string().max(160).optional(),
  phase: z.number().min(0).max(1).optional(),
});

const filterSchema = z.object({
  type: z.string().min(1).max(32),
  freq: z.number().min(0).max(1),
  reso: z.number().min(0).max(100),
  drive: z.number().min(0).max(100),
  enable: z.number().min(0).max(1),
  wet: z.number().min(0).max(100).optional(),
});

const modSchema = z.object({
  source: z.number().int().min(0).max(64),
  destType: z.string().min(1).max(32),
  destId: z.number().int().min(0).max(16),
  destParam: z.string().min(1).max(48),
  destParamId: z.number().int().min(0).max(64),
  amount: z.number().finite().min(-100).max(100),
  bipolar: z.number().min(0).max(1).optional(),
});

const voiceSchema = z.object({
  mono: z.boolean().optional(),
  legato: z.boolean().optional(),
  porta: z.number().min(0).max(1).optional(),
  subVolume: z.number().min(0).max(1).optional(),
  subOctave: z.number().int().min(-3).max(3).optional(),
  subEnable: z.number().min(0).max(1).optional(),
  macros: z
    .array(
      z.object({
        index: z.number().int().min(0).max(7),
        value: z.number().finite().min(0).max(100).optional(),
        name: z.string().max(32).optional(),
      }),
    )
    .max(8)
    .optional(),
  mods: z.array(modSchema).max(16).optional(),
  routeFilter: z.boolean().optional(),
  busLevel: z.number().min(0).max(100).optional(),
  busDest: z.number().min(0).max(8).optional(),
  busVol: z.number().min(0).max(1).optional(),
});

const patchSchema = z.object({
  name: z.string().min(1).max(80),
  author: z.string().max(64),
  tags: z.array(z.string().max(32)).max(12),
  blurb: z.string().max(400),
  archetype: z.enum(ARCHETYPE_IDS),
  seed: z.number().int().min(0).max(2147483647),
  variation: z.number().min(0).max(1),
  osc: z.tuple([oscSchema, oscSchema, oscSchema]),
  filters: z.tuple([filterSchema, filterSchema]),
  lfos: z.tuple([
    z.object({
      mode: z.enum(["Envelope", "Free"]),
      rate: z.number().min(0).max(1),
      sync: z.number().min(0).max(1).optional(),
    }),
    z.object({
      mode: z.enum(["Envelope", "Free"]),
      rate: z.number().min(0).max(1),
      sync: z.number().min(0).max(1).optional(),
    }),
  ]),
  fx: z.array(fxSchema).max(8),
  job: z.string().max(400),
  checks: z.array(z.string().max(280)).max(12),
  voice: voiceSchema.optional(),
});

export const encodePreset = createServerFn({ method: "POST" })
  .validator((input: unknown) => patchSchema.parse(input))
  .handler(async ({ data }) => {
    const { encodePatch } = await import("./encode.server");
    return encodePatch(data as Patch);
  });

const fileSchema = z.object({
  base64: z.string().min(16).max(2_200_000),
});

const varySchema = fileSchema.extend({
  seed: z.number().int().min(0).max(2147483647),
  variation: z.number().min(0).max(1),
  name: z.string().min(1).max(80),
  osc: z.tuple([oscSchema, oscSchema, oscSchema]),
  filters: z.tuple([filterSchema, filterSchema]),
  lfos: z.tuple([
    z.object({
      mode: z.enum(["Envelope", "Free"]),
      rate: z.number().min(0).max(1),
      sync: z.number().min(0).max(1).optional(),
    }),
    z.object({
      mode: z.enum(["Envelope", "Free"]),
      rate: z.number().min(0).max(1),
      sync: z.number().min(0).max(1).optional(),
    }),
  ]),
});

export const inspectPreset = createServerFn({ method: "POST" })
  .validator((input: unknown) => fileSchema.parse(input))
  .handler(async ({ data }) => {
    const { inspectBytes } = await import("./decode.server");
    return inspectBytes(Buffer.from(data.base64, "base64"));
  });

export const varyPreset = createServerFn({ method: "POST" })
  .validator((input: unknown) => varySchema.parse(input))
  .handler(async ({ data }) => {
    const { varyBytes } = await import("./decode.server");
    return varyBytes(Buffer.from(data.base64, "base64"), data);
  });
