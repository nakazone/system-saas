#!/usr/bin/env node
/**
 * Verifies DNS / HTTPS readiness for ObraMate multi-tenant on obramate.com.
 * Usage: node scripts/check-obramate-domain.mjs [rootDomain]
 */
import { execSync } from "node:child_process";
import { lookup } from "node:dns/promises";

const root = (process.argv[2] || process.env.APP_ROOT_DOMAIN || "obramate.com")
  .toLowerCase()
  .replace(/^https?:\/\//, "")
  .split("/")[0];

const checks = [];

function dig(host) {
  try {
    return execSync(`dig +short ${host} A`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function digCname(host) {
  try {
    return execSync(`dig +short ${host} CNAME`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

async function httpOk(url) {
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow" });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  console.log(`\nObraMate domain check — ${root}\n`);

  const apexA = dig(root);
  const apexCname = digCname(root);
  checks.push({
    name: `Apex DNS (${root})`,
    ok: Boolean(apexA || apexCname),
    detail: apexCname || apexA || "MISSING",
  });

  const wwwA = dig(`www.${root}`);
  const wwwCname = digCname(`www.${root}`);
  checks.push({
    name: `WWW DNS (www.${root})`,
    ok: Boolean(wwwA || wwwCname),
    detail: wwwCname || wwwA || "MISSING — add CNAME www → apex or Railway",
  });

  const wildHost = `wildcard-check-${Date.now()}.${root}`;
  let wildOk = false;
  let wildDetail = "MISSING — add CNAME * → Railway service";
  try {
    const r = await lookup(wildHost);
    wildOk = Boolean(r?.address);
    wildDetail = r.address;
  } catch {
    const d = dig(wildHost);
    wildOk = Boolean(d);
    wildDetail = d || wildDetail;
  }
  checks.push({ name: `Wildcard DNS (*.${root})`, ok: wildOk, detail: wildDetail });

  const adminDig = dig(`admin.${root}`) || digCname(`admin.${root}`);
  checks.push({
    name: `Admin host DNS (admin.${root})`,
    ok: wildOk || Boolean(adminDig),
    detail: adminDig || (wildOk ? "covered by wildcard" : "MISSING"),
  });

  const apexHttp = await httpOk(`https://${root}/health`);
  checks.push({
    name: `HTTPS apex /health`,
    ok: apexHttp.ok,
    detail: apexHttp.ok ? `HTTP ${apexHttp.status}` : apexHttp.error || `HTTP ${apexHttp.status}`,
  });

  let healthJson = null;
  if (apexHttp.ok) {
    try {
      healthJson = await (await fetch(`https://${root}/health`)).json();
    } catch {
      /* ignore */
    }
  }
  if (healthJson) {
    const routing = healthJson.tenantRouting;
    const configuredRoot = healthJson.rootDomain;
    checks.push({
      name: "APP_ROOT_DOMAIN env",
      ok: String(configuredRoot || "").toLowerCase() === root,
      detail: configuredRoot || "unknown",
    });
    checks.push({
      name: "TENANT_ROUTING=subdomain",
      ok: routing === "subdomain",
      detail: routing || "unknown",
    });
  }

  if (wildOk) {
    const subHttp = await httpOk(`https://${wildHost}/health`);
    checks.push({
      name: "HTTPS wildcard sample host",
      ok: subHttp.ok,
      detail: subHttp.ok ? `HTTP ${subHttp.status}` : subHttp.error || `HTTP ${subHttp.status}`,
    });
  }

  let failed = 0;
  for (const c of checks) {
    const mark = c.ok ? "OK  " : "FAIL";
    if (!c.ok) failed += 1;
    console.log(`${mark}  ${c.name}`);
    console.log(`      ${c.detail}`);
  }

  console.log(`\n${failed === 0 ? "All checks passed." : `${failed} check(s) failed.`}`);
  console.log(`
Railway variables (Settings → Variables):
  APP_ROOT_DOMAIN=${root}
  APP_BASE_URL=https://${root}
  TENANT_ROUTING=subdomain

DNS (Network Solutions):
  ${root}           CNAME/ALIAS → <service>.up.railway.app
  www               CNAME       → ${root}  (or Railway)
  *                 CNAME       → <service>.up.railway.app

Railway Networking: add custom domains ${root}, www.${root}, *.${root}
`);

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
