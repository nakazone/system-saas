/**
 * Google Apps Script — sincronizar planilha Meta → CRM
 *
 * Instalação: na Google Sheet → Extensões → Apps Script → colar este ficheiro.
 * Depois: ⚙️ Definições do projeto → Propriedades do script → adicionar API_SYNC_SECRET
 *         (mesmo valor que SHEETS_SYNC_SECRET no Railway).
 *
 * Agendar: Acionadores → syncMetaLeadsToCrm → disparador temporal (recomendado: 10–30 min).
 * Diagnóstico: Executar diagnosePendingRows (só lê a planilha) ou testCrmConnection (testa API).
 */

var CONFIG = {
  /** URL base do CRM (sem barra final) */
  API_BASE: 'https://app.senior-floors.com',
  /**
   * Preferir: Apps Script → ⚙ Projeto → Propriedades do script → API_SYNC_SECRET
   * (mesmo valor que SHEETS_SYNC_SECRET no Railway).
   */
  API_SYNC_SECRET: '',
  /** Nome da folha com leads Meta. Vazio = folha activa no momento da execução. */
  SHEET_NAME: '',
  SYNC_COLUMN_HEADER: 'CRM_Synced',
  /** Coluna opcional com motivo de falha (criada automaticamente se faltar). */
  ERROR_COLUMN_HEADER: 'CRM_Sync_Error',
  FORM_NAME: 'meta-instant-form',
  HEADER_ROW: 1,
  MAX_LEADS_PER_BATCH: 150,
  /** Nome EXACTO do cabeçalho de nome (minúsculas após trim), se a detecção automática falhar. */
  NAME_COLUMN_HEADER: '',
};

function getApiSyncSecret_() {
  var fromProps = PropertiesService.getScriptProperties().getProperty('API_SYNC_SECRET');
  if (fromProps && String(fromProps).trim()) return String(fromProps).trim();
  if (CONFIG.API_SYNC_SECRET && String(CONFIG.API_SYNC_SECRET).trim()) return String(CONFIG.API_SYNC_SECRET).trim();
  throw new Error('Defina API_SYNC_SECRET em Propriedades do script (⚙ Projeto).');
}

function getLeadSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = String(CONFIG.SHEET_NAME || '').trim();
  var sheet = name ? ss.getSheetByName(name) : ss.getActiveSheet();
  if (!sheet) {
    throw new Error('Folha não encontrada: "' + (name || '(activa)') + '". Defina CONFIG.SHEET_NAME.');
  }
  return sheet;
}

function formatUsPhoneForCrm_(raw) {
  var s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/^p:\s*/i, '');
  s = s.replace(/^tel:\s*/i, '');
  s = s.replace(/^whatsapp:\s*/i, '');
  var digits = s.replace(/\D/g, '');
  if (digits.length === 11 && digits.charAt(0) === '1') digits = digits.slice(1);
  if (digits.length === 10) {
    return '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
  }
  return s.length > 50 ? s.slice(0, 50) : s;
}

function isRowAlreadySynced_(flag) {
  if (!flag) return false;
  if (flag === 'true' || flag === 'yes' || flag === '1' || flag === 'ok' || flag === 'synced') return true;
  if (/^\d{4}-\d{2}-\d{2}/.test(flag)) return true;
  return false;
}

function resolveColumns_(headers) {
  return {
    name: resolveNameColumn_(headers),
    firstName: findCol(headers, ['first_name', 'first name', 'firstname', 'given name', 'given_name']),
    lastName: findCol(headers, ['last_name', 'last name', 'lastname', 'surname', 'family name', 'family_name']),
    email: findCol(headers, [
      'email',
      'e-mail',
      'email address',
      'email_address',
      'work_email',
      'work email',
      'contact_email',
      'contact email',
    ]),
    phone: findCol(headers, [
      'phone_number',
      'phone number',
      'phone',
      'mobile',
      'mobile phone',
      'telefone',
      'tel',
      'work_phone_number',
      'work phone number',
    ]),
    zip: findCol(headers, ['zip_code', 'zip code', 'zip', 'postal code', 'postcode', 'postal_code', 'cep']),
    service: findCol(headers, [
      'what_service_are_you_interested_in?',
      'what_service_are_you_interested_in',
      'what service are you interested in?',
      'what service are you interested in',
      'which service are you interested in?',
    ]),
    synced: findCol(headers, [CONFIG.SYNC_COLUMN_HEADER.toLowerCase(), 'crm synced', 'synced']),
    error: findCol(headers, [CONFIG.ERROR_COLUMN_HEADER.toLowerCase(), 'crm sync error', 'sync error']),
  };
}

