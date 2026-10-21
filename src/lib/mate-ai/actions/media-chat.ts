/**
 * ObraCam (job photos) and ObraChat (team chat): photos of a job, jobs without "before"
 * photos, portfolio, captions; posting to a job's channel, mentions and groups.
 */
import { callInternalApi, internalError } from "../internal-api.js";
import { nameSimilarity } from "../match.js";
import { jobLabel, resolveJob } from "./resolve.js";
import { addDays, dayRange, fmtDate } from "./time.js";
import type { ActionContext, ActionDef, ListItem, PickItem } from "./types.js";
import { dayIn, kept, num, plural, runEach, str } from "./types.js";

const enc = encodeURIComponent;
const jobPhotos = (id: string) => ({ label: "Ver fotos do job", href: "job-detail.html?id=" + enc(id) + "#fotos" });
const STAGE_PT: Record<string, string> = { before: "antes", during: "durante", after: "depois" };

async function jobOr(ctx: ActionContext, args: Record<string, unknown>) {
  const r = await resolveJob(ctx, args);
  if (r.status === "clarify") return { done: { kind: "clarify" as const, clarify: r.clarify, args } };
  if (r.status === "missing") return { done: { kind: "error" as const, message: r.message, args } };
  return { job: r.row };
}

/* ───────────────────────── ObraCam ───────────────────────── */

