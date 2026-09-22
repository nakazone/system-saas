import multer from 'multer';
import path from 'path';
import fs from 'fs';

const projectPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const id = req.params.id || req.params.projectId;
    const dir = path.join(process.cwd(), 'uploads', 'projects', String(id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});

export const uploadProjectPhoto = multer({
  storage: projectPhotoStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'];
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Formato não suportado. Use JPG, PNG, WebP, HEIC ou HEIF'));
  },
});
