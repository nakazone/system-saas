/**
 * Voice dictation for stair & vent measurements: the builder talks ("step three, forty-eight by
 * eleven and a quarter, both sides open, forty-five"), we transcribe it and turn it into small
 * edit actions the app applies (with undo). Nothing is saved here.
 */
import { z } from "zod";
import { aiChatJson, aiTranscribeAudio, isAiConfigured } from "../ai/client.js";
import { BuilderError } from "./accounts.js";
import { parseData, type MeasurementData } from "./measurements.js";

const num = z.number().min(0).max(2000).nullable().optional();
const stairRef = z.number().int().min(0).max(19);

export const voiceActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set_steps"),
    stair: stairRef,
    from: z.number().int().min(1).max(60),
    to: z.number().int().min(1).max(60).optional(),
    tread_w: num, tread_d: num, riser_w: num, riser_h: num,
    open: z.enum(["none", "left", "right", "both"]).optional(),
    ret: z.enum(["45", "flat", "bullnose"]).optional(),
    no_riser: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("add_steps"),
    stair: stairRef,
    count: z.number().int().min(1).max(40),
    tread_w: num, tread_d: num, riser_w: num, riser_h: num,
    open: z.enum(["none", "left", "right", "both"]).optional(),
    ret: z.enum(["45", "flat", "bullnose"]).optional(),
  }),
  z.object({
    type: z.literal("set_stair"),
    stair: stairRef,
    name: z.string().max(80).optional(),
    species: z.string().max(60).optional(),
    finish: z.string().max(60).optional(),
    color: z.string().max(80).optional(),
    riser_material: z.enum(["same", "primed", "paint_grade", "none"]).optional(),
  }),
  z.object({
    type: z.literal("add_stair"),
    name: z.string().max(80).optional(),
    species: z.string().max(60).optional(),
    finish: z.string().max(60).optional(),
    color: z.string().max(80).optional(),
    riser_material: z.enum(["same", "primed", "paint_grade", "none"]).optional(),
  }),
  z.object({
    type: z.literal("add_nosing"),
    stair: stairRef,
    length: z.number().min(0).max(2000),
    qty: z.number().int().min(1).max(500).optional(),
    nosing_type: z.enum(["flush", "overlap", "stair_nose"]).optional(),
    note: z.string().max(200).optional(),
  }),
  z.object({
    type: z.literal("add_vent"),
    size: z.string().max(20),
    vent_type: z.enum(["flush", "self_rimming", "return_air"]).optional(),
    qty: z.number().int().min(1).max(500).optional(),
    room: z.string().max(80).optional(),
    species: z.string().max(60).optional(),
    finish: z.string().max(60).optional(),
    color: z.string().max(80).optional(),
  }),
  z.object({
    type: z.literal("remove_steps"),
    stair: stairRef,
    from: z.number().int().min(1).max(60),
    to: z.number().int().min(1).max(60).optional(),
  }),
]);
export type VoiceAction = z.infer<typeof voiceActionSchema>;

const SYSTEM = `You turn a builder's spoken stair and vent measurements into edit actions for a measuring app.
All sizes are inches as decimals: "eleven and a quarter" = 11.25, "seven and a half" = 7.5, "forty-eight" = 48, "five eighths" = 0.625, "thirty-six and three quarters" = 36.75.
Tread = width x depth (e.g. "48 by 11 1/4"). Riser = width x height. If only one size pair is said for a step, it is the tread; "riser seven and a half" sets riser_h (riser_w = tread width unless said).
Open side: "left side open"/"open left" = left, "right open" = right, "both sides open"/"double return" = both, "closed"/"between walls" = none.
Return: "45"/"mitered" = "45", "flat"/"square" = "flat", "bullnose"/"round" = "bullnose".
Steps are numbered from the bottom, starting at 1. "Steps 1 to 8" means from 1 to 8. "Same for the rest"/"all the others" means up to the last step. "Add 6 more the same" = add_steps with count 6 and no sizes.
Stairs are referred to by index (0-based) from the list given; "this stair"/no stair named = the current stair. "New stair"/"another stair" = add_stair (then later actions use the new index = number of stairs).
Vents: size like "4 by 10" = "4x10"; "flush mount" = flush, "self rimming"/"drop in" = self_rimming, "return air" = return_air.
Return ONLY JSON: {"actions":[...], "reply": "<one short sentence in English confirming what you understood>", "unclear": "<what was not understood, or empty>"}.
Action types:
{"type":"set_steps","stair":0,"from":3,"to":3,"tread_w":48,"tread_d":11.25,"riser_w":48,"riser_h":7.5,"open":"both","ret":"45"}
{"type":"add_steps","stair":0,"count":5,"tread_w":48,"tread_d":11.25}
{"type":"set_stair","stair":0,"name":"Basement stair","species":"White Oak","finish":"Prefinished","color":"Jacobean","riser_material":"primed"}
{"type":"add_stair","name":"Basement stair","species":"Red Oak"}
{"type":"add_nosing","stair":0,"length":48,"qty":1,"nosing_type":"flush","note":"top landing"}
{"type":"add_vent","size":"4x10","vent_type":"flush","qty":10,"room":"Main floor","species":"White Oak","color":"Natural"}
{"type":"remove_steps","stair":0,"from":9,"to":9}
Only include fields that were said. Never invent sizes. If nothing usable was said, return no actions and explain in "unclear".`;

