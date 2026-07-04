import { Resend } from "resend";
import type { MailerPort, TicketEmailInput } from "@/core/ports";

function renderHtml(input: TicketEmailInput): string {
  const codes = input.tickets
    .map(
      (t) => `<li style="font-family:monospace;font-size:16px">${t.code}</li>`,
    )
    .join("");
  const amount = (input.amount.amountMinor / 100).toFixed(2);
  const icsUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}${input.icsPath}`;
  return `<!doctype html>
<html><body style="font-family:ui-monospace,monospace;background:#0a0a0a;color:#e5e5e5;padding:24px">
  <h1 style="font-size:18px">&gt; openticket — order confirmed ✓</h1>
  <p><strong>${input.eventTitle}</strong><br/>
  ${input.eventStartsAt.toUTCString()}${input.venue ? ` · ${input.venue}` : ""}</p>
  <p>Your tickets:</p>
  <ul>${codes}</ul>
  <p>Total: ${amount} ${input.amount.currency}</p>
  <p>The event is attached as an <code>.ics</code> calendar file (with reminders 24h and 1h before).<br/>
  Also available at: <a href="${icsUrl}" style="color:#4ade80">${icsUrl}</a></p>
  <p style="color:#737373">order ${input.orderId} · openticket</p>
</body></html>`;
}

/** Development fallback: prints the email to the console. Never blocks the demo. */
const consoleMailer: MailerPort = {
  async sendTicketEmail(input) {
    console.log(
      [
        "─".repeat(60),
        `[mailer:console] Ticket email → ${input.to}`,
        `  event  : ${input.eventTitle} @ ${input.eventStartsAt.toISOString()}`,
        `  tickets: ${input.tickets.map((t) => t.code).join(", ")}`,
        `  total  : ${input.amount.amountMinor} ${input.amount.currency} (minor)`,
        `  .ics   : ${input.icsPath} (${input.icsContent.length} bytes)`,
        "─".repeat(60),
      ].join("\n"),
    );
  },
};

/** Real MailerPort (Resend) when RESEND_API_KEY is set; console otherwise. */
export function createMailer(): MailerPort {
  const key = process.env.RESEND_API_KEY;
  if (!key) return consoleMailer;
  const resend = new Resend(key);
  const from = process.env.EMAIL_FROM ?? "OpenTicket <onboarding@resend.dev>";
  return {
    async sendTicketEmail(input) {
      const { error } = await resend.emails.send({
        from,
        to: input.to,
        subject: `Your tickets for ${input.eventTitle}`,
        html: renderHtml(input),
        attachments: [
          {
            filename: "event.ics",
            content: Buffer.from(input.icsContent, "utf8").toString("base64"),
            contentType: "text/calendar",
          },
        ],
      });
      if (error) throw new Error(`Resend: ${error.message}`);
    },
  };
}
