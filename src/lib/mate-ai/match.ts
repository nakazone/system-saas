/**
 * Fuzzy matching for Mate AI. Voice transcripts misspell names ("Jhon", "Joao"), drop
 * accents and use partial names ("o Mike"), so exact/contains SQL lookups are not enough.
 * These helpers are pure: the routes fetch a broad candidate set and rank it here.
 */
import { normalizeMateAiText, type MateAiCatalogItem } from "./command.js";

const NAME_STOP_WORDS = new Set([
  "a", "o", "as", "os", "da", "de", "do", "das", "dos", "e", "the", "of", "and", "mr", "mrs", "ms",
  "sr", "sra", "senhor", "senhora", "cliente", "customer", "client", "job", "trabalho", "obra",
]);

const ADDRESS_ABBREVIATIONS: Record<string, string> = {
  st: "street", ave: "avenue", av: "avenue", rd: "road", dr: "drive", ln: "lane", blvd: "boulevard",
  ct: "court", pl: "place", hwy: "highway", pkwy: "parkway", cir: "circle", rua: "street",
};

export function nameTokens(value: string | null | undefined): string[] {
  return normalizeMateAiText(String(value || ""))
    .split(" ")
    .filter((token) => token.length > 0 && !NAME_STOP_WORDS.has(token))
    .map((token) => ADDRESS_ABBREVIATIONS[token] || token);
}

/** Short prefixes used to fetch a broad, accent-tolerant candidate set from SQL. */
export function searchPrefixes(query: string, size = 3): string[] {
  const out = new Set<string>();
  for (const token of nameTokens(query)) {
    if (/^\d+$/.test(token)) {
      out.add(token);
      continue;
    }
    if (token.length >= 2) out.add(token.slice(0, Math.min(size, token.length)));
  }
  return [...out].slice(0, 6);
}

export function editDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
      curr.push(value);
      if (value < rowMin) rowMin = value;
    }
    if (rowMin > max) return max + 1;
    prev = curr;
  }
  return prev[b.length]!;
}

function tokenScore(queryToken: string, targetTokens: string[]): number {
  let best = 0;
  for (const target of targetTokens) {
    if (target === queryToken) return 1;
    if (queryToken.length >= 3 && (target.startsWith(queryToken) || (target.length >= 3 && queryToken.startsWith(target)))) {
      best = Math.max(best, 0.85);
      continue;
    }
    const allowed = queryToken.length >= 7 ? 2 : queryToken.length >= 3 && target.length >= 3 ? 1 : 0;
    if (allowed && editDistance(queryToken, target, allowed) <= allowed) best = Math.max(best, 0.75);
  }
  return best;
}

/** 0–100 similarity between a spoken query and one or more names of a record. */
export function nameSimilarity(query: string, names: Array<string | null | undefined>): number {
  const normalizedQuery = normalizeMateAiText(query);
  if (!normalizedQuery) return 0;
  for (const name of names) {
    if (name && normalizeMateAiText(name) === normalizedQuery) return 100;
  }
  const queryTokens = nameTokens(query);
  if (!queryTokens.length) return 0;
  const targetTokens = names.flatMap((name) => nameTokens(name));
  if (!targetTokens.length) return 0;
  const scores = queryTokens.map((token) => tokenScore(token, targetTokens));
  const matched = scores.filter((score) => score > 0).length;
  if (!matched) return 0;
  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  // Every spoken word found → strong; some words missing → weaker but still a candidate.
  return Math.round((matched === scores.length ? 90 : 60) * average);
}

export type RankedMatch<T> = { item: T; score: number };

export type PickResult<T> =
  | { status: "matched"; item: T; score: number }
  | { status: "ambiguous"; candidates: RankedMatch<T>[] }
  | { status: "not_found"; candidates: RankedMatch<T>[] };

/**
 * Picks a single winner only when it is clearly ahead; otherwise returns the best candidates
 * so the user can tap the right one instead of rewriting the command.
 */
export function pickBest<T>(ranked: RankedMatch<T>[], options: { min?: number; margin?: number; max?: number } = {}): PickResult<T> {
  const min = options.min ?? 55;
  const margin = options.margin ?? 12;
  const max = options.max ?? 6;
  const sorted = [...ranked].filter((r) => r.score > 0).sort((a, b) => b.score - a.score);
  const top = sorted[0];
  if (!top || top.score < min) return { status: "not_found", candidates: sorted.slice(0, max) };
  const second = sorted[1];
  if (top.score === 100 && (!second || second.score < 100)) return { status: "matched", item: top.item, score: top.score };
  if (!second || top.score - second.score >= margin) return { status: "matched", item: top.item, score: top.score };
  return { status: "ambiguous", candidates: sorted.filter((r) => r.score >= min - 15).slice(0, max) };
}

export function rankCustomers<T extends { name: string; company?: string | null }>(query: string, rows: T[]): RankedMatch<T>[] {
  return rows.map((item) => ({ item, score: nameSimilarity(query, [item.name, item.company]) }));
}

export type JobLike = {
  number: number | null;
  title: string;
  address?: string | null;
  status?: string | null;
  customerName?: string | null;
  builderName?: string | null;
  sourceName?: string | null;
};

/** Extracts a job number from "#1042", "job 1042", "trabalho número 1042", "OS 1042". */
export function jobNumberFromQuery(query: string): number | null {
  const match = String(query || "").match(/(?:#|\b(?:job|trabalho|obra|os|n[uú]mero|number|no\.?|n[ºo])\s*#?\s*)(\d{1,7})\b/i)
    || String(query || "").trim().match(/^#?(\d{1,7})$/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function rankJobs<T extends JobLike>(query: string, customerQuery: string | null, rows: T[]): RankedMatch<T>[] {
  const number = jobNumberFromQuery(query);
  return rows.map((item) => {
    if (number != null && item.number === number) return { item, score: 100 };
    const textScore = query
      ? nameSimilarity(query, [item.title, item.address, item.customerName, item.builderName, item.sourceName])
      : 0;
    const customerScore = customerQuery
      ? nameSimilarity(customerQuery, [item.customerName, item.builderName, item.sourceName])
      : 0;
    let score = Math.max(textScore, customerScore);
    if (textScore && customerScore) score = Math.min(99, Math.round((textScore + customerScore) / 2) + 8);
    // Canceled jobs cannot be invoiced; keep them visible but rank them below.
    if (item.status === "canceled") score = Math.round(score * 0.5);
    return { item, score };
  });
}

/** Catalog items that share at least one meaningful word with what the user said. */
export function similarCatalogItems(query: string, items: MateAiCatalogItem[], max = 6): MateAiCatalogItem[] {
  return items
    .map((item) => ({ item, score: nameSimilarity(query, [item.name, item.category]) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .slice(0, max)
    .map((r) => r.item);
}
