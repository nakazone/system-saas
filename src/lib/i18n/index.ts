/**
 * Interface languages of the CRM (pt-BR, en-US, es-ES).
 *
 * The CRM screens are written in Portuguese (some parts in English). The browser
 * script crm/public/crm-i18n.js translates what is on screen using a dictionary
 * keyed by the original text. This module builds that dictionary for each
 * language from:
 *   1. the base translations shipped with the code (dictionary.json);
 *   2. phrase edits made in Master › Idiomas (I18nPhrase);
 *   3. term swaps made in Master › Idiomas (I18nTerm), e.g. "Orçamento" → "Quote"
 *      in Portuguese — applied on top of everything, in the browser.
 *
 * Customer documents (quote, invoice, e-mails) are not translated here.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../prisma.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const UI_LOCALES = ["pt", "en", "es"] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

export const UI_LOCALE_LABEL: Record<UiLocale, string> = {
  pt: "Português (Brasil)",
  en: "English (US)",
  es: "Español (España)",
};
export const UI_LOCALE_SHORT: Record<UiLocale, string> = { pt: "PT-BR", en: "EN-US", es: "ES-ES" };

export function normalizeUiLocale(v: unknown): UiLocale | null {
  const c = String(v ?? "").toLowerCase().slice(0, 2);
  return (UI_LOCALES as readonly string[]).includes(c) ? (c as UiLocale) : null;
}

/** Organization.defaultLocale ("pt-BR" | "en" | "es") → interface locale. */
export function orgDefaultUiLocale(defaultLocale: string | null | undefined): UiLocale {
  return normalizeUiLocale(defaultLocale) ?? "pt";
}

// ---------------------------------------------------------------------------
// Base dictionary
// ---------------------------------------------------------------------------

export type BaseEntry = { k: string; pt?: string; en?: string; es?: string };

let base: { entries: BaseEntry[]; hash: string; byKey: Map<string, BaseEntry> } | null = null;

