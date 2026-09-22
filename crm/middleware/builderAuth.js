import { verifyBuilderToken } from '../lib/builderJwt.js';

export function requireBuilderAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const payload = verifyBuilderToken(token);
  if (!payload) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  req.builderAuth = payload;
  return next();
}