function ensureErrorColumn_(sheet, headers, col) {
  if (col.error >= 0) return col.error;
  var lastCol = sheet.getLastColumn() + 1;
  sheet.getRange(CONFIG.HEADER_ROW, lastCol).setValue(CONFIG.ERROR_COLUMN_HEADER);
  col.error = lastCol - 1;
  return col.error;
}

function writeRowError_(sheet, rowIndex, col, message) {
  if (col.error < 0) return;
  sheet.getRange(rowIndex + 1, col.error + 1).setValue(String(message || '').slice(0, 500));
}

function clearRowError_(sheet, rowIndex, col) {
  if (col.error < 0) return;
  sheet.getRange(rowIndex + 1, col.error + 1).setValue('');
}

function validatePendingRow_(row, col) {
  var name = buildLeadNameFromRow_(row, col);
  var email = col.email >= 0 ? String(row[col.email] || '').trim() : '';
  var phoneRaw = col.phone >= 0 ? String(row[col.phone] || '').trim() : '';
  var phone = formatUsPhoneForCrm_(phoneRaw);

  if (!name || name.length < 2) {
    return { ok: false, reason: 'Nome inválido ou curto: "' + name + '". Confira full_name / first_name+last_name.' };
  }
  if (!phoneRaw) {
    return { ok: false, reason: 'Telefone vazio. Cabeçalho phone_number encontrado?' };
  }
  if (phone.replace(/\D/g, '').length < 10) {
    return { ok: false, reason: 'Telefone inválido: "' + phoneRaw + '" → "' + phone + '".' };
  }
  if (!email) {
    return { ok: true, reason: 'OK (sem email — CRM gera placeholder)', name: name, email: '', phone: phone };
  }
  return { ok: true, reason: 'OK', name: name, email: email, phone: phone };
}

/**
 * Executar manualmente: lista cada linha pendente (CRM_Synced vazio) e o motivo.
 * Não chama a API. Ver Registos → Execuções → Ver registos.
 */
function diagnosePendingRows() {
  var sheet = getLeadSheet_();
  var data = sheet.getDataRange().getValues();
  if (data.length < CONFIG.HEADER_ROW + 1) {
    Logger.log('Planilha vazia ou só cabeçalho.');
    return;
  }

  var headers = data[CONFIG.HEADER_ROW - 1].map(function (h) {
    return String(h || '').trim().toLowerCase();
  });

  Logger.log('Folha: ' + sheet.getName());
  Logger.log('Cabeçalhos: ' + headers.join(' | '));

  var col;
  try {
    col = resolveColumns_(headers);
  } catch (e) {
    Logger.log('ERRO colunas: ' + e.message);
    return;
  }

  if (col.synced < 0) {
    Logger.log('ERRO: coluna "' + CONFIG.SYNC_COLUMN_HEADER + '" não existe na linha 1.');
    return;
  }

  Logger.log(
    'Colunas detectadas → name:' +
      col.name +
      ' first:' +
      col.firstName +
      ' last:' +
      col.lastName +
      ' email:' +
      col.email +
      ' phone:' +
      col.phone
  );

  var pending = 0;
  for (var r = CONFIG.HEADER_ROW; r < data.length; r++) {
    var flag = String(data[r][col.synced] || '').trim().toLowerCase();
    if (isRowAlreadySynced_(flag)) continue;
    pending++;
    var check = validatePendingRow_(data[r], col);
    Logger.log('Linha ' + (r + 1) + ': ' + (check.ok ? 'PRONTO' : 'BLOQUEADA') + ' — ' + check.reason);
  }

  if (pending === 0) {
    Logger.log('Nenhuma linha pendente (todas com CRM_Synced preenchido).');
  } else {
    Logger.log('Total pendente: ' + pending + '. Se PRONTO, rode testCrmConnection e depois syncMetaLeadsToCrm.');
  }

  try {
    getApiSyncSecret_();
    Logger.log('API_SYNC_SECRET: definido (' + getApiSyncSecret_().length + ' caracteres).');
  } catch (e) {
    Logger.log('API_SYNC_SECRET: FALTA — ' + e.message);
  }
}

function syncMetaLeadsToCrm() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) {
    Logger.log('syncMetaLeadsToCrm: outra execução em curso.');
    return;
  }
  try {
    syncMetaLeadsToCrmBody_();
  } finally {
    lock.releaseLock();
  }
}

