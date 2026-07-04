/**
 * Hand-rolled .ics generation (RFC 5545), no dependencies (tech-stack Q2).
 * VCALENDAR / VEVENT / VALARM with default alarms 24h and 1h before.
 * Dates in UTC (Z suffix) — avoids VTIMEZONE and is valid in every calendar.
 * Generated ON-DEMAND from the order (architecture-review D3): never persisted.
 */

export interface IcsInput {
  /** Deterministic UID (e.g. `${orderId}@openticket`) to avoid calendar duplicates. */
  uid: string;
  title: string;
  description?: string;
  location?: string;
  startsAt: Date;
  endsAt?: Date | null;
  /** Minutes before the event for each VALARM. Default [1440, 60]. */
  alarmOffsetsMinutes?: number[];
  /** Injectable for tests (deterministic DTSTAMP). */
  now?: Date;
}

export const DEFAULT_ALARM_OFFSETS_MINUTES = [1440, 60];

/** Escapes text per RFC 5545 §3.3.11: \ ; , and line breaks. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** YYYYMMDDTHHMMSSZ in UTC. */
function formatUtc(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** Negative TRIGGER: 1440 → -PT24H, 60 → -PT1H, 30 → -PT30M. */
function alarmTrigger(minutes: number): string {
  if (minutes > 0 && minutes % 60 === 0) return `-PT${minutes / 60}H`;
  return `-PT${minutes}M`;
}

/** Line folding RFC 5545 §3.1: lines of max 75 OCTETS, continuation with a space.
 *  Byte-aware so multibyte UTF-8 characters are never split. */
function fold(line: string): string[] {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return [line];
  const out: string[] = [];
  let start = 0;
  let first = true;
  while (start < bytes.length) {
    const limit = first ? 75 : 74; // the continuation carries 1 octet for the space
    let end = Math.min(start + limit, bytes.length);
    while (end < bytes.length && ((bytes[end] as number) & 0xc0) === 0x80)
      end--;
    out.push((first ? "" : " ") + bytes.subarray(start, end).toString("utf8"));
    start = end;
    first = false;
  }
  return out;
}

export function generateIcs(input: IcsInput): string {
  const now = input.now ?? new Date();
  const offsets = input.alarmOffsetsMinutes ?? DEFAULT_ALARM_OFFSETS_MINUTES;
  const endsAt =
    input.endsAt ?? new Date(input.startsAt.getTime() + 2 * 60 * 60 * 1000);

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OpenTicket//openticket//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeText(input.uid)}`,
    `DTSTAMP:${formatUtc(now)}`,
    `DTSTART:${formatUtc(input.startsAt)}`,
    `DTEND:${formatUtc(endsAt)}`,
    `SUMMARY:${escapeText(input.title)}`,
  ];
  if (input.description) {
    lines.push(`DESCRIPTION:${escapeText(input.description)}`);
  }
  if (input.location) {
    lines.push(`LOCATION:${escapeText(input.location)}`);
  }
  for (const minutes of offsets) {
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeText(`Reminder: ${input.title}`)}`,
      `TRIGGER:${alarmTrigger(minutes)}`,
      "END:VALARM",
    );
  }
  lines.push("END:VEVENT", "END:VCALENDAR");

  return `${lines.flatMap(fold).join("\r\n")}\r\n`;
}