function dictionaryPath(): string {
  const candidates = [
    path.resolve(__dirname, "dictionary.json"), // src/lib/i18n (tsx)
    path.resolve(__dirname, "../../../../src/lib/i18n/dictionary.json"), // dist/src/lib/i18n → repo
    path.resolve(process.cwd(), "src/lib/i18n/dictionary.json"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return candidates[0]!;
}

export function baseDictionary() {
  if (base) return base;
  let entries: BaseEntry[] = [];
  let raw = "";
  try {
    raw = fs.readFileSync(dictionaryPath(), "utf8");
    entries = (JSON.parse(raw) as { entries: BaseEntry[] }).entries || [];
  } catch (error) {
    console.error("[i18n] could not read dictionary.json", error);
  }
  base = {
    entries,
    hash: crypto.createHash("sha1").update(raw).digest("hex").slice(0, 8),
    byKey: new Map(entries.map((e) => [e.k, e])),
  };
  return base;
}

/** Normalizes a text the same way the browser does before looking it up. */
export function normKey(s: string): string {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

export function baseText(entry: BaseEntry | undefined, key: string, locale: UiLocale): string {
  return entry?.[locale] ?? key;
}

/** Strings that are English in the code (kept as-is inside customer documents). */
export function isEnglishOrigin(entry: BaseEntry | undefined): boolean {
  return !!entry && entry.en === undefined && (entry.pt !== undefined || entry.es !== undefined);
}

// ---------------------------------------------------------------------------
// Version (changes when the dictionary file or any Master edit changes)
// ---------------------------------------------------------------------------

const REV_KEY = "platform.i18n_rev";
let revCache: { value: string; at: number } | null = null;

async function readRev(): Promise<string> {
  if (revCache && Date.now() - revCache.at < 15_000) return revCache.value;
  const row = await prisma.systemSetting.findUnique({ where: { key: REV_KEY } }).catch(() => null);
  const value = row?.value || "0";
  revCache = { value, at: Date.now() };
  return value;
}

export async function i18nVersion(): Promise<string> {
  return `${baseDictionary().hash}.${await readRev()}`;
}

/** Call after every Master change: browsers download the new dictionary. */
export async function bumpI18n(): Promise<void> {
  const value = String(Date.now());
  await prisma.systemSetting.upsert({ where: { key: REV_KEY }, create: { key: REV_KEY, value }, update: { value } });
  revCache = { value, at: Date.now() };
  bundleCache.clear();
}

// ---------------------------------------------------------------------------
// Term swaps
// ---------------------------------------------------------------------------

export type TermRule = { f: string; r: string; fp?: string | null; rp?: string | null; c?: boolean };

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchCase(sample: string, word: string): string {
  if (sample === sample.toUpperCase() && sample !== sample.toLowerCase()) return word.toUpperCase();
  const first = sample.charAt(0);
  if (first === first.toUpperCase() && first !== first.toLowerCase()) return word.charAt(0).toUpperCase() + word.slice(1);
  return word.charAt(0).toLowerCase() + word.slice(1);
}

/** Same rule as the browser: whole words only, plural first, keeps the casing on screen. */
export function applyTerms(text: string, rules: TermRule[]): string {
  let out = text;
  for (const t of rules) {
    const list: { find: string; to: string }[] = [];
    if (t.fp && t.rp) list.push({ find: t.fp, to: t.rp });
    list.push({ find: t.f, to: t.r });
    for (const x of list) {
      const re = new RegExp(`(^|[^\\p{L}\\p{N}_])(${escRe(x.find)})(?=$|[^\\p{L}\\p{N}_])`, t.c ? "gu" : "giu");
      out = out.replace(re, (_m, pre: string, word: string) => pre + (t.c ? x.to : matchCase(word, x.to)));
    }
  }
  return out;
}

export async function termRules(locale: UiLocale): Promise<TermRule[]> {
  const rows = await prisma.i18nTerm.findMany({ where: { locale, active: true }, orderBy: [{ createdAt: "asc" }] }).catch(() => []);
  // Longer expressions first, so "Novo orçamento" wins over "orçamento".
  return rows
    .map((t) => ({ f: t.find, r: t.replace, fp: t.findPlural, rp: t.replacePlural, c: t.matchCase }))
    .sort((a, b) => b.f.length - a.f.length);
}

// ---------------------------------------------------------------------------
// Bundle sent to the browser
// ---------------------------------------------------------------------------

export type Bundle = {
  v: string;
  locale: UiLocale;
  exact: Record<string, string>;
  patterns: [string, string][];
  english: string[];
  terms: TermRule[];
};

const bundleCache = new Map<string, { bundle: Bundle; json: string }>();

export async function phraseOverrides(locale?: UiLocale) {
  return prisma.i18nPhrase
    .findMany({ where: locale ? { locale } : {}, orderBy: { updatedAt: "desc" } })
    .catch(() => [] as Awaited<ReturnType<typeof prisma.i18nPhrase.findMany>>);
}

export async function buildBundle(locale: UiLocale): Promise<{ bundle: Bundle; json: string }> {
  const v = await i18nVersion();
  const cacheKey = `${locale}:${v}`;
  const hit = bundleCache.get(cacheKey);
  if (hit) return hit;

  const { entries } = baseDictionary();
  const texts = new Map<string, string>();
  const english = new Set<string>();
  for (const e of entries) {
    const target = e[locale];
    if (target !== undefined && target !== e.k) {
      texts.set(e.k, target);
      if (locale !== "en" && isEnglishOrigin(e)) english.add(e.k);
    }
  }
  for (const p of await phraseOverrides(locale)) {
    if (p.text === p.source) texts.delete(p.source);
    else texts.set(p.source, p.text);
    english.delete(p.source); // an explicit edit applies everywhere
  }
  const exact: Record<string, string> = {};
  const patterns: [string, string][] = [];
  for (const [k, t] of texts) {
    if (/\{\d+\}/.test(k)) patterns.push([k, t]);
    else exact[k] = t;
  }
  const staticLen = (s: string) => s.replace(/\{\d+\}/g, "").length;
  patterns.sort((a, b) => staticLen(b[0]) - staticLen(a[0]));
  const bundle: Bundle = { v, locale, exact, patterns, english: [...english], terms: await termRules(locale) };
  const out = { bundle, json: JSON.stringify(bundle) };
  bundleCache.set(cacheKey, out);
  if (bundleCache.size > 12) bundleCache.delete(bundleCache.keys().next().value!);
  return out;
}

type CompiledPattern = { re: RegExp; out: string; order: number[]; glued: Set<number>; src: string; len: number };

const DATE_WORDS = /\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez|dom|seg|ter|qua|qui|sex|sáb|hoje|ontem|amanhã|h|min|d|sq|ft|lf|am|pm)\b\.?/gi;
/** Has words (not just numbers, money or dates). */
function wordy(v: string): boolean {
  return /[A-Za-zÀ-ÿ]{2}/.test(v.replace(DATE_WORDS, ""));
}

function compilePatterns(list: [string, string][]): CompiledPattern[] {
  return list.map(([src, out]) => {
    const parts = src.split(/\{(\d+)\}/);
    let re = "^";
    const order: number[] = [];
    parts.forEach((p, i) => {
      if (i % 2 === 0) re += escRe(p);
      else {
        re += "(.+?)";
        order.push(Number(p));
      }
    });
    const glued = new Set<number>();
    for (const m of src.matchAll(/\{(\d+)\}/g)) {
      const at = m.index ?? 0;
      if (/[A-Za-zÀ-ÿ]/.test(src.charAt(at - 1)) || /[A-Za-zÀ-ÿ]/.test(src.charAt(at + m[0].length))) glued.add(Number(m[1]));
    }
    return { re: new RegExp(`${re}$`), out, order, glued, src, len: src.replace(/\{\d+\}/g, "").length };
  });
}

/** Same lookup as crm-i18n.js (without the date words): exact text, pattern, then "·" parts. */
export function translateWith(bundle: Pick<Bundle, "exact" | "patterns">, key: string, compiled = compilePatterns(bundle.patterns)): string | null {
  const exactOf = (t: string) => (Object.prototype.hasOwnProperty.call(bundle.exact, t) ? bundle.exact[t]! : null);
  const inner = (v: string): string | null => {
    const t = v.trim();
    if (!t) return v;
    const hit = exactOf(t);
    if (hit != null) return v.replace(t, hit);
    if (t.includes("·")) {
      let changed = false;
      const out = v.split(/(\s*·\s*)/).map((part, i) => {
        if (i % 2 === 1 || !part.trim()) return part;
        const h = exactOf(part.trim()) ?? byPattern(part.trim(), true);
        if (h == null) return part;
        changed = true;
        return part.replace(part.trim(), h);
      });
      if (changed) return out.join("");
    }
    return null;
  };
  const byPattern = (k: string, strict: boolean): string | null => {
    for (const p of compiled) {
      const m = p.re.exec(k);
      if (!m) continue;
      const vals: Record<number, string> = {};
      let ok = true;
      const tight = strict || p.len < 7;
      p.order.forEach((n, j) => {
        if (!ok) return;
        const raw = m[j + 1]!;
        const tr = inner(raw);
        if (tr == null && wordy(raw) && (p.glued.has(n) || tight)) ok = false;
        vals[n] = tr ?? raw;
      });
      if (!ok) continue;
      return p.out.replace(/\{(\d+)\}/g, (_x, n) => vals[Number(n)] ?? "");
    }
    return null;
  };
  const bySegments = (k: string): string | null => {
    if (!k.includes(" · ")) return null;
    let changed = false;
    const out = k.split(" · ").map((part) => {
      const t = part.trim();
      if (!t) return part;
      const h = exactOf(t) ?? byPattern(t, false);
      if (h == null) return part;
      changed = true;
      return h;
    });
    return changed ? out.join(" · ") : null;
  };
  return exactOf(key) ?? byPattern(key, false) ?? bySegments(key);
}

/** Server-side preview of a text in each language (Master › Idiomas). */
export async function previewText(text: string): Promise<Record<UiLocale, string>> {
  const key = normKey(text);
  const out = {} as Record<UiLocale, string>;
  for (const loc of UI_LOCALES) {
    const { bundle } = await buildBundle(loc);
    out[loc] = applyTerms(translateWith(bundle, key) ?? key, bundle.terms);
  }
  return out;
}
