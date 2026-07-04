/**
 * OpenTicket MCP server (F1, US-003) — streamable HTTP at /api/mcp.
 *
 * Tools (adapter doc §6-§8): search_events, get_ticket, buy_ticket,
 * get_order, set_reminder. Thin adapter: buy_ticket mounts the core's pure
 * `mcpRail` on PurchaseCore; the rest are catalog/order reads.
 *
 * Trust boundary (PRD §7): every input goes through Zod before touching anything.
 *
 * Auth (README step 7): discovery (search_events/get_ticket/set_reminder) stays
 * open; `buy_ticket` requires an API key. withMcpAuth with required:false checks
 * the bearer if present and attaches authInfo, without blocking discovery tools.
 */
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import {
  AgentCommerceError,
  buyTicketInputSchema,
  DEFAULT_ALARM_OFFSETS_MINUTES,
  generateIcs,
  mcpRail,
  randomId,
} from "@/core";
import { apiKeyRateLimited, verifyApiKeyToken } from "@/lib/api-key";
import {
  getPublishedEvent,
  getTicketTypeDetail,
  searchEvents,
} from "@/lib/catalog";
import { getPurchaseCore, getStore } from "@/lib/context";

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

/** Typed core errors → a result the agent can read and react to. */
function toolError(
  code: string,
  message: string,
  details?: unknown,
): ToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ error: { code, message, details } }),
      },
    ],
    isError: true,
  };
}

async function run(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AgentCommerceError) {
      return toolError(err.code, err.message, err.details);
    }
    console.error("[mcp] unexpected error", err);
    return toolError(
      "internal",
      "unexpected error; retry with the same idempotency_key",
    );
  }
}

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "search_events",
      "Searches published events (title/description/venue) and returns their ticket types with price and available quota.",
      {
        query: z
          .string()
          .max(200)
          .optional()
          .describe("Free text; empty = upcoming events."),
        limit: z.number().int().min(1).max(50).default(20),
      },
      async ({ query, limit }) =>
        run(async () => ok({ events: await searchEvents(query, limit) })),
    );

    server.tool(
      "get_ticket",
      "Details of a ticket type (price in minor units, ISO 4217 currency, available quota) before buying.",
      { ticket_type_id: z.string().min(1).max(64) },
      async ({ ticket_type_id }) =>
        run(async () => {
          const detail = await getTicketTypeDetail(ticket_type_id);
          if (!detail)
            return toolError(
              "invalid_intent",
              "ticket_type_id does not exist or event is unavailable",
            );
          return ok(detail);
        }),
    );

    server.tool(
      "buy_ticket",
      "Buys tickets for an event while honoring the user's spend_limit. Requires an API key (Authorization: Bearer header). Returns pending_payment + checkout_url (Stripe hosted payment); check the final status with get_order. Retry with the SAME idempotency_key.",
      buyTicketInputSchema.shape,
      async (args, extra) =>
        run(async () => {
          const keyId = extra?.authInfo?.clientId;
          if (!keyId) {
            return toolError(
              "unauthorized",
              "API key required: Authorization: Bearer <key> header",
            );
          }
          if (apiKeyRateLimited(keyId)) {
            return toolError(
              "rate_limited",
              "per-minute purchase limit exceeded; retry in a moment",
            );
          }
          return ok(await getPurchaseCore().run(args, mcpRail));
        }),
    );

    server.tool(
      "get_order",
      "Status of an order (pending_payment → confirmed). Once confirmed it includes tickets[] and the .ics path.",
      { order_id: z.string().min(1).max(64) },
      async ({ order_id }) =>
        run(async () => {
          const result = await getPurchaseCore().getOrderResult(order_id);
          if (!result)
            return toolError("invalid_intent", "order_id does not exist");
          return ok(mcpRail.formatResult(result));
        }),
    );

    server.tool(
      "set_reminder",
      "Schedules an email reminder for an OpenTicket event (requires event_id or order_id) and returns the .ics with alarms. Default: 24h and 1h before.",
      {
        event_id: z.string().min(1).max(64).optional(),
        order_id: z.string().min(1).max(64).optional(),
        buyer_email: z.string().email().max(254),
        offsets_minutes: z
          .array(z.number().int().min(0).max(40320))
          .max(5)
          .default(DEFAULT_ALARM_OFFSETS_MINUTES),
      },
      async ({ event_id, order_id, buyer_email, offsets_minutes }) =>
        run(async () => {
          if (!event_id && !order_id) {
            return toolError(
              "invalid_intent",
              "event_id or order_id required (adapter Q3)",
            );
          }
          let ev: {
            id: string;
            title: string;
            venue: string | null;
            startsAt: Date;
            endsAt: Date | null;
          } | null = null;
          if (order_id) {
            const detail = await getStore().getOrderDetail(order_id);
            if (!detail)
              return toolError("invalid_intent", "order_id does not exist");
            ev = detail.event;
          } else if (event_id) {
            ev = await getPublishedEvent(event_id);
          }
          if (!ev) {
            return toolError(
              "event_unavailable",
              "event_id does not exist or is not published",
            );
          }
          const reminderId = randomId("rem");
          await getStore().createReminder({
            id: reminderId,
            orderId: order_id ?? null,
            eventId: ev.id,
            email: buyer_email,
            offsetsMinutes: offsets_minutes,
          });
          const ics = generateIcs({
            uid: `${reminderId}@openticket`,
            title: ev.title,
            location: ev.venue ?? undefined,
            startsAt: ev.startsAt,
            endsAt: ev.endsAt,
            alarmOffsetsMinutes: offsets_minutes,
          });
          return ok({
            status: "scheduled",
            reminder_id: reminderId,
            channel: "email",
            alarms_minutes: offsets_minutes,
            ics,
          });
        }),
    );
  },
  {
    serverInfo: { name: "openticket", version: "0.1.0" },
  },
  {
    basePath: "/api",
    maxDuration: 60,
  },
);

// required:false → discovery passes without a key; buy_ticket enforces authInfo internally.
const authed = withMcpAuth(handler, verifyApiKeyToken, { required: false });

export { authed as GET, authed as POST, authed as DELETE };
