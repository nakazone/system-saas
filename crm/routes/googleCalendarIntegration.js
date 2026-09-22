/**
 * Status e OAuth callback para configurar Google Calendar (admin).
 */
import { google } from 'googleapis';
import {
  getOAuthRedirectUri,
  isGoogleCalendarConfigured,
  getCalendarId,
} from '../lib/googleCalendar.js';

export async function googleCalendarStatus(req, res) {
  try {
    res.json({
      success: true,
      configured: isGoogleCalendarConfigured(),
      calendarId: getCalendarId(),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

/** URL de autorização (cole no browser, depois copie o ?code= para o script ou use callback). */
export async function googleCalendarOAuthStart(req, res) {
  try {
    if (!process.env.GOOGLE_CALENDAR_CLIENT_ID || !process.env.GOOGLE_CALENDAR_CLIENT_SECRET) {
      return res.status(400).json({
        success: false,
        error: 'Defina GOOGLE_CALENDAR_CLIENT_ID e GOOGLE_CALENDAR_CLIENT_SECRET',
      });
    }
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CALENDAR_CLIENT_ID,
      process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
      getOAuthRedirectUri()
    );
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      // Força ecrã de consentimento + escolha de conta (Google só devolve refresh_token na “primeira” autorização ou após revogar)
      prompt: 'consent select_account',
      scope: ['https://www.googleapis.com/auth/calendar.events'],
    });
    res.json({ success: true, authUrl: url, redirectUri: getOAuthRedirectUri() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
}

/** Troca code por tokens (use uma vez; guarde refresh_token nas variáveis Railway). */
export async function googleCalendarOAuthCallback(req, res) {
  try {
    const code = req.query.code;
    if (!code) {
      return res.status(400).send('Missing ?code= — recomece em /api/integrations/google-calendar/oauth-url');
    }
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CALENDAR_CLIENT_ID,
      process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
      getOAuthRedirectUri()
    );
    const { tokens } = await oauth2Client.getToken(code);
    const refresh = tokens.refresh_token;
    const esc = (s) =>
      String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google Calendar — token</title></head><body style="font-family:system-ui,sans-serif;max-width:720px;margin:24px;">
      <h1>Google Calendar — refresh token</h1>
      <p>Copie o valor abaixo para <code>GOOGLE_CALENDAR_REFRESH_TOKEN</code> no Railway (ou .env) e faça redeploy.</p>
      <pre style="word-break:break-all;background:#f5f5f5;padding:12px;border-radius:8px;">${refresh ? esc(refresh) : '<strong>(não veio refresh_token)</strong>'}</pre>
      ${
        refresh
          ? ''
          : `<div style="background:#fff3cd;padding:12px;border-radius:8px;margin-top:16px;">
        <h2 style="margin-top:0;">O Google muitas vezes <em>não</em> envia refresh_token se:</h2>
        <ol>
          <li>Já autorizou esta app antes — <strong>revogue o acesso</strong>: 
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">myaccount.google.com/permissions</a> 
            → encontre o projeto → “Remover acesso”. Depois volte a abrir o <code>authUrl</code> e autorize outra vez.</li>
          <li>O cliente OAuth não é tipo <strong>Aplicação Web</strong> ou o <strong>Redirect URI</strong> não coincide à letra com o do Google Cloud.</li>
        </ol>
        <p>Alternativa que costuma funcionar: <strong>OAuth 2.0 Playground</strong> — veja <code>docs/google-calendar-setup.md</code> → secção “OAuth Playground”.</p>
      </div>`
      }
      <p style="margin-top:24px;color:#666;font-size:0.9rem;">Se recebeu refresh_token, guarde-o só em variáveis de ambiente seguras; não commite no Git.</p>
    </body></html>`);
  } catch (e) {
    res.status(500).send(`Error: ${e.message}`);
  }
}
