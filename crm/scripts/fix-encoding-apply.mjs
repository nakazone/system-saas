#!/usr/bin/env node
/**
 * One-time / maintenance: rewrite known corrupted strings as proper UTF-8.
 * Unicode via \u escapes so this script stays ASCII-safe in any editor.
 */
import { readFileSync, writeFileSync } from 'fs';
import { readdir } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'uploads', 'dist', '.next']);
const EXT = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.json', '.md', '.sql']);

const EM = '\u2014';
const EN = '\u2013';
const MID = '\u00B7';
const ELL = '\u2026';
const MDASH = EM;

const REPLACEMENTS = [
  [/Portal \uFFFD tabelas/g, `Portal ${EM} tabelas`],
  [/Portal \uFFFD admin/g, `Portal ${EM} admin`],
  [/portal \uFFFD project/g, `portal ${EM} project`],
  [/portal \uFFFD admin/g, `portal ${EM} admin`],
  [/\$\{refNumber\} \uFFFD \$\{/g, `\${refNumber} ${EM} \${`],
  [/received \uFFFD \$\{/g, `received ${EM} \${`],
  [/estimate \uFFFD \$\{/g, `estimate ${EM} \${`],
  [/address \|\| '\uFFFD'/g, `address || '${EM}'`],
  [/Builder \uFFFD Senior/g, `Builder ${EM} Senior`],
  [/carregar\uFFFD/g, `carregar${ELL}`],
  [/return '\uFFFD'/g, `return '${EM}'`],
  [/join\(' \uFFFD '\)/g, `join(' ${MID} ')`],
  [/\← Previous/g, '\u2190 Previous'],
  [/Next \?/g, 'Next \u2192'],
  [/\$\{fmtDate\(p\.start_date\)\} \? \$\{fmtDate/g, '${fmtDate(p.start_date)} \u2192 ${fmtDate'],
  [/title="Read">\?\?<\/span>/g, 'title="Read">\u2713\u2713</span>'],
  [/title="Sent">\?<\/span>/g, 'title="Sent">\u2713</span>'],
  [/>\?\? PDF attachment</g, '>PDF attachment<'],
  [/>\?\? <input type="file"/g, '>Attach <input type="file"'],
  [/n\uFFFDo/g, 'n\u00e3o'],
  [/s\uFFFDo/g, 's\u00f3'],
  [/vis\uFFFDvel/g, 'vis\u00edvel'],
  [/M\uFFFdnimo/g, 'M\u00ednimo'],
  [/autom\uFFFDtica/g, 'autom\u00e1tica'],
  [/N\uFFFDo/g, 'N\u00e3o'],
  [/poss\uFFFDvel/g, 'poss\u00edvel'],
  [/Parceiro h\uFFFD:/g, 'Parceiro h\u00e1:'],
  [/\uFFFDltimo login/g, '\u00daltimo login'],
  [/Vis\uFFFDo Geral/g, 'Vis\u00e3o Geral'],
  [/Endere\uFFFDo/g, 'Endere\u00e7o'],
  [/A\uFFFD\uFFFDo/g, 'A\u00e7\u00e3o'],
  [/inv\uFFFDlido/g, 'inv\u00e1lido'],
  [/\|\| '\uFFFD'/g, `|| '${EM}'`],
  [/status\)\} \uFFFD <strong/g, `status)} ${MID} <strong`],
  [/lida \uFFFD s\uFFFDo/g, `lida ${EM} s\u00f3`],
  [/portal \uFFFD n\uFFFDo/g, `portal ${EM} n\u00e3o`],
  [/n\uFFFDo \uFFFD vis\uFFFDvel/g, 'n\u00e3o \u00e9 vis\u00edvel'],
  [/\uFFFD/g, EM],
];

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

function fixText(text) {
  let out = text;
  for (const [re, rep] of REPLACEMENTS) {
    out = out.replace(re, rep);
  }
  return out;
}

async function main() {
  const files = await walk(ROOT);
  let changed = 0;
  const stillBad = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const before = readFileSync(file, 'utf8');
    const after = fixText(before);
    if (after !== before) {
      writeFileSync(file, after, 'utf8');
      changed++;
      console.log('fixed', rel);
    }
    if (after.includes('\uFFFD')) stillBad.push(rel);
  }
  if (stillBad.length) {
    console.error('Still corrupted:', stillBad.join(', '));
    process.exit(1);
  }
  console.log(`Done (${changed} files updated).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
