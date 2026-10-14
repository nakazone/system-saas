import { Router, type Response } from "express";
import { storage } from "../storage/index.js";
import { systemAudit } from "../billing/audit.js";
import { requestIp } from "../security/db-rate-limit.js";
import { env } from "../../config/env.js";
import { exportFileName, findByToken, isDownloadable, markDownloaded } from "./export.js";

/**
 * /exportacao/:token — the link the Master sends so a company can download its data
 * (no login; works until the export expires; English, like everything the company's people receive).
 */
export const dataExportPublicRouter = Router();

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function pageHtml(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · ${esc(env.PRODUCT_NAME)}</title>
<style>body{margin:0;background:#f7f4ee;color:#211d1a;font:16px/1.5 -apple-system,"Segoe UI",Helvetica,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
.c{background:#fff;border-radius:20px;box-shadow:0 1px 0 #e2d9cc,0 20px 50px rgba(0,0,0,.06);max-width:460px;width:100%;padding:28px}
.b{font-weight:800;font-size:15px;display:flex;align-items:center;gap:8px;margin-bottom:18px}.b i{width:20px;height:20px;border-radius:6px;background:#c1652f;display:inline-block}
h1{font-size:22px;margin:0 0 6px}p{margin:0 0 14px;color:#6e655c}dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0 0 20px;font-size:14px}dt{color:#6e655c}dd{margin:0;font-weight:700}
a.btn{display:block;text-align:center;background:#211d1a;color:#fff;text-decoration:none;font-weight:800;padding:14px;border-radius:12px}small{display:block;margin-top:14px;color:#8a8076;font-size:12.5px}</style></head>
<body><main class="c"><div class="b"><i></i>${esc(env.PRODUCT_NAME)}</div>${body}</main></body></html>`;
}

function gone(res: Response) {
  res.status(410).type("html").send(
    pageHtml("Link expired", `<h1>This link has expired</h1><p>Download links work for 7 days. Ask ${esc(process.env.LEGAL_CONTACT_EMAIL || "support@obramate.com")} for a new copy of your data.</p>`),
  );
}

dataExportPublicRouter.get("/exportacao/:token", async (req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    const e = await findByToken(String(req.params.token));
    if (!e || !isDownloadable(e)) return gone(res);
    const mb = e.sizeBytes ? Number(e.sizeBytes) / 1024 / 1024 : 0;
    const size = mb < 1 ? `${Math.max(1, Math.round(mb * 1024))} KB` : `${mb.toFixed(1)} MB`;
    const until = e.expiresAt!.toLocaleString("en-US", { timeZone: "America/Denver", dateStyle: "medium", timeStyle: "short" });
    res.type("html").send(
      pageHtml(
        "Your data",
        `<h1>Your ${esc(env.PRODUCT_NAME)} data</h1><p>A copy of everything stored for <b>${esc(e.orgName)}</b>: one spreadsheet (CSV) per table plus every photo and file you uploaded.</p>
<dl><dt>File</dt><dd>${esc(exportFileName(e))}</dd><dt>Size</dt><dd>${size}</dd><dt>Contents</dt><dd>${e.tables} tables · ${e.rows.toLocaleString("en-US")} rows · ${e.files} files</dd><dt>Available until</dt><dd>${esc(until)} (Mountain Time)</dd></dl>
<a class="btn" href="/exportacao/${encodeURIComponent(String(req.params.token))}/download">Download ZIP</a><small>Keep this file safe — it contains your customers' and employees' information. The README inside explains each file.</small>`,
      ),
    );
  } catch (error) {
    next(error);
  }
});

dataExportPublicRouter.get("/exportacao/:token/download", async (req, res, next) => {
  try {
    res.setHeader("Cache-Control", "no-store");
    const e = await findByToken(String(req.params.token));
    if (!e || !isDownloadable(e)) return gone(res);
    const stream = await storage.getStream(e.fileKey!);
    if (!stream) return gone(res);
    await markDownloaded(e.id);
    await systemAudit("data.export_downloaded", { type: "organization", id: e.organizationId, label: e.orgName, meta: { exportId: e.id, by: "link", ip: requestIp(req) } }, "Empresa (link)");
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${exportFileName(e)}"`);
    if (e.sizeBytes) res.setHeader("Content-Length", String(e.sizeBytes));
    stream.pipe(res);
  } catch (error) {
    next(error);
  }
});
