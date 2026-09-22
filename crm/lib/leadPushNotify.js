/**
 * Optional phone notification when a new lead is inserted (ntfy.sh or self-hosted ntfy).
 * Railway: set LEAD_NTFY_TOPIC (same string you subscribe to in the ntfy app).
 */
let warnedMissingNtfyTopic = false;

export async function notifyNewLead({ name, email, phone, zipcode, source, leadId, formName }) {
  const topic = (process.env.LEAD_NTFY_TOPIC || '').trim();
  if (!topic) {
    if (!warnedMissingNtfyTopic) {
      warnedMissingNtfyTopic = true;
      console.warn('[leadPushNotify] LEAD_NTFY_TOPIC not set on Railway — no push. Add variable + redeploy.');
    }
    return;
  }

  const base = (process.env.LEAD_NTFY_URL || 'https://ntfy.sh').replace(/\/$/, '');
  const title = `Novo lead: ${name || '—'}`;
  const parts = [source, phone, email, zipcode ? `ZIP ${zipcode}` : null, leadId ? `#${leadId}` : null, formName].filter(Boolean);
  const body = parts.join(' · ').slice(0, 3900);

  try {
    const res = await fetch(`${base}/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: {
        Title: title,
        Priority: 'high',
        Tags: 'incoming_envelope',
      },
      body,
    });
    if (res.ok) {
      console.info('[leadPushNotify] ntfy delivered for lead', leadId ?? '?');
    } else {
      console.error('leadPushNotify: ntfy HTTP', res.status, await res.text().catch(() => ''));
    }
  } catch (e) {
    console.error('leadPushNotify:', e.message);
  }
}
