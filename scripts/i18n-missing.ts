/**
 * Lists CRM texts that are not in the interface dictionary yet.
 *
 *   npm run i18n:missing            → writes i18n-missing.tsv (one text per line)
 *
 * Fill the pt / en / es columns ("=" keeps the original text; "-" in pt = not interface
 * text, add it to src/lib/i18n/ignore.json)
 * and merge with:
 *
 *   npm run i18n:merge -- i18n-missing.tsv
 *
 * Small fixes can also be made without code in Master › Idiomas › Frases.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const CRM = path.join(ROOT, "crm/public");
const SERVER_DIRS = ["src/crm", "src/lib", "src/modules", "src/middleware"].map((d) => path.join(ROOT, d));
const DICT = path.join(ROOT, "src/lib/i18n/dictionary.json");
/** Texts that look like interface but aren't (CSS, URLs, keys…) — kept out of the report. */
const IGNORE = path.join(ROOT, "src/lib/i18n/ignore.json");
const M = "\u0001";

const found = new Map<string, string>();
const SKIP_CALLEES = new Set(
  "querySelector querySelectorAll getElementById addEventListener removeEventListener fetch setAttribute getAttribute removeAttribute hasAttribute closest matches add remove toggle contains getItem setItem removeItem require import createElement dispatchEvent Event CustomEvent get has delete startsWith endsWith includes indexOf split replace replaceAll join match test RegExp toLocaleString toLocaleDateString toLocaleTimeString NumberFormat DateTimeFormat api apiFetch apiGet apiPost open assign log warn error debug info padStart padEnd getPropertyValue setProperty pushState replaceState localeCompare URL URLSearchParams append set".split(" "),
);

function visible(t: string): boolean {
  if (!/[A-Za-zÀ-ÿ]{2}/.test(t)) return false;
  if (/^(https?:|\/|\.\/|#|\.[a-z]|\[|mailto:|tel:|data:|javascript:)/i.test(t)) return false;
  if (/^[a-z0-9_\-.:/]+$/.test(t)) return false;
  if (/^[a-z]+[A-Z]\w*$/.test(t)) return false;
  if (/^&[a-z#0-9]+;$|^(GET|POST|PUT|PATCH|DELETE|use strict)$/.test(t)) return false;
  if (/^var\(|^[A-Z][a-z]+\/[A-Z_a-z]+$|^[a-z]+\/[a-z0-9.+-]+(;|$)|^[\w.+-]+@[\w-]+\.[\w.]+$|^&[\w=]/.test(t)) return false;
  if (/=\s*["']|url\(|^[a-z-]+\s*:\s*[^ ]|\(max-width|\(min-width|\.(pdf|png|jpg|csv|js|css|html)(\?|$)/i.test(t)) return false;
  if (/^[a-z][\w-]*(\s+[a-z][\w-]*)*$/.test(t) && /[-_]/.test(t)) return false;
  return true;
}

function add(raw: string, file: string) {
  let n = 0;
  const key = raw.replace(/\s+/g, " ").trim().replace(new RegExp(`${M}+`, "g"), () => `{${n++}}`);
  if (!key || key.length > 400) return;
  if (!visible(key.replace(/\{\d+\}/g, " "))) return;
  if (n > 0 && key.replace(/\{\d+\}/g, "").replace(/[^A-Za-zÀ-ÿ]/g, "").length < 3) return;
  if (!found.has(key)) found.set(key, file);
}

function html(text: string, file: string) {
  const scripts: string[] = [];
  const body = text
    .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (_m, js: string) => {
      scripts.push(js);
      return " ";
    })
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  for (const m of body.matchAll(/>([^<>]+)</g)) add(decode(m[1]!), file);
  for (const m of body.matchAll(/\b(placeholder|title|aria-label|alt)="([^"]*)"/g)) add(decode(m[2]!), file);
  for (const js of scripts) code(js, file);
}

const ENT: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", mdash: "—", ndash: "–", rarr: "→", larr: "←", hellip: "…", middot: "·", times: "×", copy: "©" };
function decode(s: string) {
  return s
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENT[n.toLowerCase()] ?? m);
}

function str(s: string, file: string) {
  if (/<\/?[a-z][^>]*>/i.test(s)) html(`<x>${s}</x>`, file);
  else add(decode(s), file);
}

function calleeName(e: ts.Expression): string {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return "";
}

function code(text: string, file: string) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const visit = (node: ts.Node) => {
    const parent = node.parent;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const skip =
        (parent && ts.isPropertyAssignment(parent) && parent.name === node) ||
        (parent && ts.isElementAccessExpression(parent) && parent.argumentExpression === node) ||
        (parent && (ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.arguments?.[0] === node && SKIP_CALLEES.has(calleeName(parent.expression))) ||
        (parent && ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword].includes(parent.operatorToken.kind)) ||
        (parent && ts.isCaseClause(parent)) ||
        (parent && ts.isImportDeclaration(parent));
      if (!skip) str(node.text, file);
    } else if (ts.isTemplateExpression(node)) {
      if (!(parent && ts.isCallExpression(parent) && parent.arguments[0] === node && SKIP_CALLEES.has(calleeName(parent.expression)))) {
        str(node.head.text + node.templateSpans.map((s) => M + s.literal.text).join(""), file);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function serverMessages(text: string, file: string) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const props = new Set(["error", "message", "hint", "detail", "label", "title"]);
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && props.has(node.name.getText(sf))) {
      const v = node.initializer;
      if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) {
        if (/\s/.test(v.text) || /[À-ÿ]/.test(v.text)) add(v.text, file);
      } else if (ts.isTemplateExpression(v)) add(v.head.text + v.templateSpans.map((s) => M + s.literal.text).join(""), file);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

function walk(dir: string, fn: (file: string) => void) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      if (!/vendor|node_modules|assets|fonts|img|images/.test(f)) walk(p, fn);
    } else fn(p);
  }
}

walk(CRM, (p) => {
  const rel = path.relative(ROOT, p);
  if (p.endsWith(".html")) html(fs.readFileSync(p, "utf8"), rel);
  else if (p.endsWith(".js") && !p.endsWith(".min.js") && !p.endsWith("crm-i18n.js")) code(fs.readFileSync(p, "utf8"), rel);
});
for (const d of SERVER_DIRS) if (fs.existsSync(d)) walk(d, (p) => p.endsWith(".ts") && !/email|templates|legal|i18n/.test(p) && serverMessages(fs.readFileSync(p, "utf8"), path.relative(ROOT, p)));

const dict = JSON.parse(fs.readFileSync(DICT, "utf8")) as { entries: { k: string }[] };
const known = new Set(dict.entries.map((e) => e.k));
for (const k of JSON.parse(fs.readFileSync(IGNORE, "utf8")) as string[]) known.add(k);
const missing = [...found.entries()].filter(([k]) => !known.has(k)).sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
const out = path.join(ROOT, "i18n-missing.tsv");
fs.writeFileSync(out, ["# source\tpt\ten\tes\t(file)", ...missing.map(([k, f]) => `${k}\t\t\t\t${f}`)].join("\n") + "\n");
console.log(`${missing.length} text(s) not in the dictionary → ${path.relative(ROOT, out)}`);
