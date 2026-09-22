/**
 * Authentication middleware - protect routes
 */
import { permissionKeysInclude } from '../lib/userPermissions.js';

export function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    return res.redirect('/login.html');
  }

  if (req.session.mustChangePassword) {
    const path = req.path || '';
    const allowed =
      path === '/api/auth/change-password' ||
      path === '/api/auth/logout' ||
      path === '/api/auth/session';
    if (!allowed) {
      return res.status(403).json({
        success: false,
        code: 'MUST_CHANGE_PASSWORD',
        error: 'must_change_password',
        message: 'Defina uma nova senha antes de continuar.',
      });
    }
  }

  return next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }
      return res.redirect('/login.html');
    }

    if (!roles.includes(req.session.userRole)) {
      if (req.path.startsWith('/api/')) {
        return res.status(403).json({ success: false, error: 'Insufficient permissions' });
      }
      return res.status(403).send('Access denied');
    }

    next();
  };
}

/** Admin ignora; outros precisam da chave em req.session.permissionKeys */
export function requirePermission(permissionKey) {
  return (req, res, next) => {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    if (String(req.session.userRole || '').toLowerCase() === 'admin') {
      return next();
    }
    const keys = req.session.permissionKeys || [];
    if (permissionKeysInclude(keys, permissionKey)) {
      return next();
    }
    return res.status(403).json({ success: false, error: 'Sem permissão para esta ação.', required: permissionKey });
  };
}
