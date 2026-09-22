#!/usr/bin/env node
/**
 * Fail if source files contain U+FFFD (replacement character) or invalid UTF-8.
 * Run: npm run check:encoding
 */
import { readdir, readFile, stat } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'uploads', 'dist', '.next']);
const EXT = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.json', '.md', '.sql']);

async function walk(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (ent.name.startsWith('.') && ent.name !== '.editorconfig' && ent.name !== '.gitattributes') {
      if (ent.isDirectory()) continue;
    }
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      await walk(full, out);
    } else {
      const ext = path.extname(ent.name).toLowerCase();
      if (EXT.has(ext) || ent.name === '.editorconfig' || ent.name === '.gitattributes') {
        out.push(full);
      }
    }
  }
  return out;
}

async function main() {
  const files = await walk(ROOT);
  const bad = [];

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const buf = await readFile(file);
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch {
      bad.push({ rel, reason: 'invalid UTF-8 bytes' });
      continue;
    }
    if (text.includes('\ufffd')) {
      bad.push({ rel, reason: 'contains U+FFFD replacement character (corrupted encoding)' });
    }
  }

  if (bad.length) {
    console.error('Encoding check failed:\n');
    for (const { rel, reason } of bad) {
      console.error(`  ${rel}: ${reason}`);
    }
    console.error('\nFix: save files as UTF-8. See .editorconfig and .cursor/rules/utf8-encoding.mdc');
    process.exit(1);
  }

  console.log(`Encoding OK (${files.length} files checked, UTF-8, no U+FFFD).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
