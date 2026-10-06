/**
 * Field Quote (módulo extra) — medição e orçamento na casa do cliente, feito no celular.
 *
 *   GET    /api/field-quotes                 lista (rascunhos e já orçados), ?lead_id=
 *   POST   /api/field-quotes                 cria (pode vir de um lead ou de uma visita da agenda)
 *   GET    /api/field-quotes/:id
 *   PUT    /api/field-quotes/:id             salva cliente + data (serviços, cômodos, extras, respostas)
 *   DELETE /api/field-quotes/:id
 *   POST   /api/field-quotes/:id/photos      foto (data_url) → storage; vai para o ObraCam quando virar job
 *   POST   /api/field-quotes/:id/link-quote  liga o orçamento gerado (quote_id, lead_id)
 *
 * The catalog (services, materials, rooms, extras, questions) lives in the front end
 * (crm/public/field-quote-catalog.js); prices come from the Tabela de Valores (/api/pricing).
 */
import { Router } from "express";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import type { AuthedRequest } from "../../middleware/auth.js";
import { requireCrmAuth } from "../http.js";
import { withTenantTransaction, type TenantPrisma } from "../../lib/tenant/prisma-tenant.js";
import { orgScoped } from "../../lib/tenant/org-scoped.js";
import { storage } from "../../lib/storage/index.js";

export const fieldQuotesRouter = Router();

const CUSTOMER_TYPES = new Set(["particular", "builder", "contractor", "loja"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function can(req: AuthedRequest, perm: "view" | "edit"): boolean {
  const u = req.user;
  if (!u) return false;
  if (u.roleKey === "admin") return true;
  const p = u.permissions || [];
  if (perm === "view") return p.includes("quotes.view") || p.includes("quotes.create") || p.includes("leads.edit");
  return p.includes("quotes.create") || p.includes("quotes.edit") || p.includes("leads.edit");
}

export function isFieldQuoteEnabled(flags: unknown): boolean {
  if (!flags || typeof flags !== "object" || Array.isArray(flags)) return true;
  const f = flags as Record<string, unknown>;
  return !(f.field_quote === false || f.fieldQuote === false);
}

async function guard(req: AuthedRequest, res: import("express").Response, perm: "view" | "edit"): Promise<boolean> {
  if (!can(req, perm)) {
    res.status(403).json({ success: false, error: "Sem permissão para o Field Quote." });
    return false;
  }
  const org = await withTenantTransaction(req.organizationId!, (tx) =>
    tx.organization.findFirst({ where: { id: req.organizationId! }, select: { featureFlags: true } }),
  );
  if (!isFieldQuoteEnabled(org?.featureFlags)) {
    res.status(403).json({ success: false, error: "O Field Quote não está ativo para esta empresa.", code: "MODULE_OFF" });
    return false;
  }
  return true;
}

const txFor = <T>(req: AuthedRequest, fn: (tx: TenantPrisma) => Promise<T>) =>
  withTenantTransaction(req.organizationId!, (tx) => fn(orgScoped(tx, req.organizationId!)));

const num = (v: unknown, max = 1e9) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n * 100) / 100)) : 0;
};
const str = (v: unknown, max = 500) => (v == null ? null : String(v).trim().slice(0, max) || null);