function syncMetaLeadsToCrmBody_() {
  var sheet = getLeadSheet_();
  var data = sheet.getDataRange().getValues();
  if (data.length < CONFIG.HEADER_ROW + 1) return;

  var headers = data[CONFIG.HEADER_ROW - 1].map(function (h) {
    return String(h || '').trim().toLowerCase();
  });

  var col = resolveColumns_(headers);

  if (col.synced < 0) {
    throw new Error('Coluna "' + CONFIG.SYNC_COLUMN_HEADER + '" não encontrada na linha 1.');
  }
  if ((col.name < 0 && col.firstName < 0) || col.phone < 0) {
    throw new Error(
      'Faltam colunas name/first_name ou phone. Cabeçalhos: ' + headers.join(' | ')
    );
  }

  ensureErrorColumn_(sheet, headers, col);

  var secret;
  try {
    secret = getApiSyncSecret_();
  } catch (e) {
    Logger.log('syncMetaLeadsToCrm: ' + e.message);
    throw e;
  }

  var batchUrl = CONFIG.API_BASE.replace(/\/$/, '') + '/api/receive-lead-batch';
  var maxLeads = Math.max(1, parseInt(CONFIG.MAX_LEADS_PER_BATCH, 10) || 150);
  var batchLeads = [];
  var batchRowR = [];
  var synced = 0;
  var skipped = 0;
  var failed = 0;

  for (var r = CONFIG.HEADER_ROW; r < data.length; r++) {
    if (batchLeads.length >= maxLeads) break;

    var row = data[r];
    var flag = String(row[col.synced] || '').trim().toLowerCase();
    if (isRowAlreadySynced_(flag)) continue;

    var check = validatePendingRow_(row, col);
    if (!check.ok) {
      Logger.log('Linha ' + (r + 1) + ' ignorada: ' + check.reason);
      writeRowError_(sheet, r, col, check.reason);
      skipped++;
      continue;
    }

    clearRowError_(sheet, r, col);

    var zipRaw = col.zip >= 0 ? String(row[col.zip] || '').trim() : '';
    var service = col.service >= 0 ? String(row[col.service] || '').trim() : '';
    var payload = {
      name: check.name,
      phone: check.phone,
      'form-name': CONFIG.FORM_NAME,
    };
    if (check.email) payload.email = check.email;
    if (zipRaw) payload.zipcode = zipRaw;
    if (service) payload.message = service;

    batchLeads.push(payload);
    batchRowR.push(r);
  }

  if (batchLeads.length === 0) {
    Logger.log('syncMetaLeadsToCrm: nenhuma linha pendente válida (skipped=' + skipped + ').');
    return;
  }

  var res = UrlFetchApp.fetch(batchUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ 'form-name': CONFIG.FORM_NAME, leads: batchLeads }),
    headers: { 'X-Sheets-Sync': '1', 'X-Sheets-Sync-Secret': secret },
    muteHttpExceptions: true,
  });

  var code = res.getResponseCode();
  var body = res.getContentText() || '';

  if (code < 200 || code >= 300) {
    var batchErr =
      code === 401
        ? 'HTTP 401: API_SYNC_SECRET ≠ SHEETS_SYNC_SECRET no Railway'
        : code === 503
          ? 'HTTP 503: SHEETS_SYNC_SECRET não definido no Railway'
          : 'HTTP ' + code + ': ' + body.slice(0, 200);
    Logger.log('syncMetaLeadsToCrm: ' + batchErr);
    for (var bi = 0; bi < batchRowR.length; bi++) {
      writeRowError_(sheet, batchRowR[bi], col, batchErr);
    }
    return;
  }

  var parsed;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    Logger.log('syncMetaLeadsToCrm: resposta não JSON');
    return;
  }

  if (!parsed.results || !parsed.results.length) {
    Logger.log('syncMetaLeadsToCrm: batch sem results');
    return;
  }

  for (var ri = 0; ri < parsed.results.length; ri++) {
    var item = parsed.results[ri];
    var idx = item.index;
    if (idx < 0 || idx >= batchRowR.length) continue;
    var rowIdx = batchRowR[idx];

    if (item.status >= 200 && item.status < 300 && item.success) {
      sheet.getRange(rowIdx + 1, col.synced + 1).setValue(new Date().toISOString());
      clearRowError_(sheet, rowIdx, col);
      if (item.duplicate_skipped) {
        writeRowError_(sheet, rowIdx, col, 'Duplicado no CRM (lead_id ' + item.lead_id + ')');
      }
      synced++;
    } else {
      var itemErr = (item.errors && item.errors.join(', ')) || item.db_error || item.message || JSON.stringify(item);
      writeRowError_(sheet, rowIdx, col, 'CRM rejeitou: ' + String(itemErr).slice(0, 300));
      Logger.log('Linha ' + (rowIdx + 1) + ' falha: ' + itemErr);
      failed++;
    }
  }

  Logger.log('syncMetaLeadsToCrm: OK=' + synced + ' falhas=' + failed + ' ignoradas=' + skipped);
}

