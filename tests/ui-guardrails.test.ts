import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Static guardrails for the front-end apps (ObraMate CRM, ObraBuilder, ObraCrew, ObraCam).
 * They keep the 2026-11 UX/performance pass from sliding back. See docs/apps-audit-2026-11.md.
 * Ceilings only go down: when you remove more native dialogs or !important, lower the number here.
 */
const PUB = path.resolve("crm/public");
const MAX_NATIVE_DIALOGS = 72;
const MAX_IMPORTANT = 2284;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "vendor" && e.name !== "node_modules") walk(p, out);
    } else out.push(p);
  }
  return out;
}
const files = walk(PUB);
const html = files.filter((f) => f.endsWith(".html"));
const js = files.filter((f) => f.endsWith(".js"));
const css = files.filter((f) => f.endsWith(".css"));
const read = (f: string) => fs.readFileSync(f, "utf8");
const injected = fs.readFileSync(path.resolve("src/crm/mount.ts"), "utf8");

/** Local CSS/JS references with their ?v= (relative refs resolved from the page's folder). */
function versionedRefs(): { file: string; asset: string; v: string }[] {
  const out: { file: string; asset: string; v: string }[] = [];
  const re = /(?:href|src)="([^"#:]+?\.(?:css|js))\?v=([^"]+)"/g;
  for (const f of [...html, path.resolve("src/crm/mount.ts")]) {
    const s = read(f);
    for (const m of s.matchAll(re)) {
      const ref = m[1]!;
      const abs = ref.startsWith("/") ? path.join(PUB, ref) : path.resolve(path.dirname(f), ref);
      out.push({ file: path.relative(process.cwd(), f), asset: path.relative(PUB, abs), v: m[2]! });
    }
  }
  return out;
}

describe("front-end guardrails", () => {
  it("never blocks pinch-zoom (WCAG 1.4.4)", () => {
    const bad = html.filter((f) => /maximum-scale\s*=\s*1|user-scalable\s*=\s*(no|0)/i.test(read(f)));
    expect(bad.map((f) => path.relative(PUB, f))).toEqual([]);
  });

  it("every versioned asset a page asks for exists", () => {
    const missing = versionedRefs().filter((r) => !fs.existsSync(path.join(PUB, r.asset)));
    expect(missing).toEqual([]);
  });

  it("each asset uses one ?v= everywhere, so it is downloaded and cached once", () => {
    const seen = new Map<string, Set<string>>();
    for (const r of versionedRefs()) {
      // crm-i18n.js: the page copy is stripped by the server and replaced by the injected one.
      if (r.asset === "crm-i18n.js") continue;
      if (!seen.has(r.asset)) seen.set(r.asset, new Set());
      seen.get(r.asset)!.add(r.v);
    }
    const split = [...seen].filter(([, v]) => v.size > 1).map(([a, v]) => `${a}: ${[...v].join(", ")}`);
    expect(split).toEqual([]);
  });

  it("the shared foundation is injected on every CRM page", () => {
    for (const f of ["om-tokens.css", "om-ui.css", "om-ui.js"]) expect(injected).toContain(`/${f}?v=`);
  });

  it("every app builds its top and bottom bars from the one shared component", () => {
    expect(injected).toContain("/om-shell.css?v=");
    expect(injected).toContain("/om-shell.js?v=");
    const app = (f: string) => read(path.join(PUB, f));
    // ObraBuilder sessions get the raw file, without the server injection
    expect(app("partner-portal.html")).toContain("/om-shell.css?v=");
    expect(app("partner-portal.html")).toMatch(/pp-tabs om-shell-tabs/);
    expect(app("partner-portal.html")).toMatch(/pp-top-in om-shell-top/);
    expect(app("om-mobile-nav.js")).toContain("om-shell-tabs");
    expect(app("om-mobile-nav.js")).toContain("om-shell-top");
    expect(app("campo/campo-nav.js")).toContain("OmShell.tabs(");
    expect(app("campo/campo-nav.js")).toContain("OmShell.crewTop(");
    expect(app("obracam-app.js")).toContain("OmShell.tabs(");
    expect(app("obracam-app.js")).toContain("OmShell.top(");
  });

  it("no app restyles the shared bars on its own", () => {
    // A rule that sets the bars' look outside om-shell.css is how the apps drifted apart.
    const look = /(?:^|[\s,}])\.(?:cm-tabbar|oc-tabs|oc-tab|pp-tabs|pp-tab|pp-search-fab|om-tabbar-search)(?:__item)?\s*\{[^}]*(?:border-radius|box-shadow|height)\s*:/m;
    const offenders = ["campo/campo.css", "obracam-app.css", "partner-portal-v2.css"].filter((f) => look.test(read(path.join(PUB, f))));
    expect(offenders).toEqual([]);
  });

  it("does not add native alert/confirm/prompt dialogs", () => {
    const n = js.reduce((sum, f) => sum + (read(f).match(/(?<![\w.$])(?:window\.)?(?:alert|confirm|prompt)\(/g) || []).length, 0);
    expect(n).toBeLessThanOrEqual(MAX_NATIVE_DIALOGS);
  });

  it("does not add !important", () => {
    // comments that explain an !important do not count
    const n = css.reduce((sum, f) => sum + read(f).replace(/\/\*[\s\S]*?\*\//g, "").split("!important").length - 1, 0);
    expect(n).toBeLessThanOrEqual(MAX_IMPORTANT);
  });
});