type Row = {
  id: string;
  leadId: string | null;
  meetingId: string | null;
  quoteId: string | null;
  status: string;
  clientName: string;
  clientPhone: string | null;
  clientEmail: string | null;
  address: string | null;
  customerType: string;
  data: unknown;
  totalSqft: unknown;
  total: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function mapRow(r: Row, opts?: { full?: boolean; quote?: { quoteNumber: string | null; number: number; status: string; publicToken: string | null } | null }) {
  const data = r.data && typeof r.data === "object" && !Array.isArray(r.data) ? (r.data as Record<string, unknown>) : {};
  const rooms = Array.isArray(data.rooms) ? data.rooms : [];
  const photos = Array.isArray(data.photos) ? data.photos : [];
  return {
    id: r.id,
    lead_id: r.leadId,
    meeting_id: r.meetingId,
    quote_id: r.quoteId,
    status: r.status,
    client_name: r.clientName,
    client_phone: r.clientPhone,
    client_email: r.clientEmail,
    address: r.address,
    customer_type: r.customerType,
    total_sqft: Number(r.totalSqft) || 0,
    total: Number(r.total) || 0,
    rooms_count: rooms.length,
    photos_count: photos.length,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
    ...(opts?.full ? { data } : {}),
    ...(opts?.quote
      ? { quote: { number: opts.quote.quoteNumber || String(opts.quote.number), status: opts.quote.status, public_token: opts.quote.publicToken } }
      : {}),
  };
}

fieldQuotesRouter.get("/api/field-quotes", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!(await guard(req, res, "view"))) return;
    const leadId = req.query.lead_id && UUID_RE.test(String(req.query.lead_id)) ? String(req.query.lead_id) : null;
    const rows = await txFor(req, (tx) =>
      tx.fieldQuote.findMany({
        where: leadId ? { leadId } : {},
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
    );
    res.json({ success: true, data: rows.map((r) => mapRow(r)) });
  } catch (e) {
    next(e);
  }
});

fieldQuotesRouter.post("/api/field-quotes", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!(await guard(req, res, "edit"))) return;
    const b = (req.body || {}) as Record<string, unknown>;
    const leadIdIn = b.lead_id && UUID_RE.test(String(b.lead_id)) ? String(b.lead_id) : null;
    const meetingIdIn = b.meeting_id && UUID_RE.test(String(b.meeting_id)) ? String(b.meeting_id) : null;
    const row = await txFor(req, async (tx) => {
      // A visit on the agenda points at its lead.
      let leadId = leadIdIn;
      let meetingId: string | null = null;
      let address: string | null = str(b.address);
      if (meetingIdIn) {
        const m = await tx.meeting.findFirst({ where: { id: meetingIdIn }, select: { id: true, leadId: true, location: true } });
        if (m) {
          meetingId = m.id;
          leadId = leadId || m.leadId;
          address = address || m.location;
        }
      }
      let clientName = str(b.client_name, 200);
      let clientPhone = str(b.client_phone, 60);
      let clientEmail = str(b.client_email, 200);
      if (leadId) {
        const lead = await tx.lead.findFirst({ where: { id: leadId } });
        if (!lead) leadId = null;
        else {
          // Re-open the draft that already exists for this lead instead of starting a second one.
          const open = await tx.fieldQuote.findFirst({ where: { leadId, status: "draft" }, orderBy: { updatedAt: "desc" } });
          if (open && b.force_new !== true) return { row: open, reused: true };
          const meta = lead.metadata && typeof lead.metadata === "object" && !Array.isArray(lead.metadata) ? (lead.metadata as Record<string, unknown>) : {};
          clientName = clientName || lead.name;
          clientPhone = clientPhone || lead.phone;
          clientEmail = clientEmail || lead.email;
          if (!address && meta.address) {
            const zip = meta.zipcode && String(meta.zipcode) !== "00000" ? String(meta.zipcode) : "";
            address = String(meta.address) + (zip && !String(meta.address).includes(zip) ? `, ${zip}` : "");
          }
        }
      }
      const ct = String(b.customer_type || "particular").toLowerCase();
      const created = await tx.fieldQuote.create({
        data: {
          organizationId: req.organizationId!,
          leadId,
          meetingId,
          createdById: req.user?.id ?? null,
          clientName: clientName || "Novo cliente",
          clientPhone,
          clientEmail,
          address,
          customerType: CUSTOMER_TYPES.has(ct) ? ct : "particular",
          data: { version: 1, services: [], rooms: [], extras: {}, answers: {}, photos: [] } as Prisma.InputJsonValue,
        },
      });
      return { row: created, reused: false };
    });
    res.status(row.reused ? 200 : 201).json({ success: true, data: mapRow(row.row, { full: true }), reused: row.reused });
  } catch (e) {
    next(e);
  }
});