export const jobMedia: ActionDef = {
  name: "media.list",
  description: "Show a job's photos (ObraCam): how many, before/during/after, latest captions, with a link to the gallery.",
  args: { job: "job number/title" },
  examples: ["Mostra as fotos do job 1042", "Photos of the Smith job"],
  permissions: ["work_orders.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const got = await jobOr(ctx, args);
    if (got.done) return got.done;
    const job = got.job!;
    const rows = await ctx.tx.jobMedia.findMany({ where: { workOrderId: job.id, deletedAt: null }, select: { id: true, caption: true, stage: true, createdAt: true, inPortfolio: true, author: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
    const by = (s: string) => rows.filter((r) => r.stage === s).length;
    const items: ListItem[] = rows.slice(0, 8).map((r) => ({ title: r.caption || "Foto sem legenda", detail: [r.stage ? STAGE_PT[r.stage] : null, r.author?.name, fmtDate(dayIn(r.createdAt, ctx.timezone)!), r.inPortfolio ? "portfólio" : null].filter(Boolean).join(" · ") }));
    return {
      kind: "answer",
      args: { ...args, job_id: job.id },
      card: {
        title: `${plural(rows.length, "foto", "fotos")} · ${jobLabel(job)}`,
        subtitle: rows.length ? `antes ${by("before")} · durante ${by("during")} · depois ${by("after")}` : undefined,
        sections: [{ type: "list", items, empty: "Nenhuma foto ainda." }],
        links: [jobPhotos(job.id), { label: "Abrir ObraCam", href: "job-media-board.html" }],
      },
    };
  },
};

export const jobsWithoutBefore: ActionDef = {
  name: "media.missing_before",
  description: "Jobs starting soon or in progress with no 'before' photo yet (ObraCam).",
  args: { days: "how many days ahead (default 7)" },
  examples: ["Quais jobs estão sem foto de antes?", "Jobs missing before photos"],
  permissions: ["work_orders.view"],
  readOnly: true,
  async prepare(ctx, args) {
    const days = Math.min(30, Math.max(1, Math.round(num(args.days) ?? 7)));
    const { start, end } = dayRange(addDays(ctx.today, -7), addDays(ctx.today, days), ctx.timezone);
    const jobs = await ctx.tx.workOrder.findMany({
      where: { status: { in: ["scheduled", "in_progress"] }, scheduledStart: { gte: start, lt: end }, media: { none: { stage: "before", deletedAt: null } } },
      select: { id: true, number: true, title: true, scheduledStart: true, customer: { select: { name: true } }, crew: { select: { name: true } } },
      orderBy: { scheduledStart: "asc" },
      take: 30,
    });
    return {
      kind: "answer",
      args,
      card: {
        title: jobs.length ? `${plural(jobs.length, "job sem foto de antes", "jobs sem foto de antes")}` : "Todos os jobs têm foto de antes",
        sections: [{ type: "list", items: jobs.map((j) => ({ title: jobLabel(j), detail: [j.customer?.name, j.scheduledStart ? fmtDate(dayIn(j.scheduledStart, ctx.timezone)!) : null, j.crew?.name].filter(Boolean).join(" · "), href: "job-detail.html?id=" + enc(j.id), tone: "warning" as const, run: { label: "Avisar equipe", action: "chat.post", args: { job_id: j.id, text: "Lembrete: tirem as fotos de ANTES deste job, por favor." } } })), empty: "Nada pendente." }],
        open: { label: "Abrir ObraCam", href: "job-media-board.html" },
      },
    };
  },
};

export const portfolioPhotos: ActionDef = {
  name: "media.portfolio",
  description: "Put a job's photos in the company portfolio (public). Lists the 'after' photos first to pick.",
  args: { job: "job number/title" },
  examples: ["Usa as fotos do 1042 no portfólio", "Add the Smith job photos to the portfolio"],
  permissions: ["work_orders.manage"],
  async prepare(ctx, args) {
    const got = await jobOr(ctx, args);
    if (got.done) return got.done;
    const job = got.job!;
    const rows = await ctx.tx.jobMedia.findMany({ where: { workOrderId: job.id, deletedAt: null, inPortfolio: false, type: "photo" }, select: { id: true, caption: true, stage: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 60 });
    if (!rows.length) return { kind: "error", message: `${jobLabel(job)} não tem fotos novas para o portfólio.`, args };
    const order = (s: string | null) => (s === "after" ? 0 : s === "during" ? 1 : 2);
    rows.sort((a, b) => order(a.stage) - order(b.stage));
    const items: PickItem[] = rows.map((r) => ({ id: r.id, title: r.caption || "Foto", detail: [r.stage ? STAGE_PT[r.stage] : "sem etapa", fmtDate(dayIn(r.createdAt, ctx.timezone)!)].join(" · ") }));
    return {
      kind: "card",
      args: { ...args, job_id: job.id },
      card: {
        title: "Portfólio · " + jobLabel(job),
        sections: [{ type: "pick", items }, { type: "note", text: "As fotos marcadas ficam públicas no portfólio da empresa." }],
        confirm: { label: "Pôr no portfólio", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ job_id: job.id, label: jobLabel(job), items: rows.map((r) => ({ id: r.id })) }) } } },
        links: [jobPhotos(job.id)],
      },
    };
  },
  async execute(ctx, exec) {
    const items = kept(ctx, (exec.items || []) as Array<{ id: string }>);
    if (!items.length) return { ok: false, status: 400, error: "Nenhuma foto marcada." };
    const r = await runEach(items, async (it) => {
      const res = await callInternalApi(ctx.req, "PATCH", `/api/work-orders/${enc(String(exec.job_id))}/media/${enc(it.id)}/portfolio`, { in_portfolio: true });
      return { ok: res.ok, error: internalError(res, "falhou") };
    });
    if (!r.done.length) return { ok: false, status: 502, error: r.failed[0]?.error || "Nada mudou." };
    return { ok: true, title: `${plural(r.done.length, "foto no portfólio", "fotos no portfólio")}`, detail: String(exec.label), links: [jobPhotos(String(exec.job_id))], undo: { job_id: exec.job_id, ids: r.done.map((d) => d.id) }, entity: { type: "work_order", id: String(exec.job_id) }, memory: `Added ${r.done.length} photos of ${exec.label} to the portfolio` };
  },
  async undo(ctx, u) {
    const ids = (u.ids || []) as string[];
    await runEach(ids, async (id) => {
      const res = await callInternalApi(ctx.req, "PATCH", `/api/work-orders/${enc(String(u.job_id))}/media/${enc(id)}/portfolio`, { in_portfolio: false });
      return { ok: res.ok };
    });
    return { ok: true, title: "Fotos tiradas do portfólio" };
  },
};

