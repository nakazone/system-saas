import multer from 'multer';
import path from 'path';
import fs from 'fs';

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const id = req.params.id || 'new';
    const dir = path.join(process.cwd(), 'uploads', 'users', String(id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `avatar_${Date.now()}${ext || '.jpg'}`);
  },
});

export const uploadUserAvatar = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('Use JPG, PNG, WebP ou GIF'));
  },
});
