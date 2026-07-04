/**
 * .ics RFC 5545 (R9): estructura, VALARM, escaping, folding a 75 octetos.
 */
import { describe, expect, it } from "vitest";
import { generateIcs } from "@/core/ics";

const base = {
  uid: "ord_123@openticket",
  title: "Agent Commerce Conf",
  startsAt: new Date("2026-08-01T20:00:00Z"),
  now: new Date("2026-07-01T00:00:00Z"),
};

describe("generateIcs", () => {
  it("VCALENDAR válido con DTSTART/DTEND UTC y CRLF", () => {
    const ics = generateIcs(base);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("UID:ord_123@openticket");
    expect(ics).toContain("DTSTART:20260801T200000Z");
    expect(ics).toContain("DTEND:20260801T220000Z"); // default +2h
    expect(ics).toContain("DTSTAMP:20260701T000000Z");
    expect(ics).not.toMatch(/(?<!\r)\n/); // solo CRLF
  });

  it("VALARM por defecto: 24h y 1h antes", () => {
    const ics = generateIcs(base);
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(2);
    expect(ics).toContain("TRIGGER:-PT24H");
    expect(ics).toContain("TRIGGER:-PT1H");
  });

  it("offsets custom, incluidos no-múltiplos de hora", () => {
    const ics = generateIcs({ ...base, alarmOffsetsMinutes: [30] });
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(1);
    expect(ics).toContain("TRIGGER:-PT30M");
  });

  it("escapa ; , \\ y saltos de línea (RFC 5545 §3.3.11)", () => {
    const ics = generateIcs({
      ...base,
      title: "a;b,c\\d",
      description: "línea1\nlínea2",
    });
    expect(ics).toContain("SUMMARY:a\\;b\\,c\\\\d");
    expect(ics).toContain("DESCRIPTION:línea1\\nlínea2");
  });

  it("folding: ninguna línea supera 75 octetos", () => {
    const ics = generateIcs({
      ...base,
      title: "Un título larguísimo con acentos y ñ ".repeat(10),
    });
    for (const line of ics.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
  });
});