export const captionPhoto: ActionDef = {
  name: "media.caption",
  description: "Write the caption of the latest photo of a job (by voice), optionally its stage (before/during/after).",
  args: { job: "job number/title", caption: "caption text", stage: "before | during | after (optional)" },
  examples: ["Legenda esta foto: rodapé trocado na sala", "Caption the last photo: subfloor leveled"],
  permissions: [],
  anyPermissions: ["work_orders.view", "payroll.self"],
  async prepare(ctx, args) {
    const got = await jobOr(ctx, args);
    if (got.done) return got.done;
    const job = got.job!;
    const caption = str(args.caption, 400);
    if (!caption) return { kind: "clarify", args: { ...args, job_id: job.id }, clarify: { question: "Qual a legenda?", options: [], search: { placeholder: "Legenda", path: "caption" } } };
    const photo = await ctx.tx.jobMedia.findFirst({ where: { workOrderId: job.id, deletedAt: null, ...(args.media_id ? { id: String(args.media_id) } : {}) }, orderBy: [{ authorId: "desc" }, { createdAt: "desc" }], select: { id: true, caption: true, createdAt: true, author: { select: { name: true } } } });
    if (!photo) return { kind: "error", message: `${jobLabel(job)} não tem fotos.`, args };
    const stage = ["before", "during", "after"].includes(str(args.stage)) ? str(args.stage) : null;
    return {
      kind: "card",
      args: { ...args, job_id: job.id, media_id: photo.id },
      card: {
        title: "Legenda da última foto",
        subtitle: [jobLabel(job), photo.author?.name, fmtDate(dayIn(photo.createdAt, ctx.timezone)!)].filter(Boolean).join(" · "),
        sections: [{ type: "fields", rows: [{ label: "Antes", value: photo.caption || "sem legenda" }, { label: "Nova", value: caption, edit: { path: "caption", input: "text", value: caption } }, ...(stage ? [{ label: "Etapa", value: STAGE_PT[stage]! }] : [])] }],
        confirm: { label: "Salvar legenda", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ job_id: job.id, media_id: photo.id, caption, stage, prev: photo.caption }) } } },
        links: [jobPhotos(job.id)],
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi(ctx.req, "PATCH", `/api/campo/jobs/${enc(String(exec.job_id))}/media/${enc(String(exec.media_id))}`, { caption: exec.caption, ...(exec.stage ? { stage: exec.stage } : {}) });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui salvar a legenda.") };
    return { ok: true, title: "Legenda salva", detail: String(exec.caption), links: [jobPhotos(String(exec.job_id))], undo: { job_id: exec.job_id, media_id: exec.media_id, caption: exec.prev ?? null }, memory: `Captioned a photo: ${exec.caption}` };
  },
  async undo(ctx, u) {
    const res = await callInternalApi(ctx.req, "PATCH", `/api/campo/jobs/${enc(String(u.job_id))}/media/${enc(String(u.media_id))}`, { caption: u.caption });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui desfazer.") };
    return { ok: true, title: "Legenda anterior restaurada" };
  },
};

/* ───────────────────────── ObraChat ───────────────────────── */

export const postToJob: ActionDef = {
  name: "chat.post",
  description: "Post a message to a job's team channel in ObraChat (the crew sees it in the app).",
  args: { job: "job number/title", text: "the message" },
  examples: ["Avisa a equipe do 1042 que o material chega às 8h", "Tell the Smith crew to bring the edger"],
  permissions: ["chat.use"],
  async prepare(ctx, args) {
    const got = await jobOr(ctx, args);
    if (got.done) return got.done;
    const job = got.job!;
    const text = str(args.text, 2000);
    if (!text) return { kind: "clarify", args: { ...args, job_id: job.id }, clarify: { question: "O que mandar para a equipe?", options: [], search: { placeholder: "Mensagem", path: "text" } } };
    return {
      kind: "card",
      args: { ...args, job_id: job.id },
      card: {
        title: "Mensagem no canal do " + jobLabel(job),
        badge: { text: "Vai para a equipe", tone: "warning" },
        sections: [{ type: "fields", rows: [{ label: "Mensagem", value: text, edit: { path: "text", input: "text", value: text } }] }],
        confirm: { label: "Enviar", tone: "send", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ job_id: job.id, label: jobLabel(job), text }) } } },
        open: { label: "Abrir ObraChat", href: "chat.html" },
      },
    };
  },
  async execute(ctx, exec) {
    const ch = await callInternalApi<{ data?: { conversationId: string } }>(ctx.req, "POST", `/api/chat/jobs/${enc(String(exec.job_id))}/ensure-channel`, {});
    const cid = ch.json.data?.conversationId;
    if (!ch.ok || !cid) return { ok: false, status: ch.status, error: internalError(ch, "Não consegui abrir o canal do job.") };
    const res = await callInternalApi(ctx.req, "POST", `/api/chat/conversations/${enc(cid)}/messages`, { body: exec.text });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui enviar.") };
    return { ok: true, title: "Mensagem enviada · " + exec.label, detail: String(exec.text), links: [{ label: "Abrir conversa", href: "chat.html?c=" + enc(cid) }], entity: { type: "work_order", id: String(exec.job_id) }, memory: `Posted to job ${exec.label} channel: ${exec.text}` };
  },
};

