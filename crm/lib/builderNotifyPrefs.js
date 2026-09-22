/**
 * Respect builder notification_prefs before sending email.
 */
export function parseNotificationPrefs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw) || {};
  } catch {
    return {};
  }
}

/** @param {'project_status'|'messages'|'checklist'|'documents'|'visits'|'pricing'} event */
export function builderWantsEmail(prefs, event) {
  const p = parseNotificationPrefs(prefs);
  const map = {
    project_status: 'project_status',
    messages: 'messages',
    checklist: 'checklist',
    documents: 'documents',
    visits: 'visits',
    pricing: 'pricing',
  };
  const key = map[event] || event;
  if (p[key] === false) return false;
  return true;
}
