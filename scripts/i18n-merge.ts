/**
 * Merges a filled TSV (source, pt, en, es) into src/lib/i18n/dictionary.json.
 *
 *   npm run i18n:merge -- i18n-missing.tsv
 *
 * Columns: "=" keeps the original text; empty en/es lines are skipped; a source of
 * "-" in the pt column drops the line. Existing texts are updated.
 */
import fs from "node:fs";
import path from "node:path";

const file = process.argv[2];
if (!file) {
  console.error("Use: npm run i18n:merge -- <file.tsv>");
  process.exit(1);
}
const DICT = path.join(process.cwd(), "src/lib/i18n/dictionary.json");
type Entry = { k: string; pt?: string; en?: string; es?: string };
const dict = JSON.parse(fs.readFileSync(DICT, "utf8")) as { version: number; entries: Entry[] };
const byKey = new Map(dict.entries.map((e) => [e.k, e]));
let added = 0;
let updated = 0;
const problems: string[] = [];

for (const line of fs.readFileSync(file, "utf8").split("\n")) {
  if (!line.trim() || line.startsWith("#")) continue;
  const [k, pt, en, es] = line.split("\t").map((x) => (x ?? "").trim());
  if (!k || pt === "-") continue;
  if (!en || !es) continue; // not translated yet
  const src = new Set(k.match(/\{\d+\}/g) || []);
  const entry: Entry = { k };
  for (const [loc, v] of [["pt", pt], ["en", en], ["es", es]] as const) {
    const text = v === "=" || !v ? k : v;
    for (const ph of text.match(/\{\d+\}/g) || []) if (!src.has(ph)) problems.push(`${loc}: ${ph} not in "${k}"`);
    if (text !== k) entry[loc] = text;
  }
  if (byKey.has(k)) {
    Object.assign(byKey.get(k)!, { pt: undefined, en: undefined, es: undefined }, entry);
    updated += 1;
  } else {
    dict.entries.push(entry);
    byKey.set(k, entry);
    added += 1;
  }
}
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
dict.entries = dict.entries.map((e) => JSON.parse(JSON.stringify(e)) as Entry);
fs.writeFileSync(DICT, JSON.stringify(dict) + "\n");
console.log(`${added} added, ${updated} updated → ${path.relative(process.cwd(), DICT)}`);
