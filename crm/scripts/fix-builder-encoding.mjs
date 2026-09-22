#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';

const EM = '\u2014';
const MID = '\u00B7';
const LARR = '\u2190';
const RARR = '\u2192';
const CHECK2 = '\u2713\u2713';
const CHECK1 = '\u2713';

function fixBuilderProject(t) {
  let out = t.replace(/\uFFFD/g, EM);
  out = out.replace(/\← Previous/g, `${LARR} Previous`);
  out = out.replace(/Next \?/g, `Next ${RARR}`);
  out = out.replace(/title="Read">\?\?<\/span>/g, `title="Read">${CHECK2}</span>`);
  out = out.replace(/title="Sent">\?<\/span>/g, `title="Sent">${CHECK1}</span>`);
  out = out.replace(/return '—';/g, "return '\\u2014';");
  out = out.replace(/s \|\| '—'/g, "s || '\\u2014'");
  out = out.replace(/join\(' — '\)/g, "join(' \\u00B7 ')");
  out = out.replace(/` — Due/g, '` \\u00B7 Due');
  out = out.replace(/` — Due/g, '` \\u00B7 Due');
  out = out.replace(/photoMeta\(p\)\} — \$\{/g, 'photoMeta(p)} \\u00B7 ${');
  out = out.replace(/photoMeta\(p\)\} . \$\{/g, 'photoMeta(p)} \\u00B7 ${');
  out = out.replace(/: '—'/g, ": '\\u2014'");
  out = out.replace(/flooring_type \|\| '—'/g, "flooring_type || '\\u2014'");
  out = out.replace(/service_type \|\| '—'/g, "service_type || '\\u2014'");
  out = out.replace(/address \|\| '—'/g, "address || '\\u2014'");
  out = out.replace(/sku \|\| '—'/g, "sku || '\\u2014'");
  out = out.replace(/dates \|\| '—'/g, "dates || '\\u2014'");
  out = out.replace(/status \|\| '—'/g, "status || '\\u2014'");
  return out;
}

const files = [
  ['public/builder-project.js', fixBuilderProject],
  [
    'public/builder-messages.js',
    (t) =>
      t
        .replace(/>\?\? PDF attachment</g, '>PDF attachment<')
        .replace(/>\?\? <input type="file"/g, '>Attach <input type="file"'),
  ],
];

for (const [file, fn] of files) {
  const before = readFileSync(file, 'utf8');
  const after = fn(before);
  if (after !== before) {
    writeFileSync(file, after, 'utf8');
    console.log('fixed', file);
  }
}

const t = readFileSync('public/builder-project.js', 'utf8');
if (t.includes('\uFFFD') || /title="Read">\?\?/.test(t) || /\← Previous/.test(t)) {
  console.error('Still bad chars in builder-project.js');
  process.exit(1);
}
console.log('OK');
