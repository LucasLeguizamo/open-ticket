/**
 * .ics RFC 5545 (R9): structure, VALARM, escaping, folding at 75 octets.
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
  it("valid VCALENDAR with UTC DTSTART/DTEND and CRLF", () => {
    const ics = generateIcs(base);
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("UID:ord_123@openticket");
    expect(ics).toContain("DTSTART:20260801T200000Z");
    expect(ics).toContain("DTEND:20260801T220000Z"); // default +2h
    expect(ics).toContain("DTSTAMP:20260701T000000Z");
    expect(ics).not.toMatch(/(?<!\r)\n/); // CRLF only
  });

  it("default VALARM: 24h and 1h before", () => {
    const ics = generateIcs(base);
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(2);
    expect(ics).toContain("TRIGGER:-PT24H");
    expect(ics).toContain("TRIGGER:-PT1H");
  });

  it("custom offsets, including non-multiples of an hour", () => {
    const ics = generateIcs({ ...base, alarmOffsetsMinutes: [30] });
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(1);
    expect(ics).toContain("TRIGGER:-PT30M");
  });

  it("escapes ; , \\ and line breaks (RFC 5545 §3.3.11)", () => {
    const ics = generateIcs({
      ...base,
      title: "a;b,c\\d",
      description: "line1\nline2",
    });
    expect(ics).toContain("SUMMARY:a\\;b\\,c\\\\d");
    expect(ics).toContain("DESCRIPTION:line1\\nline2");
  });

  it("folding: no line exceeds 75 octets", () => {
    const ics = generateIcs({
      ...base,
      title: "A very long title with accents like á and ñ ".repeat(10),
    });
    for (const line of ics.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
  });
});
