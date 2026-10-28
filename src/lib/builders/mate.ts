/**
 * "Ask Mate" inside ObraBuilder: the builder asks (typing or talking) about their jobs, invoices,
 * measurements and companies. The app sends a compact snapshot of what this person can already
 * see; Mate answers in English and can suggest buttons that open a screen of the app.
 */
import { z } from "zod";
import { aiChatJson, aiTranscribeAudio, isAiConfigured } from "../ai/client.js";
import { BuilderError } from "./accounts.js";

const str = (max: number) => z.string().max(max).optional().nullable();

export const mateSnapshotSchema = z.object({
  today: str(40),
  builder: str(120),
  me: str(120),
  companies: z.array(z.object({ id: z.string().max(60), name: str(120), status: str(20), phone: str(40), email: str(200), address: str(300), active_jobs: z.number().optional() })).max(30).default([]),
  jobs: z.array(z.object({
    id: z.string().max(60), title: str(200), address: str(300), status: str(40), start: str(40), end: str(40), all_day: z.boolean().optional(), number: z.union([z.string(), z.number()]).optional().nullable(), company: str(120),
  })).max(120).default([]),
  invoices: z.array(z.object({ id: z.string().max(60), number: str(40), balance: z.number().optional().nullable(), state: str(40), due: str(40), job: str(300), company: str(120) })).max(80).default([]),
  measurements: z.array(z.object({ id: z.string().max(60), address: str(300), status: str(20), counts: str(200), updated: str(40) })).max(40).default([]),
  pickups: z.array(z.object({ name: str(80), address: str(300), hours: str(120), phone: str(40) })).max(30).default([]),
  requests: z.array(z.object({ title: str(200), status: str(20), created: str(40), company: str(120) })).max(30).default([]),
  money: z.boolean().optional(),
});
export type MateSnapshot = z.infer<typeof mateSnapshotSchema>;

const turnSchema = z.object({ role: z.enum(["user", "mate"]), text: z.string().max(1200) });

const SYSTEM = `You are Mate, the friendly fox assistant inside ObraBuilder — the app home builders use to send work orders to flooring companies, follow jobs, pay invoices and measure stairs and vents on site.
Answer the builder's question using ONLY the data snapshot provided. Be brief and concrete (1–4 short sentences, or a short list of up to 6 lines starting with "• "). Use US formats: dates like "Tue, Oct 28", times like "8:00 AM", money like "$1,250.00". Never invent jobs, prices, dates or people. If the data does not answer it, say so and suggest where to look.
If money is false, never mention invoice amounts or prices.
You may add up to 3 buttons that open screens of the app. Allowed href values ONLY:
"#jobs/<job id>", "#invoices/<invoice id>", "#measurements/<measurement id>", "#companies/<company id>", "#send", "#measurements/new", "#calendar", "#jobs", "#invoices", "#settings/pickups", "#settings/prices", "#team".
Use ids exactly as given in the snapshot.
Return ONLY JSON: {"answer": "<text>", "actions": [{"label": "<2-4 words>", "href": "<allowed href>"}]}`;

const HREF = /^#(jobs|invoices|measurements|companies)\/[A-Za-z0-9-]{6,60}$|^#(send|measurements\/new|calendar|jobs|invoices|settings\/pickups|settings\/prices|team)$/;

export async function askMate(input: { question?: string; audio?: string; snapshot: unknown; history?: unknown }): Promise<{ question: string; answer: string; actions: Array<{ label: string; href: string }> }> {
  if (!isAiConfigured()) throw new BuilderError(503, "Mate is not set up on this server yet.");
  let question = String(input.question || "").trim().slice(0, 600);
  if (!question && input.audio) {
    const m = /^data:([^;]+)(?:;[^,]*)?;base64,(.+)$/.exec(String(input.audio));
    if (!m || !/^audio\//.test(m[1]!.toLowerCase())) throw new BuilderError(400, "No audio received.");
    const body = Buffer.from(m[2]!, "base64");
    if (body.length < 800) throw new BuilderError(400, "The recording was too short.");
    if (body.length > 8 * 1024 * 1024) throw new BuilderError(400, "Keep it under 30 seconds.");
    const tr = await aiTranscribeAudio({ body, contentType: m[1]!.toLowerCase(), language: "en", prompt: "Questions about flooring jobs, invoices, stairs, treads, risers, vents, pickup, work orders.", timeoutMs: 40_000 });
    if (!tr.ok) throw new BuilderError(502, "Mate couldn’t hear that. Try again closer to the phone.");
    question = tr.text.trim().slice(0, 600);
  }
  if (!question) throw new BuilderError(400, "Ask Mate something.");
  const parsed = mateSnapshotSchema.safeParse(input.snapshot ?? {});
  const snap: MateSnapshot = parsed.success ? parsed.data : mateSnapshotSchema.parse({});
  const history = z.array(turnSchema).max(8).safeParse(input.history ?? []);
  const ids = new Set([...snap.jobs.map((j) => j.id), ...snap.invoices.map((i) => i.id), ...snap.measurements.map((m) => m.id), ...snap.companies.map((c) => c.id)]);
  const safeSnap = snap.money ? snap : { ...snap, invoices: [] };
  const res = await aiChatJson({
    system: SYSTEM,
    user: `Data snapshot (JSON):\n${JSON.stringify(safeSnap)}\n\n${history.success && history.data.length ? `Conversation so far:\n${history.data.map((t) => `${t.role === "mate" ? "Mate" : "Builder"}: ${t.text}`).join("\n")}\n\n` : ""}Builder asks: """${question}"""`,
    timeoutMs: 30_000,
  });
  if (!res.ok) throw new BuilderError(502, "Mate couldn’t answer right now. Try again.");
  let raw: { answer?: unknown; actions?: unknown } = {};
  try {
    const t = res.text;
    raw = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
  } catch {
    raw = { answer: res.text };
  }
  const actions = (Array.isArray(raw.actions) ? raw.actions : [])
    .map((a) => ({ label: String((a as { label?: unknown })?.label || "").trim().slice(0, 40), href: String((a as { href?: unknown })?.href || "").trim() }))
    .filter((a) => a.label && HREF.test(a.href))
    .filter((a) => {
      const id = /^#(?:jobs|invoices|measurements|companies)\/(.+)$/.exec(a.href)?.[1];
      return !id || id === "new" || ids.has(id);
    })
    .slice(0, 3);
  return { question, answer: String(raw.answer || "").trim().slice(0, 1500) || "I couldn’t find that in your data.", actions };
}
