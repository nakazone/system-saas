/**
 * Company owner signature for quote PDFs + client signature helpers.
 */
const OWNER_SIG_KEY = 'quote_owner_signature';
const OWNER_NAME_KEY = 'quote_owner_sign_name';
const OWNER_TITLE_KEY = 'quote_owner_sign_title';
const OWNER_AUTO_DEFAULT_KEY = 'quote_owner_auto_signature';

function parsePngBase64(input) {
  if (!input) return null;
  let raw = String(input).trim();
  const m = raw.match(/^data:image\/png;base64,(.+)$/i);
  if (m) raw = m[1];
  try {
    const buf = Buffer.from(raw, 'base64');
    if (!buf.length || buf.length > 2 * 1024 * 1024) return null;
    return buf;
  } catch {
    return null;
  }
}

export function parseSignaturePngBase64(input) {
  return parsePngBase64(input);
}

async function getTextSetting(pool, key) {
  const [rows] = await pool.query(
    'SELECT text_value FROM company_settings WHERE setting_key = ? LIMIT 1',
    [key]
  );
  const v = rows[0]?.text_value;
  return v != null && String(v).trim() ? String(v).trim() : null;
}

async function setTextSetting(pool, key, value) {
  const text = value != null && String(value).trim() ? String(value).trim().slice(0, 255) : null;
  if (!text) {
    await pool.execute('DELETE FROM company_settings WHERE setting_key = ?', [key]);
    return;
  }
  await pool.execute(
    `INSERT INTO company_settings (setting_key, text_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE text_value = VALUES(text_value), updated_at = NOW()`,
    [key, text]
  );
}

export async function getOwnerSignature(pool) {
  const [sigRows] = await pool.query(
    'SELECT blob_value FROM company_settings WHERE setting_key = ? LIMIT 1',
    [OWNER_SIG_KEY]
  );
  const name = await getTextSetting(pool, OWNER_NAME_KEY);
  const title = await getTextSetting(pool, OWNER_TITLE_KEY);
  const autoRaw = await getTextSetting(pool, OWNER_AUTO_DEFAULT_KEY);
  const raw = sigRows[0]?.blob_value;
  let png = null;
  if (raw) {
    png = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    if (!png.length) png = null;
  }
  return {
    png,
    name,
    title,
    use_auto_signature: autoRaw === '1',
  };
}

export function ownerSignaturePublicMeta(owner, apiBase) {
  const hasImage = !!(owner?.png && owner.png.length);
  return {
    name: owner?.name || '',
    title: owner?.title || '',
    use_auto_signature: !!owner?.use_auto_signature,
    has_image: hasImage,
    image_url: hasImage && apiBase ? `${apiBase}/owner-signature` : null,
  };
}

export async function setOwnerSignature(pool, opts = {}) {
  const { name, title, useAutoSignature, signaturePngBase64, signatureBuffer } = opts;
  const signName = name != null && String(name).trim() ? String(name).trim().slice(0, 255) : null;
  const signTitle = title != null && String(title).trim() ? String(title).trim().slice(0, 255) : null;
  const useAuto = useAutoSignature === true || useAutoSignature === '1' || useAutoSignature === 1;

  let buf = signatureBuffer || parsePngBase64(signaturePngBase64);
  if (!buf || !buf.length) {
    return { ok: false, error: 'Assinatura inválida. Desenhe ou gere a partir do nome.' };
  }
  if (!signName || signName.length < 2) {
    return { ok: false, error: 'Indique o nome do responsável.' };
  }

  await pool.execute(
    `INSERT INTO company_settings (setting_key, blob_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE blob_value = VALUES(blob_value), updated_at = NOW()`,
    [OWNER_SIG_KEY, buf]
  );
  await setTextSetting(pool, OWNER_NAME_KEY, signName);
  if (title != null) {
    if (signTitle) await setTextSetting(pool, OWNER_TITLE_KEY, signTitle);
    else await pool.execute('DELETE FROM company_settings WHERE setting_key = ?', [OWNER_TITLE_KEY]);
  }
  await setTextSetting(pool, OWNER_AUTO_DEFAULT_KEY, useAuto ? '1' : '0');

  return {
    ok: true,
    name: signName,
    title: signTitle,
    use_auto_signature: useAuto,
    has_signature: true,
  };
}

export async function getClientSignatureBuffer(quoteRow) {
  if (!quoteRow?.client_signature_png) return null;
  const b = quoteRow.client_signature_png;
  if (Buffer.isBuffer(b) && b.length) return b;
  if (b && typeof b === 'object' && b.length) return Buffer.from(b);
  return null;
}
