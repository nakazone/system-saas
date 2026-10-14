#!/usr/bin/env node
/**
 * Build step: minify the copy of the CRM front-end that production serves (dist/crm/public).
 * Removes comments and whitespace and shortens local variable names, so the code a browser
 * downloads is much harder to read or hand to a reverse-engineering agent.
 *
 * - Runs only on the dist copy; the source in crm/public is never touched.
 * - Top-level (global) names are kept, so inline onclick="…" handlers and cross-file globals
 *   keep working (esbuild does not rename top-level symbols when not bundling).
 * - A file that fails to minify is kept as is and reported; the build does not fail.
 *
 * Usage: node scripts/minify-crm.mjs <dir> [<dir> …]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { transform } from "esbuild";

const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error("usage: node scripts/minify-crm.mjs <dir> [<dir> …]");
  process.exit(1);
}

async function* walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

let files = 0;
let before = 0;
let after = 0;
const failed = [];

for (const dir of dirs) {
  try {
    await fs.access(dir);
  } catch {
    console.warn(`[minify] skip missing ${dir}`);
    continue;
  }
  for await (const file of walk(dir)) {
    const ext = path.extname(file).toLowerCase();
    const loader = ext === ".js" || ext === ".mjs" ? "js" : ext === ".css" ? "css" : null;
    if (!loader || file.endsWith(".min.js") || file.endsWith(".min.css")) continue;
    const src = await fs.readFile(file, "utf8");
    try {
      const out = await transform(src, {
        loader,
        minify: true,
        legalComments: "none",
        charset: "utf8",
      });
      await fs.writeFile(file, out.code);
      files += 1;
      before += Buffer.byteLength(src);
      after += Buffer.byteLength(out.code);
    } catch (error) {
      failed.push(`${path.relative(process.cwd(), file)}: ${String(error?.message || error).split("\n")[0]}`);
    }
  }
}

const kb = (n) => `${Math.round(n / 1024)} KB`;
console.log(`[minify] ${files} files, ${kb(before)} → ${kb(after)}`);
if (failed.length) {
  console.warn(`[minify] kept ${failed.length} file(s) unminified:\n  ${failed.join("\n  ")}`);
}
