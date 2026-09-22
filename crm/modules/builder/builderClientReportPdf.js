/**
 * Single-project client handoff PDF — Senior Floors + optional builder co-branding.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sanitizePdfText } from '../../lib/pdfWinAnsi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const COMPANY = {
  name: 'Senior Floors',
  tagline: 'Hardwood - LVP - Refinishing - Denver Metro',
  phone: '(720) 751-9813',
  email: 'contact@senior-floors.com',
};

const PAL = {
  primary: rgb(26 / 255, 32 / 255, 54 / 255),
  primaryMuted: rgb(42 / 255, 49 / 255, 80 / 255),
  secondary: rgb(214 / 255, 181 / 255, 152 / 255),
  panelBg: rgb(240 / 255, 242 / 255, 248 / 255),
  lineMuted: rgb(0.35, 0.37, 0.42),
  rule: rgb(0.86, 0.88, 0.92),
};

const winAnsiSafe = sanitizePdfText;

async function embedImageFromPath(pdf, filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const bytes = fs.readFileSync(filePath);
    try {
      return await pdf.embedPng(bytes);
    } catch {
      return await pdf.embedJpg(bytes);
    }
  } catch {
    return null;
  }
}

async function embedImageFromUrl(pdf, url) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    try {
      return await pdf.embedPng(buf);
    } catch {
      return await pdf.embedJpg(buf);
    }
  } catch {
    return null;
  }
}

function resolveLocalPhotoPath(publicUrl) {
  if (!publicUrl) return null;
  const u = String(publicUrl).trim();
  const uploadsRoot = path.join(__dirname, '../../uploads');
  if (u.startsWith('/uploads/')) {
    const rel = u.slice('/uploads/'.length);
    const p = path.join(uploadsRoot, rel);
    if (fs.existsSync(p)) return p;
  }
  if (u.startsWith('uploads/')) {
    const p = path.join(__dirname, '../..', u);
    if (fs.existsSync(p)) return p;
  }
  const pub = path.join(__dirname, '../../public', u.replace(/^\//, ''));
  if (fs.existsSync(pub)) return pub;
  return null;
}

async function tryEmbedLogo(pdf, urlOrPath) {
  if (urlOrPath) {
    if (/^https?:\/\//i.test(urlOrPath)) {
      const img = await embedImageFromUrl(pdf, urlOrPath);
      if (img) return img;
    } else {
      const local =
        urlOrPath.startsWith('/') || urlOrPath.includes(path.sep)
          ? resolveLocalPhotoPath(urlOrPath) || urlOrPath
          : path.join(__dirname, '../../public', urlOrPath.replace(/^\//, ''));
      const img = await embedImageFromPath(pdf, local);
      if (img) return img;
    }
  }
  const candidates = [
    path.join(__dirname, '../../public/assets/SeniorFloors.png'),
    path.join(__dirname, '../../public/assets/logoSeniorFloors.png'),
  ];
  for (const p of candidates) {
    const img = await embedImageFromPath(pdf, p);
    if (img) return img;
  }
  return null;
}

function drawLogoBlock(page, pdf, logo, x, yTop, maxW) {
  if (!logo) return 0;
  const lw = maxW;
  const lh = (logo.height / logo.width) * lw;
  page.drawImage(logo, { x, y: yTop - lh, width: lw, height: lh });
  return lh;
}

/**
 * @param {object} opts
 * @param {object} opts.project
 * @param {Array} opts.materials
 * @param {Array} opts.photos - { url, phase, caption }
 * @param {string} [opts.builderName]
 * @param {string} [opts.builderLogoUrl]
 */