export const myMentions: ActionDef = {
  name: "chat.mentions",
  description: "My unread mentions in ObraChat (who wrote, where, what).",
  args: {},
  examples: ["Tenho menções não lidas?", "Did anyone mention me?"],
  permissions: ["chat.use"],
  readOnly: true,
  async prepare(ctx, args) {
    const res = await callInternalApi<{ data?: Array<{ created_at: string; message: { body: string; author: { name: string } | null; conversation: { id: string; name: string | null } } }> }>(ctx.req, "GET", "/api/chat/mentions?unread=1");
    const rows = res.json.data || [];
    return {
      kind: "answer",
      args,
      card: {
        title: rows.length ? `${plural(rows.length, "menção não lida", "menções não lidas")}` : "Nenhuma menção não lida",
        sections: [{ type: "list", items: rows.slice(0, 10).map((m) => ({ title: `${m.message.author?.name || "Alguém"}: ${m.message.body.slice(0, 120)}`, detail: [m.message.conversation.name, fmtDate(dayIn(m.created_at, ctx.timezone)!)].filter(Boolean).join(" · "), href: "chat.html?c=" + enc(m.message.conversation.id) })), empty: "Tudo lido." }],
        open: { label: "Abrir ObraChat", href: "chat.html" },
      },
    };
  },
};

export const createGroup: ActionDef = {
  name: "chat.group",
  description: "Create an ObraChat group with some team members.",
  args: { name: "group name", members: "names of the people, e.g. ['Carlos', 'Pedro']" },
  examples: ["Cria um grupo com Carlos e Pedro", "Make a group 'Equipe de lixa' with Luis and Ana"],
  permissions: ["chat.use", "chat.create_group"],
  async prepare(ctx, args) {
    const wanted = (Array.isArray(args.members) ? args.members : str(args.members).split(/,| e | and /)).map((x) => str(x, 60)).filter(Boolean);
    if (!wanted.length) return { kind: "clarify", args, clarify: { question: "Quem entra no grupo?", options: [], search: { placeholder: "Nomes separados por vírgula", path: "members" } } };
    const users = await ctx.tx.user.findMany({ where: { status: "active", id: { not: ctx.userId } }, select: { id: true, name: true }, take: 300 });
    const found: Array<{ id: string; name: string }> = [];
    const missing: string[] = [];
    for (const w of wanted) {
      const hit = users.map((u) => ({ u, s: nameSimilarity(w, [u.name]) })).sort((a, b) => b.s - a.s)[0];
      if (hit && hit.s >= 60) found.push(hit.u);
      else missing.push(w);
    }
    if (!found.length) return { kind: "error", message: `Não achei ${missing.join(", ")} entre os usuários.`, args };
    const name = str(args.name, 100) || found.map((u) => u.name.split(" ")[0]).join(", ");
    return {
      kind: "card",
      args,
      card: {
        title: "Novo grupo: " + name,
        sections: [{ type: "fields", rows: [{ label: "Nome", value: name, edit: { path: "name", input: "text", value: name } }, { label: "Pessoas", value: ["Você", ...found.map((u) => u.name)].join(", ") }] }, ...(missing.length ? [{ type: "note" as const, tone: "warning" as const, text: "Não achei: " + missing.join(", ") }] : [])],
        confirm: { label: "Criar grupo", tone: "normal", exec: { endpoint: "/api/mate-ai/execute", body: { token: ctx.sign({ name, ids: found.map((u) => u.id) }) } } },
        open: { label: "Abrir ObraChat", href: "chat.html" },
      },
    };
  },
  async execute(ctx, exec) {
    const res = await callInternalApi<{ data?: { id: string } }>(ctx.req, "POST", "/api/chat/conversations/groups", { name: exec.name, member_ids: exec.ids });
    if (!res.ok) return { ok: false, status: res.status, error: internalError(res, "Não consegui criar o grupo.") };
    const id = res.json.data?.id;
    return { ok: true, title: `Grupo “${exec.name}” criado`, links: id ? [{ label: "Abrir grupo", href: "chat.html?c=" + enc(id) }] : [], memory: `Created chat group ${exec.name}` };
  },
};

export const MEDIA_CHAT_ACTIONS: ActionDef[] = [jobMedia, jobsWithoutBefore, portfolioPhotos, captionPhoto, postToJob, myMentions, createGroup];
