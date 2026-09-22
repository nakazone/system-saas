/**
 * Builder portal password rules (shared by API and optional client checks).
 */
export function validateBuilderPortalPassword(password) {
  const p = String(password || '');
  if (p.length < 8) return 'Password must be at least 8 characters';
  if (!/[a-zA-Z]/.test(p)) return 'Password must include at least one letter';
  if (!/[0-9]/.test(p)) return 'Password must include at least one number';
  return null;
}
