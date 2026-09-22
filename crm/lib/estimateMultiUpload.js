import multer from 'multer';
import path from 'path';
import fs from 'fs';

const ALLOWED = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(
      process.cwd(),
      'uploads',
      'estimates',
      String(req.builderAuth?.builderId || 'temp')
    );
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ALLOWED.includes(ext) ? ext : '.bin'}`);
  },
});

export const uploadEstimateFiles = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ALLOWED.includes(ext)) cb(null, true);
    else cb(new Error('Use JPG, PNG, WebP or PDF'));
  },
});
