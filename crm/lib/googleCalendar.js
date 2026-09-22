/**
 * Cliente Google Calendar API (OAuth2 refresh token em env).
 */
import { google } from 'googleapis';

export function isGoogleCalendarConfigured() {
  return Boolean(
    process.env.GOOGLE_CALENDAR_CLIENT_ID &&
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET &&
    process.env.GOOGLE_CALENDAR_REFRESH_TOKEN
  );
}

export function getCalendarId() {
  return (process.env.GOOGLE_CALENDAR_ID || 'primary').trim();
}

export function getCalendarTimeZone() {
  return (process.env.GOOGLE_CALENDAR_TIMEZONE || 'America/Chicago').trim();
}

export function getOAuthRedirectUri() {
  return (
    process.env.GOOGLE_CALENDAR_OAUTH_REDIRECT_URI ||
    `http://localhost:${Number(process.env.PORT) || 3000}/api/integrations/google-calendar/callback`
  ).trim();
}

export function getOAuth2Client() {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CALENDAR_CLIENT_ID,
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET,
    getOAuthRedirectUri()
  );
  client.setCredentials({
    refresh_token: process.env.GOOGLE_CALENDAR_REFRESH_TOKEN,
  });
  return client;
}

export function getCalendarApi() {
  const auth = getOAuth2Client();
  return google.calendar({ version: 'v3', auth });
}

/** Fim exclusivo no formato date (all-day): dia seguinte ao último dia do job. */
export function exclusiveEndDateAfterInclusiveEnd(yyyyMmDd) {
  const [y, m, d] = yyyyMmDd.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}
