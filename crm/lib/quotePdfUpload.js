/**
 * Upload de PDF de orçamento externo (ex.: Invoice2Go) — guardado em uploads/quote-pdfs/
 */
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const QUOTE_UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');
export const QUOTE_PDF_SUBDIR = 'quote-pdfs';

function ensureQuotePdfDir() {
    const dir = path.join(QUOTE_UPLOAD_ROOT, QUOTE_PDF_SUBDIR);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        try {
            cb(null, ensureQuotePdfDir());
        } catch (e) {
            cb(e);
        }
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${randomUUID()}.pdf`);
    },
});

const upload = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok =
            file.mimetype === 'application/pdf' ||
            (file.originalname && String(file.originalname).toLowerCase().endsWith('.pdf'));
        if (ok) cb(null, true);
        else cb(new Error('Apenas ficheiros PDF são aceites.'));
    },
});

export const quoteInvoicePdfUpload = upload.single('file');

export function quotePdfUploadMiddleware(req, res, next) {
    quoteInvoicePdfUpload(req, res, (err) => {
        if (err) {
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(400).json({ success: false, error: 'PDF demasiado grande (máx. 15 MB).' });
                }
                return res.status(400).json({ success: false, error: err.message });
            }
            return res.status(400).json({ success: false, error: err.message || 'Upload inválido.' });
        }
        next();
    });
}

/** Caminho absoluto no disco; só aceita subpasta quote-pdfs/ */
export function resolvedPdfAbsolutePath(storedRelative) {
    if (!storedRelative || typeof storedRelative !== 'string') return null;
    const parts = String(storedRelative)
        .replace(/^\/+/, '')
        .split(/[/\\]+/)
        .filter((p) => p && p !== '..' && p !== '.');
    if (parts.length < 2 || parts[0] !== QUOTE_PDF_SUBDIR) return null;
    return path.join(QUOTE_UPLOAD_ROOT, ...parts);
}
