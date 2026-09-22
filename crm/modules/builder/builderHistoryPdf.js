/**
 * Builder completed-projects portfolio PDF (pdf-lib) — Senior Floors brand.
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

function money(n) {
  const x = Number(n) || 0;
  return `$${x.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

async function tryEmbedLogo(pdf) {
  const candidates = [
    path.join(__dirname, '../../public/assets/SeniorFloors.png'),
    path.join(__dirname, '../../public/assets/logoSeniorFloors.png'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const bytes = fs.readFileSync(p);
        try {
          return await pdf.embedPng(bytes);
        } catch {
          try {
            return await pdf.embedJpg(bytes);
          } catch {
            /* continue */
          }
        }
      }
    } catch {
      /* continue */
    }
  }
  return null;
}

/**
 * @param {object} opts
 * @param {Array} opts.projects
 * @param {object} opts.summary - project_count, total_sqft, total_value
 * @param {string} [opts.builderName]
 * @param {string} [opts.filterLabel]
 */
export async function buildBuilderHistoryPdfBuffer(opts) {
  const { projects = [], summary = {}, builderName = '', filterLabel = '' } = opts;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageW = 612;
  const pageH = 792;
  const margin = 48;
  const contentW = pageW - 2 * margin;
  const lineH = 13;

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

  const logo = await tryEmbedLogo(pdf);
  const lw = logo ? 64 : 0;
  const lh = logo ? (logo.height / logo.width) * lw : 0;
  const logoTop = pageH - 20;
  if (logo) {
    page.drawImage(logo, { x: margin, y: logoTop - lh, width: lw, height: lh });
  }

  const textX = margin + (logo ? lw + 14 : 0);
  drawTxt(COMPANY.name, textX, logoTop - 18, 16, fontBold);
  drawTxt(COMPANY.tagline, textX, logoTop - 34, 8, font, PAL.primaryMuted);
  drawTxt(`${COMPANY.phone} | ${COMPANY.email}`, textX, logoTop - 48, 8, font, PAL.primaryMuted);

  y = Math.min(logoTop - lh - 12, logoTop - 58);

  drawTxt('Completed Projects Portfolio', margin, y, 14, fontBold);
  y -= 18;
  if (builderName) {
    drawTxt(`Partner: ${builderName}`, margin, y, 10, font, PAL.primaryMuted);
    y -= 14;
  }
  if (filterLabel) {
    drawTxt(`Filter: ${filterLabel}`, margin, y, 9, font, PAL.lineMuted);
    y -= 14;
  }

  const sqft = Math.round(Number(summary.total_sqft) || 0).toLocaleString('en-US');
  drawTxt(
    `${summary.project_count || 0} projects  |  ${sqft} sq ft installed  |  ${money(summary.total_value)} total value`,
    margin,
    y,
    10,
    fontBold,
    PAL.primary
  );
  y -= 20;

  const cols = [
    { label: 'Project', w: 108, x: margin },
    { label: 'Address', w: 130, x: margin + 108 },
    { label: 'Floor', w: 52, x: margin + 238 },
    { label: 'Sqft', w: 42, x: margin + 290 },
    { label: 'Value', w: 58, x: margin + 332 },
    { label: 'Done', w: 58, x: margin + 390 },
    { label: 'Photos', w: 42, x: margin + 448 },
  ];

  const drawHeader = () => {
    ensureSpace(80);
    const fs = 8;
    const barH = 16;
    page.drawRectangle({ x: margin, y: y - barH, width: contentW, height: barH, color: PAL.panelBg });
    cols.forEach((c) => drawTxt(c.label, c.x + 2, y - 11, fs, fontBold));
    y -= barH + 4;
  };

  drawHeader();

  const truncate = (s, maxLen) => {
    const t = winAnsiSafe(String(s || ''));
    return t.length > maxLen ? `${t.slice(0, maxLen - 1)}.` : t;
  };

  for (const p of projects) {
    ensureSpace(60);
    if (y < margin + 40) {
      drawHeader();
    }
    const fs = 8;
    const title = p.project_number || p.name || `#${p.id}`;
    const photoLabel =
      p.photo_count > 0
        ? p.has_before_after
          ? `${p.photo_count} (B/A)`
          : String(p.photo_count)
        : '-';
    const row = [
      truncate(title, 22),
      truncate(p.address, 28),
      truncate(p.flooring_type, 10),
      p.total_sqft ? String(Math.round(p.total_sqft)) : '-',
      money(p.contract_value),
      String(p.end_date_actual || '').slice(0, 10) || '-',
      photoLabel,
    ];
    cols.forEach((c, i) => drawTxt(row[i], c.x + 2, y - 10, fs, font, PAL.primary));
    y -= lineH + 2;
    page.drawLine({
      start: { x: margin, y },
      end: { x: pageW - margin, y },
      thickness: 0.25,
      color: PAL.rule,
    });
    y -= 6;
  }

  if (!projects.length) {
    drawTxt('No completed projects in this export.', margin, y - 12, 10, font, PAL.lineMuted);
    y -= 20;
  }

  ensureSpace(40);
  drawTxt(
    `Generated ${new Date().toLocaleDateString('en-US')} — Senior Floors Builder Portal`,
    margin,
    margin + 8,
    8,
    font,
    PAL.lineMuted
  );

  return Buffer.from(await pdf.save());
}