fieldQuotesRouter.get("/api/field-quotes/:id", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!(await guard(req, res, "view"))) return;
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) {
      res.status(404).json({ success: false, error: "Field Quote não encontrado" });
      return;
    }
    const out = await txFor(req, async (tx) => {
      const row = await tx.fieldQuote.findFirst({ where: { id } });
      if (!row) return null;
      const quote = row.quoteId
        ? await tx.quote.findFirst({ where: { id: row.quoteId }, select: { quoteNumber: true, number: true, status: true, publicToken: true } })
        : null;
      return { row, quote };
    });
    if (!out) {
      res.status(404).json({ success: false, error: "Field Quote não encontrado" });
      return;
    }
    res.json({ success: true, data: mapRow(out.row, { full: true, quote: out.quote }) });
  } catch (e) {
    next(e);
  }
});

fieldQuotesRouter.put("/api/field-quotes/:id", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!(await guard(req, res, "edit"))) return;
    const id = String(req.params.id);
    const b = (req.body || {}) as Record<string, unknown>;
    const out = await txFor(req, async (tx) => {
      const row = await tx.fieldQuote.findFirst({ where: { id } });
      if (!row) return null;
      const prev = row.data && typeof row.data === "object" && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : {};
      let data: Record<string, unknown> | undefined;
      if (b.data && typeof b.data === "object" && !Array.isArray(b.data)) {
        data = { ...(b.data as Record<string, unknown>) };
        // Photos are only added through the upload route; keep the server's list.
        data.photos = Array.isArray(prev.photos)
          ? (prev.photos as Array<Record<string, unknown>>).map((p) => {
              const sent = Array.isArray((b.data as Record<string, unknown>).photos)
                ? ((b.data as Record<string, unknown>).photos as Array<Record<string, unknown>>).find((x) => x && x.id === p.id)
                : null;
              return sent ? { ...p, room_id: sent.room_id ?? p.room_id ?? null, caption: str(sent.caption, 200) } : p;
            })
          : [];
        // Removal is explicit, so an autosave sent before an upload finished can't drop the new photo.
        const removed = Array.isArray(data.photos_removed) ? new Set((data.photos_removed as unknown[]).map(String)) : null;
        delete data.photos_removed;
        if (removed && removed.size) data.photos = (data.photos as Array<Record<string, unknown>>).filter((p) => !removed.has(String(p.id)));
        const json = JSON.stringify(data);
        if (json.length > 2_000_000) throw Object.assign(new Error("Field Quote grande demais."), { status: 413 });
      }
      const ct = b.customer_type != null ? String(b.customer_type).toLowerCase() : null;
      const updated = await tx.fieldQuote.update({
        where: { id: row.id },
        data: {
          ...(b.client_name !== undefined ? { clientName: str(b.client_name, 200) || row.clientName } : {}),
          ...(b.client_phone !== undefined ? { clientPhone: str(b.client_phone, 60) } : {}),
          ...(b.client_email !== undefined ? { clientEmail: str(b.client_email, 200) } : {}),
          ...(b.address !== undefined ? { address: str(b.address) } : {}),
          ...(ct && CUSTOMER_TYPES.has(ct) ? { customerType: ct } : {}),
          ...(b.total !== undefined ? { total: new Prisma.Decimal(num(b.total)) } : {}),
          ...(b.total_sqft !== undefined ? { totalSqft: new Prisma.Decimal(num(b.total_sqft)) } : {}),
          ...(data ? { data: data as Prisma.InputJsonValue } : {}),
        },
      });
      return updated;
    });
    if (!out) {
      res.status(404).json({ success: false, error: "Field Quote não encontrado" });
      return;
    }
    res.json({ success: true, data: mapRow(out, { full: true }) });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status) {
      res.status(status).json({ success: false, error: (e as Error).message });
      return;
    }
    next(e);
  }
});

fieldQuotesRouter.delete("/api/field-quotes/:id", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!(await guard(req, res, "edit"))) return;
    const id = String(req.params.id);
    const ok = await txFor(req, async (tx) => {
      const row = await tx.fieldQuote.findFirst({ where: { id } });
      if (!row) return false;
      await tx.fieldQuote.delete({ where: { id: row.id } });
      return true;
    });
    if (!ok) {
      res.status(404).json({ success: false, error: "Field Quote não encontrado" });
      return;
    }
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

