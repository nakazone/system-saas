import multer from 'multer';
import path from 'path';
import fs from 'fs';

const ALLOWED = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(
      process.cwd(),
      'uploads',
      'builder-messages',
      String(req.builderAuth?.builderId || 'temp')
    );
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${Date.now()}${ALLOWED.includes(ext) ? ext : '.bin'}`);
  },
});

export const uploadBuilderMessageAttachment = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ALLOWED.includes(ext)) cb(null, true);
    else cb(new Error('Use JPG, PNG, WebP or PDF (max 10MB)'));
  },
});
