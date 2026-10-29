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
    type: z.literal("add_riser"),
    stair: stairRef,
    count: z.number().int().min(1).max(40).default(1),
    riser_w: num,
    riser_h: num,
  }),
  z.object({
    type: z.literal("set_stair"),
    stair: stairRef,
    name: z.string().max(80).optional(),
    species: z.string().max(60).optional(),
    finish: z.string().max(60).optional(),
    color: z.string().max(80).optional(),
    riser_material: z.enum(["same", "primed", "paint_grade", "none"]).optional(),
    landing_w: num,
    landing_d: num,
    /** true = this flight ends on a landing (even when its size is unknown). */
    landing: z.boolean().optional(),
    /** Index of the lower flight whose landing this flight starts from. */
    starts_on_landing_of: stairRef.optional(),
    /** Direction this flight leaves the landing, seen walking up the lower flight. */
    turn: z.enum(["straight", "left", "right", "u_left", "u_right"]).optional(),
  }),
  z.object({
    type: z.literal("add_stair"),
    name: z.string().max(80).optional(),
    species: z.string().max(60).optional(),
    finish: z.string().max(60).optional(),
    color: z.string().max(80).optional(),
    riser_material: z.enum(["same", "primed", "paint_grade", "none"]).optional(),
    landing_w: num,
    landing_d: num,
    /** true = this flight ends on a landing (even when its size is unknown). */
    landing: z.boolean().optional(),
    /** Index of the lower flight whose landing this flight starts from. */
    starts_on_landing_of: stairRef.optional(),
    /** Direction this flight leaves the landing, seen walking up the lower flight. */
    turn: z.enum(["straight", "left", "right", "u_left", "u_right"]).optional(),
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
The builder may speak English, Portuguese or Spanish, or mix them. The transcript is automatic and often writes numbers oddly — read them like a flooring installer would.
All sizes are inches as decimals: "eleven and a quarter" = 11.25, "seven and a half" = 7.5, "forty-eight" = 48, "five eighths" = 0.625, "thirty-six and three quarters" = 36.75, "eleven one eighth" = 11.125.
Fractions in the transcript: "11 1/4", "11-1/4", "11 1 4", "11 and 1 4", "11 1/4\"", "eleven a quarter", "11 quarter" all mean 11.25; "7 1 2" = 7.5; "36 3 4" = 36.75; "11 5 8" = 11.625; "11 3 8ths" = 11.375. A number followed by "1 4", "1 2", "3 4", "1 8", "3 8", "5 8", "7 8" is a whole number plus that fraction — never 11.14 or 114.
Portuguese/Spanish: "por"/"x" = by; "e um quarto"/"y cuarto" = .25, "e meio"/"y medio" = .5, "e três quartos"/"tres cuartos" = .75, "degrau"/"escalón" = step, "espelho"/"contrahuella" = riser, "piso do degrau"/"huella" = tread, "lado esquerdo aberto" = left open, "lado direito aberto" = right open, "os dois lados abertos"/"ambos lados" = both, "fechado" = none.
Typical sizes help you choose: tread width 30–72, tread depth 9–14, riser height 5–8.5, riser width = tread width. If two numbers are said for a tread, the bigger is the width and the smaller the depth.
Inches only: "3 feet 6" / "3 pés e 6" = 42. Metric: "106 centimeters" = 41.73.
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

/** Sizes that can't be right for a stair (transcription slips): fix the obvious ones, flag the rest. */
export function checkActions(actions: VoiceAction[]): { actions: VoiceAction[]; checks: string[] } {
  const checks: string[] = [];
  const fixFraction = (v: number | null | undefined): number | null | undefined => {
    if (v == null) return v;
    // "11 1 4" read as 1114 / 11.14 → 11.25
    const s = String(v);
    const m = /^(\d{1,2})\.?(1)(2|4|8)$/.exec(s.replace(/\.0+$/, ""));
    if (m && v > 20) return Number(m[1]) + 1 / Number(m[3]);
    const m2 = /^(\d{1,2})\.(1)(2|4|8)$/.exec(s);
    if (m2) return Number(m2[1]) + 1 / Number(m2[3]);
    const m3 = /^(\d{1,2})\.?(3|5|7)(4|8)$/.exec(s);
    if (m3 && (v > 100 || /\./.test(s))) return Number(m3[1]) + Number(m3[2]) / Number(m3[3]);
    return v;
  };
  for (const a of actions) {
    if (a.type !== "set_steps" && a.type !== "add_steps" && a.type !== "add_riser") continue;
    const o = a as Record<string, unknown>;
    for (const k of ["tread_w", "tread_d", "riser_w", "riser_h"]) {
      if (typeof o[k] === "number") o[k] = fixFraction(o[k] as number);
    }
    if (typeof o.tread_w === "number" && typeof o.tread_d === "number" && (o.tread_w as number) < (o.tread_d as number)) {
      [o.tread_w, o.tread_d] = [o.tread_d, o.tread_w];
    }
    const out = (k: string, lo: number, hi: number, label: string) => {
      const v = o[k];
      if (typeof v === "number" && v > 0 && (v < lo || v > hi)) checks.push(`${label} ${v}" looks unusual — check it.`);
    };
    out("tread_w", 18, 96, "Tread width");
    out("tread_d", 7, 16, "Tread depth");
    out("riser_h", 3, 9.5, "Riser height");
    out("riser_w", 18, 96, "Riser width");
  }
  return { actions, checks: [...new Set(checks)].slice(0, 4) };
}

function context(data: MeasurementData, stair: number, step: number): string {
  const stairs = data.stairs.map((s, i) => {
    const treads = s.steps.filter((component) => component.kind !== "riser" && (component.tread_w || component.tread_d)).length;
    const risers = s.steps.filter((component) => (component.kind === "riser" || (!component.no_riser && s.riser_material !== "none")) && (component.riser_w || component.riser_h)).length;
    return i + ': "' + (s.name || "Stair") + '" — ' + treads + " treads / " + risers + " risers" + (i === stair ? " (current)" : "");
  }).join("\n") || "(no stairs yet)";
  return "Stairs:\n" + stairs
    + "\nCurrent stair index: " + (data.stairs.length ? Math.min(stair, data.stairs.length - 1) : "none (add_stair first)")
    + "\nSelected component: " + (step + 1)
    + (() => {
      const s = data.stairs[Math.min(stair, Math.max(0, data.stairs.length - 1))];
      const last = s ? s.steps.filter((x) => x.tread_w || x.tread_d || x.riser_h).slice(-2) : [];
      return last.length ? "\nLast measured steps on the current stair: " + last.map((x) => `${x.tread_w ?? "?"} x ${x.tread_d ?? "?"} / riser ${x.riser_h ?? "?"} / ${x.open}`).join("; ") : "";
    })()
    + "\nVents measured: " + data.vents.length
    + '\nIf asked for a riser without a tread, use {"type":"add_riser","stair":0,"count":1,"riser_w":48,"riser_h":7.5}.';
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
    languages: ["en", "pt", "es"],
    prompt: "Stair measurements: step 1, 42 by 11 1/4, riser 7 1/2, 48 x 11-3/4, tread, riser, nosing, and a quarter, and a half, three quarters, left side open, right side open, both sides open, 45, mitered, flat return, bullnose, vent 4 by 10, flush mount, self rimming, White Oak, Red Oak, Hickory, prefinished, Jacobean. Degrau, espelho, quarenta e dois por onze e um quarto, lado esquerdo aberto.",
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
  const parsedActions: VoiceAction[] = [];
  for (const a of Array.isArray(raw.actions) ? raw.actions.slice(0, 40) : []) {
    const parsed = voiceActionSchema.safeParse(a);
    if (parsed.success) parsedActions.push(parsed.data);
  }
  const { actions, checks } = checkActions(parsedActions);
  return {
    transcript: tr.text,
    actions,
    reply: String(raw.reply || "").slice(0, 300),
    unclear: [String(raw.unclear || "").slice(0, 300), ...checks].filter(Boolean).join(" "),
  };
}

/* ───────────────────────────── stair from photos ───────────────────────────── */

/** Keeps flight links sane: the lower flight exists and has its landing on; no self links. */
export function linkFlights(actions: VoiceAction[], existing: number): VoiceAction[] {
  let count = existing;
  const landingOn = new Set<number>();
  for (const a of actions) {
    if (a.type === "add_stair") {
      if (a.starts_on_landing_of != null && a.starts_on_landing_of >= count) delete a.starts_on_landing_of;
      if (a.starts_on_landing_of != null) landingOn.add(a.starts_on_landing_of);
      count += 1;
    } else if (a.type === "set_stair" && a.starts_on_landing_of != null) {
      if (a.starts_on_landing_of === a.stair || a.starts_on_landing_of >= count) delete a.starts_on_landing_of;
      else landingOn.add(a.starts_on_landing_of);
    }
  }
  for (const idx of landingOn) {
    let k = existing;
    let found = false;
    for (const a of actions) {
      if (a.type === "add_stair") { if (k === idx) { a.landing = true; found = true; } k += 1; }
      else if (a.type === "set_stair" && a.stair === idx) { a.landing = true; found = true; }
    }
    if (!found) actions.unshift({ type: "set_stair", stair: idx, landing: true });
  }
  return actions;
}

const PHOTO_SYSTEM = `You look at photos of a stair on a job site (framed or finished) and build it in a stair measuring app for a flooring installer who will put hardwood treads and risers on it.

FIRST decide how many FLIGHTS there are. Many houses have two flights joined by a landing (an L or U turn, or a straight run broken by a flat platform):
- A landing is a flat platform much deeper than a tread (usually 36–48" deep), often at a window or where the stair turns 90° or 180°. A flight is a run of steps between two floors/landings.
- Different photos often show DIFFERENT flights of the same stair: one photo taken from the lower floor looking up to the landing, another taken from the landing (or near it) looking up to the upper floor. Clues: a different window, different walls/railings, a different floor at the bottom (the landing's flooring), the stair turning. If two photos show different step counts, open sides or surroundings, they are two flights — do NOT merge them into one and do not count the same steps twice.
- When there is a landing between flights: build the LOWER flight first with add_stair (landing:true, plus landing_w/landing_d if known — the landing width is usually the stair width), then the UPPER flight with add_stair and "starts_on_landing_of" = the index of the lower flight. Name them e.g. "Lower flight" and "Upper flight".
- Say which way the upper flight leaves the landing with "turn", as seen by someone walking UP the lower flight: "straight" (keeps going the same direction), "left"/"right" (90° turn, L-shaped stair), "u_left"/"u_right" (180° turn, U-shaped: the upper flight runs back beside the lower one, on its left or right). Look at where the upper flight is in the photos relative to the lower flight: a wall with stepped drywall rising above and beside the lower flight, a window on the landing with the upper flight coming back, or the photo taken from the landing facing the opposite direction all mean a U-turn. Never use "straight" unless the flights are clearly in one line.
- Count each flight separately from its own bottom (step 1 = lowest tread of that flight). The landing itself is NOT a step of either flight. The lower flight's last riser goes up to the landing; if the upper floor is the top of the upper flight, end the upper flight with a riser (add_riser).

For each flight work out:
- how many treads and risers. If the top step is the floor/landing itself, the flight ends with a riser only (use add_riser).
- which sides are OPEN as seen standing at the bottom of that flight looking up: a side is open when there is no wall right against the step (exposed side/stringer, or a temporary 2x4 guard rail where a balustrade will go). Closed = between walls.
- a bigger starter step at the bottom (wider/longer or bullnose) → set_steps for step 1 with its own sizes and ret "bullnose" if rounded.
Sizes (inches, decimals) come from what the builder said or typed (any language: English, Portuguese, Spanish). Use them exactly. If no size was given for something, estimate a typical value from the photo (tread depth 10–11.25, riser 7–7.75, width from the opening: 36, 42 or 48) and say in "reply" that the sizes are estimates to check.
Group equal steps: one add_steps per run of steps with the same sizes and open sides; use set_steps only for exceptions.
Start with add_stair unless the builder says to fill the current stair.
Return ONLY JSON: {"flights": <number of flights you found>, "actions":[...], "reply":"<one or two short sentences: what you built, e.g. '2 flights with a landing (U-turn to the left): 8 steps up to the landing, then 9 to the upper floor'>", "unclear":"<what you could not see or understand, or empty>", "observations":["<short notes the installer should know, e.g. 'Landing at the window', 'Right side open on the lower flight'>"]}.
Action shapes:
{"type":"add_stair","name":"Lower flight","landing":true,"landing_w":42,"landing_d":42}
{"type":"add_steps","stair":0,"count":8,"tread_w":42,"tread_d":11.25,"riser_w":42,"riser_h":7.5,"open":"right","ret":"45"}
{"type":"add_riser","stair":0,"count":1,"riser_w":42,"riser_h":7.5}
{"type":"add_stair","name":"Upper flight","starts_on_landing_of":0,"turn":"u_left"}
{"type":"add_steps","stair":1,"count":9,"tread_w":42,"tread_d":11.25,"riser_w":42,"riser_h":7.5,"open":"left"}
{"type":"set_steps","stair":0,"from":1,"to":1,"tread_w":48,"tread_d":12,"open":"both","ret":"bullnose"}
{"type":"set_stair","stair":0,"landing":true,"landing_w":42,"landing_d":42}
Stair indexes are 0-based and count the stairs already in the measurement: the first add_stair gets index = number of stairs already there, the next one +1.`;

export async function stairFromPhotos(input: { photos: string[]; text?: string; audio?: string; data: unknown }): Promise<{ transcript: string; actions: VoiceAction[]; reply: string; unclear: string; observations: string[] }> {
  if (!isAiConfigured()) throw new BuilderError(503, "Mate is not set up on this server yet.");
  const photos = (input.photos || []).filter((p) => /^data:image\/(jpeg|png|webp);base64,/.test(String(p))).slice(0, 4);
  if (!photos.length) throw new BuilderError(400, "Add at least one photo of the stair.");
  if (photos.some((p) => p.length > 6 * 1024 * 1024)) throw new BuilderError(400, "A photo is too large.");
  let said = String(input.text || "").trim().slice(0, 1500);
  let transcript = "";
  if (input.audio) {
    const m = /^data:([^;]+)(?:;[^,]*)?;base64,(.+)$/.exec(String(input.audio));
    if (m && /^audio\//.test(m[1]!.toLowerCase())) {
      const body = Buffer.from(m[2]!, "base64");
      if (body.length >= 800 && body.length <= 12 * 1024 * 1024) {
        const tr = await aiTranscribeAudio({ body, contentType: m[1]!.toLowerCase(), languages: ["en", "pt", "es"], prompt: "Stair: 9 steps, 42 by 11 1/4, riser 7 1/2, right side open, left side open, landing, bullnose. Degrau, espelho, lado direito aberto.", timeoutMs: 45_000 });
        if (tr.ok) { transcript = tr.text.trim(); said = [said, transcript].filter(Boolean).join("\n"); }
      }
    }
  }
  const data = parseData(input.data);
  const res = await aiChatJson({
    system: PHOTO_SYSTEM,
    user: `Stairs already in this measurement: ${data.stairs.length} (so the first new stair is index ${data.stairs.length}).\n\nWhat the builder said or typed (may be empty):\n"""${said || "(nothing — estimate the sizes)"}"""\n\n${photos.length} photo(s) follow. They may show different flights of the same stair — check for a landing between flights before counting.`,
    imageUrls: photos,
    timeoutMs: 60_000,
  });
  if (!res.ok) throw new BuilderError(502, "Mate couldn’t look at the photos right now. Try again.");
  let raw: { actions?: unknown; reply?: unknown; unclear?: unknown; observations?: unknown } = {};
  try {
    const t = res.text;
    raw = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
  } catch {
    raw = {};
  }
  const parsedActions: VoiceAction[] = [];
  for (const a of Array.isArray(raw.actions) ? raw.actions.slice(0, 40) : []) {
    const parsed = voiceActionSchema.safeParse(a);
    if (parsed.success) parsedActions.push(parsed.data);
  }
  const { actions, checks } = checkActions(linkFlights(parsedActions, data.stairs.length));
  return {
    transcript,
    actions,
    reply: String(raw.reply || "").slice(0, 400),
    unclear: [String(raw.unclear || "").slice(0, 300), ...checks].filter(Boolean).join(" "),
    observations: (Array.isArray(raw.observations) ? raw.observations : []).map((o) => String(o).slice(0, 160)).filter(Boolean).slice(0, 6),
  };
}
