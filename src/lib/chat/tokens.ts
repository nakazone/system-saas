/**
 * Message body tokens: <@user:UUID>, <@team>, <@all>, <#job:UUID>
 * Escape user text for XSS while preserving structured tokens.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TOKEN_RE =
  /<@(user:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})|team|all|equipe|todos)>|<#job:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})>/gi;

export type ParsedUserMention = { kind: "user"; userId: string };
export type ParsedTeamMention = { kind: "team" };
export type ParsedAllMention = { kind: "all" };
export type ParsedJobLink = { kind: "job"; workOrderId: string };
export type ParsedToken =
  | ParsedUserMention
  | ParsedTeamMention
  | ParsedAllMention
  | ParsedJobLink;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function userMentionToken(userId: string): string {
  return `<@user:${userId}>`;
}

export function jobLinkToken(workOrderId: string): string {
  return `<#job:${workOrderId}>`;
}

export function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escape free text but keep known chat tokens intact. */
export function sanitizeChatBody(raw: string): string {
  const input = String(raw ?? "").slice(0, 20_000);
  const parts: string[] = [];
  let last = 0;
  const re = new RegExp(TOKEN_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    parts.push(escapeHtmlText(input.slice(last, match.index)));
    const full = match[0];
    const lower = full.toLowerCase();
    if (lower === "<@equipe>" || lower === "<@team>") {
      parts.push("<@team>");
    } else if (lower === "<@todos>" || lower === "<@all>") {
      parts.push("<@all>");
    } else {
      parts.push(full);
    }
    last = match.index + full.length;
  }
  parts.push(escapeHtmlText(input.slice(last)));
  return parts.join("").replace(/\r\n/g, "\n").trimEnd();
}

export function parseChatTokens(body: string): ParsedToken[] {
  const found: ParsedToken[] = [];
  const seen = new Set<string>();
  const re = new RegExp(TOKEN_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const full = match[0];
    const lower = full.toLowerCase();
    if (lower.startsWith("<@user:")) {
      const userId = match[2];
      if (userId && isUuid(userId) && !seen.has(`u:${userId}`)) {
        seen.add(`u:${userId}`);
        found.push({ kind: "user", userId });
      }
    } else if (lower === "<@team>" || lower === "<@equipe>") {
      if (!seen.has("team")) {
        seen.add("team");
        found.push({ kind: "team" });
      }
    } else if (lower === "<@all>" || lower === "<@todos>") {
      if (!seen.has("all")) {
        seen.add("all");
        found.push({ kind: "all" });
      }
    } else if (lower.startsWith("<#job:")) {
      const workOrderId = match[3];
      if (workOrderId && isUuid(workOrderId) && !seen.has(`j:${workOrderId}`)) {
        seen.add(`j:${workOrderId}`);
        found.push({ kind: "job", workOrderId });
      }
    }
  }
  return found;
}

/** Autolink http(s) URLs in already-sanitized plain segments (not inside tokens). */
export function linkifySanitizedBody(body: string): string {
  const parts: string[] = [];
  let last = 0;
  const re = new RegExp(TOKEN_RE.source, "gi");
  let match: RegExpExecArray | null;
  const urlRe = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/gi;
  while ((match = re.exec(body)) !== null) {
    parts.push(linkifySegment(body.slice(last, match.index), urlRe));
    parts.push(match[0]);
    last = match.index + match[0].length;
  }
  parts.push(linkifySegment(body.slice(last), urlRe));
  return parts.join("");
}

function linkifySegment(segment: string, urlRe: RegExp): string {
  urlRe.lastIndex = 0;
  return segment.replace(urlRe, (url) => {
    const safe = url.replace(/&amp;/g, "&");
    if (!/^https?:\/\//i.test(safe)) return url;
    const href = escapeHtmlText(safe);
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}

export type RenderChip =
  | { type: "text"; text: string }
  | { type: "user"; userId: string }
  | { type: "team" }
  | { type: "all" }
  | { type: "job"; workOrderId: string };

/** Split body into render chips for UI (tokens + text). */
export function bodyToChips(body: string): RenderChip[] {
  const chips: RenderChip[] = [];
  let last = 0;
  const re = new RegExp(TOKEN_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    if (match.index > last) {
      chips.push({ type: "text", text: body.slice(last, match.index) });
    }
    const full = match[0];
    const lower = full.toLowerCase();
    if (lower.startsWith("<@user:") && match[2]) {
      chips.push({ type: "user", userId: match[2] });
    } else if (lower === "<@team>" || lower === "<@equipe>") {
      chips.push({ type: "team" });
    } else if (lower === "<@all>" || lower === "<@todos>") {
      chips.push({ type: "all" });
    } else if (lower.startsWith("<#job:") && match[3]) {
      chips.push({ type: "job", workOrderId: match[3] });
    } else {
      chips.push({ type: "text", text: full });
    }
    last = match.index + full.length;
  }
  if (last < body.length) {
    chips.push({ type: "text", text: body.slice(last) });
  }
  return chips;
}
