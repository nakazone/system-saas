/**
 * iCalendar (.ics) feed for Schedule → Apple Calendar / Google Calendar subscriptions.
 */

export type ScheduleIcsEvent = {
  uid: string;
  summary: string;
  description?: string;
  location?: string | null;
  start: Date;
  end: Date;
  stamp?: Date;
  status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
};

function escapeIcsText(value: string) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n/g, "\n")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/** UTC form YYYYMMDDTHHMMSSZ — stable across timezones for subscriptions. */
function formatIcsUtc(date: Date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function foldLine(line: string) {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length) {
    parts.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return parts.join("\r\n");
}

export function buildScheduleIcsCalendar(
  events: ScheduleIcsEvent[],
  opts?: { name?: string; prodId?: string },
): string {
  const name = opts?.name || "ObraMate Schedule";
  const prodId = opts?.prodId || "-//ObraMate//Schedule//PT";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${prodId}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(name)}`,
    "X-WR-TIMEZONE:UTC",
  ];

  for (const ev of events) {
    const stamp = ev.stamp || new Date();
    const status = ev.status || "CONFIRMED";
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${escapeIcsText(ev.uid)}`);
    lines.push(`DTSTAMP:${formatIcsUtc(stamp)}`);
    lines.push(`DTSTART:${formatIcsUtc(ev.start)}`);
    lines.push(`DTEND:${formatIcsUtc(ev.end)}`);
    lines.push(`SUMMARY:${escapeIcsText(ev.summary)}`);
    if (ev.location) lines.push(`LOCATION:${escapeIcsText(ev.location)}`);
    if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
    lines.push(`STATUS:${status}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