export async function buildBuilderClientReportPdfBuffer(opts) {
  const {
    project = {},
    materials = [],
    photos = [],
    builderName = '',
    builderLogoUrl = '',
  } = opts;

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageW = 612;
  const pageH = 792;
  const margin = 48;
  const contentW = pageW - 2 * margin;
  const lineH = 14;

  let page = pdf.addPage([pageW, pageH]);
  let y = pageH - 48;

  const drawTxt = (text, x, yy, size, f = font, color = PAL.primary) => {
    page.drawText(winAnsiSafe(text), { x, y: yy, size, font: f, color });
  };

  const ensureSpace = (need) => {
    if (y >= need) return;
    page = pdf.addPage([pageW, pageH]);
    y = pageH - margin;
  };

  page.drawRectangle({ x: 0, y: pageH - 5, width: pageW, height: 5, color: PAL.secondary });

  const sfLogo = await tryEmbedLogo(pdf, null);
  const builderLogo = builderLogoUrl ? await tryEmbedLogo(pdf, builderLogoUrl) : null;

  const logoTop = pageH - 20;
  let xCursor = margin;
  if (sfLogo) {
    const h = drawLogoBlock(page, pdf, sfLogo, xCursor, logoTop, 56);
    xCursor += 66;
    y = Math.min(y, logoTop - h - 8);
  }
  if (builderLogo) {
    drawLogoBlock(page, pdf, builderLogo, xCursor, logoTop, 48);
    xCursor += 58;
  }

  drawTxt(COMPANY.name, margin, logoTop - 72, 14, fontBold);
  drawTxt(COMPANY.tagline, margin, logoTop - 86, 8, font, PAL.primaryMuted);
  if (builderName) {
    drawTxt(`Prepared with ${builderName}`, margin, logoTop - 100, 9, font, PAL.primaryMuted);
  }

  y = Math.min(y, logoTop - 115);

  drawTxt('Project Completion Report', margin, y, 16, fontBold);
  y -= 22;
  drawTxt(winAnsiSafe(project.name || project.project_number || 'Project'), margin, y, 12, fontBold);
  y -= 16;
  if (project.address) {
    drawTxt(project.address, margin, y, 10, font, PAL.primaryMuted);
    y -= 14;
  }
  drawTxt(
    `Completed: ${String(project.end_date_actual || project.end_date_estimated || '').slice(0, 10) || '—'}`,
    margin,
    y,
    9,
    font,
    PAL.lineMuted
  );
  y -= 22;

  ensureSpace(120);
  page.drawRectangle({ x: margin, y: y - 52, width: contentW, height: 52, color: PAL.panelBg });
  const details = [
    ['Floor type', project.flooring_type || '—'],
    ['Area', project.total_sqft ? `${project.total_sqft} sq ft` : '—'],
    ['Service', project.service_type || '—'],
    ['Project #', project.project_number || String(project.id || '')],
  ];
  let dy = y - 14;
  details.forEach(([label, val], i) => {
    const col = i < 2 ? margin + 8 : margin + contentW / 2 + 8;
    const rowY = i % 2 === 0 ? dy : dy - 18;
    if (i === 2) dy -= 18;
    drawTxt(`${label}:`, col, rowY, 8, fontBold, PAL.primaryMuted);
    drawTxt(String(val), col + 72, rowY, 9, font);
  });
  y -= 68;

  drawTxt('Services performed', margin, y, 11, fontBold);
  y -= 16;
  const serviceLine = [
    project.service_type,
    project.flooring_type ? `${project.flooring_type} flooring` : null,
    project.total_sqft ? `${project.total_sqft} sq ft installed` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  drawTxt(serviceLine || 'Professional floor installation and finishing by Senior Floors.', margin, y, 9, font);
  y -= 20;

  if (materials.length) {
    drawTxt('Materials used', margin, y, 11, fontBold);
    y -= 14;
    for (const m of materials.slice(0, 12)) {
      ensureSpace(40);
      const line = `• ${m.product_name || 'Material'}${m.material_color ? ` — ${m.material_color}` : ''}${m.sku ? ` (${m.sku})` : ''}`;
      drawTxt(line.slice(0, 90), margin + 4, y, 8, font);
      y -= lineH;
      if (m.material_spec) {
        drawTxt(String(m.material_spec).slice(0, 100), margin + 12, y, 7, font, PAL.lineMuted);
        y -= 12;
      }
    }
    y -= 8;
  }

  const beforePhotos = photos.filter((p) => p.phase === 'before').slice(0, 2);
  const afterPhotos = photos.filter((p) => p.phase === 'after').slice(0, 2);
  const photoPairs = Math.max(beforePhotos.length, afterPhotos.length);

  if (photoPairs > 0) {
    ensureSpace(200);
    drawTxt('Before & after', margin, y, 11, fontBold);
    y -= 18;
    const thumbW = (contentW - 16) / 2;
    const thumbH = 100;

    for (let i = 0; i < Math.min(2, photoPairs); i++) {
      ensureSpace(thumbH + 40);
      const b = beforePhotos[i];
      const a = afterPhotos[i];
      if (b?.url) {
        const local = resolveLocalPhotoPath(b.url);
        const img = local
          ? await embedImageFromPath(pdf, local)
          : await embedImageFromUrl(pdf, b.url.startsWith('http') ? b.url : null);
        if (img) {
          const scale = Math.min(thumbW / img.width, thumbH / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          page.drawImage(img, { x: margin, y: y - h, width: w, height: h });
        }
        drawTxt('Before', margin, y - thumbH - 10, 8, fontBold, PAL.lineMuted);
      }
      if (a?.url) {
        const local = resolveLocalPhotoPath(a.url);
        const img = local
          ? await embedImageFromPath(pdf, local)
          : await embedImageFromUrl(pdf, a.url.startsWith('http') ? a.url : null);
        if (img) {
          const scale = Math.min(thumbW / img.width, thumbH / img.height);
          const w = img.width * scale;
          const h = img.height * scale;
          page.drawImage(img, {
            x: margin + thumbW + 16,
            y: y - h,
            width: w,
            height: h,
          });
        }
        drawTxt('After', margin + thumbW + 16, y - thumbH - 10, 8, fontBold, PAL.lineMuted);
      }
      y -= thumbH + 24;
    }
  }

  ensureSpace(50);
  drawTxt(
    `Report generated ${new Date().toLocaleDateString('en-US')} — ${COMPANY.name}`,
    margin,
    margin + 8,
    8,
    font,
    PAL.lineMuted
  );
  drawTxt(`${COMPANY.phone} | ${COMPANY.email}`, margin, margin - 4, 8, font, PAL.lineMuted);

  return Buffer.from(await pdf.save());
}