function isLikelyServiceOrCampaignHeader_(h) {
  if (!h) return false;
  if (h === 'ad_name' || h === 'form_name' || h === 'campaign_name' || h === 'adset_name') return true;
  if (h.indexOf('campaign') !== -1 || h.indexOf('campanha') !== -1) return true;
  if (h.indexOf('ad set') !== -1 || h.indexOf('adset') !== -1) return true;
  if (h.indexOf('lead form') !== -1 || h.indexOf('form id') !== -1) return true;
  if (h.indexOf('[') !== -1 || h.indexOf(']') !== -1) return true;
  if (h.indexOf('service') !== -1 && h.indexOf('full') === -1) return true;
  return false;
}

function resolveNameColumn_(headers) {
  var exactOverride = String(CONFIG.NAME_COLUMN_HEADER || '').trim().toLowerCase();
  if (exactOverride) {
    for (var o = 0; o < headers.length; o++) {
      if (headers[o] === exactOverride) return o;
    }
  }
  var direct = findCol(headers, [
    'full_name',
    'full name',
    'nome completo',
    'first and last name',
    'your full name',
    'contact name',
    'first_name',
    'first name',
    'nome',
  ]);
  if (direct >= 0) return direct;
  return findNameColumnFallback_(headers);
}

function findNameColumnFallback_(headers) {
  var j;
  for (j = 0; j < headers.length; j++) {
    var h = headers[j];
    if (isLikelyServiceOrCampaignHeader_(h)) continue;
    if (h === 'name' || h === 'nome') return j;
  }
  for (j = 0; j < headers.length; j++) {
    var h2 = headers[j];
    if (isLikelyServiceOrCampaignHeader_(h2)) continue;
    if (h2.indexOf('name') !== -1 && h2.indexOf('company') === -1 && h2.indexOf('business') === -1) return j;
  }
  return -1;
}

function findCol(headers, candidates) {
  var i;
  var j;
  for (i = 0; i < candidates.length; i++) {
    var want = candidates[i].toLowerCase();
    for (j = 0; j < headers.length; j++) {
      if (headers[j] === want) return j;
    }
  }
  for (i = 0; i < candidates.length; i++) {
    var w = candidates[i].toLowerCase();
    for (j = 0; j < headers.length; j++) {
      if (headers[j].indexOf(w) !== -1) return j;
    }
  }
  return -1;
}

function buildLeadNameFromRow_(row, col) {
  if (col.name >= 0) {
    var direct = String(row[col.name] || '').trim();
    if (direct) return direct;
  }
  var first = col.firstName >= 0 ? String(row[col.firstName] || '').trim() : '';
  var last = col.lastName >= 0 ? String(row[col.lastName] || '').trim() : '';
  return [first, last]
    .filter(function (x) {
      return x;
    })
    .join(' ');
}

/** Teste API: Executar → testCrmConnection → ver Registos */
function testCrmConnection() {
  var secret;
  try {
    secret = getApiSyncSecret_();
  } catch (e) {
    Logger.log('FALHA: ' + e.message);
    return;
  }
  var url = CONFIG.API_BASE.replace(/\/$/, '') + '/api/receive-lead-batch';
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      'form-name': 'meta-instant-form',
      leads: [
        {
          name: 'CRM Sync Test',
          email: 'crm-sync-test-' + new Date().getTime() + '@example.com',
          phone: '(303) 555-0199',
          zipcode: '80202',
        },
      ],
    }),
    headers: { 'X-Sheets-Sync': '1', 'X-Sheets-Sync-Secret': secret },
    muteHttpExceptions: true,
  });
  Logger.log('testCrmConnection HTTP ' + res.getResponseCode());
  Logger.log(res.getContentText().slice(0, 1000));
  if (res.getResponseCode() === 401) {
    Logger.log('→ Corrija API_SYNC_SECRET (Apps Script) = SHEETS_SYNC_SECRET (Railway).');
  }
}
