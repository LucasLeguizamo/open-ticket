/**
 * Generación de .ics (RFC 5545) a mano, sin dependencias (tech-stack Q2).
 * VCALENDAR / VEVENT / VALARM con alarmas por defecto 24h y 1h antes.
 * Fechas en UTC (sufijo Z) — evita VTIMEZONE y es válido en todo calendario.
 * Se genera ON-DEMAND desde la orden (architecture-review D3): no se persiste.
 */

export interface IcsInput {
  /** UID determinístico (p.ej. `${orderId}@openticket`) para no duplicar en el calendario. */
  uid: string;
  title: string;
  description?: string;
  location?: string;
  startsAt: Date;
  endsAt?: Date | null;
  /** Minutos antes del evento para cada VALARM. Default [1440, 60]. */
  alarmOffsetsMinutes?: number[];
  /** Inyectable para tests (DTSTAMP determinístico). */
  now?: Date;
}

export const DEFAULT_ALARM_OFFSETS_MINUTES = [1440, 60];

/** Escapa texto según RFC 5545 §3.3.11: \ ; , y saltos de línea. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** YYYYMMDDTHHMMSSZ en UTC. */
function formatUtc(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/** TRIGGER negativo: 1440 → -PT24H, 60 → -PT1H, 30 → -PT30M. */
function alarmTrigger(minutes: number): string {
  if (minutes > 0 && minutes % 60 === 0) return `-PT${minutes / 60}H`;
  return `-PT${minutes}M`;
}

/** Line folding RFC 5545 §3.1: líneas de máx 75 OCTETOS, continuación con espacio.
 *  Byte-aware para no partir caracteres UTF-8 multibyte. */
function fold(line: string): string[] {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return [line];
  const out: string[] = [];
  let start = 0;
  let first = true;
  while (start < bytes.length) {
    const limit = first ? 75 : 74; // la continuación lleva 1 octeto de espacio
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