fieldQuotesRouter.post("/api/field-quotes/:id/photos", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!(await guard(req, res, "edit"))) return;
    const id = String(req.params.id);
    const b = (req.body || {}) as Record<string, unknown>;
    const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/is.exec(String(b.data_url || ""));
    if (!m) {
      res.status(400).json({ success: false, error: "Envie a foto (data_url de imagem)." });
      return;
    }
    const body = Buffer.from(m[2]!, "base64");
    if (body.length > 10 * 1024 * 1024) {
      res.status(400).json({ success: false, error: "Foto grande demais (máx. 10MB)." });
      return;
    }
    const row = await txFor(req, (tx) => tx.fieldQuote.findFirst({ where: { id }, select: { id: true } }));
    if (!row) {
      res.status(404).json({ success: false, error: "Field Quote não encontrado" });
      return;
    }
    const contentType = m[1]!.toLowerCase();
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    const key = `orgs/${req.organizationId}/field-quotes/${id}/${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
    const stored = await storage.upload({ key, body, contentType });
    const photo = {
      id: randomUUID(),
      url: stored.url,
      key: stored.key,
      sha256: createHash("sha256").update(body).digest("hex"),
      room_id: str(b.room_id, 80),
      caption: str(b.caption, 200),
      lat: Number.isFinite(Number(b.lat)) ? Number(b.lat) : null,
      lng: Number.isFinite(Number(b.lng)) ? Number(b.lng) : null,
      taken_at: str(b.taken_at, 40) || new Date().toISOString(),
      author_id: req.user?.id ?? null,
    };
    const saved = await txFor(req, async (tx) => {
      const cur = await tx.fieldQuote.findFirst({ where: { id } });
      if (!cur) return null;
      const data = cur.data && typeof cur.data === "object" && !Array.isArray(cur.data) ? { ...(cur.data as Record<string, unknown>) } : {};
      const photos = Array.isArray(data.photos) ? [...(data.photos as unknown[])] : [];
      if (photos.length >= 80) throw Object.assign(new Error("Limite de 80 fotos por Field Quote."), { status: 400 });
      photos.push(photo);
      data.photos = photos;
      await tx.fieldQuote.update({ where: { id }, data: { data: data as Prisma.InputJsonValue } });
      return photo;
    });
    if (!saved) {
      res.status(404).json({ success: false, error: "Field Quote não encontrado" });
      return;
    }
    res.status(201).json({ success: true, data: saved });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status) {
      res.status(status).json({ success: false, error: (e as Error).message });
      return;
    }
    next(e);
  }
});

fieldQuotesRouter.post("/api/field-quotes/:id/link-quote", requireCrmAuth, async (req: AuthedRequest, res, next) => {
  try {
    if (!(await guard(req, res, "edit"))) return;
    const id = String(req.params.id);
    const b = (req.body || {}) as Record<string, unknown>;
    const quoteId = b.quote_id && UUID_RE.test(String(b.quote_id)) ? String(b.quote_id) : null;
    const leadId = b.lead_id && UUID_RE.test(String(b.lead_id)) ? String(b.lead_id) : null;
    const out = await txFor(req, async (tx) => {
      const row = await tx.fieldQuote.findFirst({ where: { id } });
      if (!row) return null;
      if (quoteId && !(await tx.quote.findFirst({ where: { id: quoteId }, select: { id: true } }))) return { bad: "quote" } as const;
      if (leadId && !(await tx.lead.findFirst({ where: { id: leadId }, select: { id: true } }))) return { bad: "lead" } as const;
      const updated = await tx.fieldQuote.update({
        where: { id: row.id },
        data: {
          ...(quoteId ? { quoteId, status: "quoted" } : {}),
          ...(leadId ? { leadId } : {}),
        },
      });
      return { row: updated };
    });
    if (!out) {
      res.status(404).json({ success: false, error: "Field Quote não encontrado" });
      return;
    }
    if ("bad" in out) {
      res.status(400).json({ success: false, error: out.bad === "quote" ? "Orçamento inválido" : "Lead inválido" });
      return;
    }
    res.json({ success: true, data: mapRow(out.row, { full: true }) });
  } catch (e) {
    next(e);
  }
});
