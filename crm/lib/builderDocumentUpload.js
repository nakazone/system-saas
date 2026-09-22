import multer from 'multer';
import path from 'path';
import fs from 'fs';

const ALLOWED = ['.pdf', '.jpg', '.jpeg', '.png', '.webp'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(
      process.cwd(),
      'uploads',
      'builder-documents',
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

export const uploadBuilderDocument = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ALLOWED.includes(ext)) cb(null, true);
    else cb(new Error('Use PDF, JPG, PNG or WebP'));
  },
});