function context(data: MeasurementData, stair: number, step: number): string {
  const stairs = data.stairs.map((s, i) => `${i}: "${s.name || "Stair"}" — ${s.steps.length} steps${i === stair ? " (current)" : ""}`).join("\n") || "(no stairs yet)";
  return `Stairs:\n${stairs}\nCurrent stair index: ${data.stairs.length ? Math.min(stair, data.stairs.length - 1) : "none (add_stair first)"}\nSelected step: ${step + 1}\nVents measured: ${data.vents.length}`;
}

export async function voiceToActions(input: { dataUrl: string; data: unknown; stair: number; step: number }): Promise<{ transcript: string; actions: VoiceAction[]; reply: string; unclear: string }> {
  if (!isAiConfigured()) throw new BuilderError(503, "Voice is not set up on this server yet.");
  const m = /^data:([^;]+)(?:;[^,]*)?;base64,(.+)$/.exec(String(input.dataUrl || ""));
  if (!m) throw new BuilderError(400, "No audio received.");
  const contentType = m[1]!.toLowerCase();
  if (!/^audio\/(webm|mp4|mpeg|ogg|wav|x-m4a|aac)/.test(contentType)) throw new BuilderError(400, "Unsupported audio format.");
  const body = Buffer.from(m[2]!, "base64");
  if (body.length < 800) throw new BuilderError(400, "The recording was too short.");
  if (body.length > 12 * 1024 * 1024) throw new BuilderError(400, "The recording is too long. Keep it under a minute.");
  const tr = await aiTranscribeAudio({
    body,
    contentType,
    language: "en",
    prompt: "Stair measurements: tread, riser, nosing, by, and a quarter, and a half, three quarters, left side open, right side open, both sides open, 45, mitered, flat return, bullnose, vent, 4 by 10, flush mount, self rimming, White Oak, Red Oak, Hickory, prefinished, Jacobean.",
    keywords: ["tread", "riser", "nosing", "bullnose", "mitered", "flush mount", "self rimming", "White Oak", "Red Oak", "Hickory", "Jacobean", "prefinished"],
    timeoutMs: 45_000,
  });
  if (!tr.ok) throw new BuilderError(502, "Could not understand the audio. Try again closer to the phone.");
  const data = parseData(input.data);
  const res = await aiChatJson({
    system: SYSTEM,
    user: `${context(data, input.stair, input.step)}\n\nThe builder said:\n"""${tr.text.slice(0, 2000)}"""`,
    timeoutMs: 30_000,
  });
  if (!res.ok) throw new BuilderError(502, "Mate could not process that. Try again.");
  let raw: { actions?: unknown; reply?: unknown; unclear?: unknown } = {};
  try {
    const t = res.text;
    raw = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
  } catch {
    raw = {};
  }
  const actions: VoiceAction[] = [];
  for (const a of Array.isArray(raw.actions) ? raw.actions.slice(0, 40) : []) {
    const parsed = voiceActionSchema.safeParse(a);
    if (parsed.success) actions.push(parsed.data);
  }
  return {
    transcript: tr.text,
    actions,
    reply: String(raw.reply || "").slice(0, 300),
    unclear: String(raw.unclear || "").slice(0, 300),
  };
}
