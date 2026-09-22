#!/usr/bin/env node
/**
 * Gera GOOGLE_CALENDAR_REFRESH_TOKEN (one-time).
 * Uso: defina GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET, GOOGLE_CALENDAR_OAUTH_REDIRECT_URI no .env
 *      npm run google-calendar:token
 */
import 'dotenv/config';
import { google } from 'googleapis';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const id = process.env.GOOGLE_CALENDAR_CLIENT_ID;
const secret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
const redirect = process.env.GOOGLE_CALENDAR_OAUTH_REDIRECT_URI || 'http://localhost:3000/api/integrations/google-calendar/callback';

if (!id || !secret) {
  console.error('Defina GOOGLE_CALENDAR_CLIENT_ID e GOOGLE_CALENDAR_CLIENT_SECRET no .env');
  process.exit(1);
}

/** Aceita só o code ou a URL completa de redirecionamento (?code=...). */
function extractAuthorizationCode(raw) {
  let s = String(raw).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  if (!s) return '';
  if (s.includes('code=')) {
    try {
      const withProtocol = /^https?:\/\//i.test(s) ? s : `http://local.invalid${s.startsWith('?') ? '' : '/'}${s}`;
      const u = new URL(withProtocol);
      const c = u.searchParams.get('code');
      if (c) return c;
    } catch {
      /* fall through */
    }
    const m = s.match(/[?&]code=([^&]+)/);
    if (m) return decodeURIComponent(m[1].replace(/\+/g, ' '));
  }
  return s;
}

const oauth2 = new google.auth.OAuth2(id, secret, redirect);
const url = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent select_account',
  scope: ['https://www.googleapis.com/auth/calendar.events'],
});

console.log('\nRedirect URI usado (tem de estar igual no Google Cloud):');
console.log(' ', redirect);
console.log('\n1) Abra esta URL no browser:\n\n', url, '\n');
console.log('2) Após autorizar, copie o valor de ?code=... da barra de endereço (pode colar a URL inteira).\n');

const rl = readline.createInterface({ input, output });
const pasted = (await rl.question('Cole o code ou a URL completa: ')).trim();
rl.close();

const code = extractAuthorizationCode(pasted);
if (!code) {
  console.error('Não foi possível obter o authorization code.');
  process.exit(1);
}

try {
  const { tokens } = await oauth2.getToken(code);
  console.log('\n--- Guarde no Railway / .env ---\n');
  if (tokens.refresh_token) {
    console.log('GOOGLE_CALENDAR_REFRESH_TOKEN=' + tokens.refresh_token);
  } else {
    console.log('GOOGLE_CALENDAR_REFRESH_TOKEN=(não veio — siga os passos abaixo)\n');
    console.log('O Google só devolve refresh_token na primeira autorização ou depois de revogar:');
    console.log('  https://myaccount.google.com/permissions');
    console.log('  → Remover acesso da sua app → volte a correr este script e autorize de novo.\n');
    console.log('Ou use o OAuth 2.0 Playground (veja docs/google-calendar-setup.md).');
  }
  if (tokens.access_token) {
    console.log('\n(access_token foi obtido; o servidor precisa do refresh_token acima.)');
  }
} catch (e) {
  console.error('Erro ao trocar code por tokens:', e.message);
  if (/invalid_grant/i.test(e.message)) {
    console.error('\nO code expira em minutos ou já foi usado. Gere um novo URL e autorize de novo.');
  }
  if (/redirect_uri/i.test(e.message)) {
    console.error('\nVerifique se GOOGLE_CALENDAR_OAUTH_REDIRECT_URI no .env é EXATAMENTE o mesmo que no Google Cloud.');
  }
  process.exit(1);
}
