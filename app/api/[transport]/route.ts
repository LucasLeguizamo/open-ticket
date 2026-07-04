/**
 * MCP server de OpenTicket (F1, US-003) — streamable HTTP en /api/mcp.
 *
 * Tools (adapter doc §6-§8): search_events, get_ticket, buy_ticket,
 * get_order, set_reminder. Adaptador delgado: buy_ticket monta el `mcpRail`
 * puro del core sobre PurchaseCore; el resto son lecturas de catálogo/orden.
 *
 * Trust boundary (PRD §7): todo input pasa por Zod antes de tocar nada.
 *
 * Auth (README paso 7): discovery (search_events/get_ticket/set_reminder) queda
 * abierto; `buy_ticket` exige API key. withMcpAuth con required:false verifica el
 * bearer si viene y adjunta authInfo, sin bloquear las tools de descubrimiento.
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

/** Errores tipados del core → resultado que el agente puede leer y reaccionar. */
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
    console.error("[mcp] error inesperado", err);
    return toolError(
      "internal",
      "error inesperado; reintenta con la misma idempotency_key",
    );
  }
}

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "search_events",
      "Busca eventos publicados (título/descripción/venue) y devuelve sus tipos de ticket con precio y cupo disponible.",
      {
        query: z
          .string()
          .max(200)
          .optional()
          .describe("Texto libre; vacío = próximos eventos."),
        limit: z.number().int().min(1).max(50).default(20),
      },
      async ({ query, limit }) =>
        run(async () => ok({ events: await searchEvents(query, limit) })),
    );

    server.tool(
      "get_ticket",
      "Detalle de un tipo de ticket (precio en unidades mínimas, moneda ISO 4217, cupo disponible) antes de comprar.",
      { ticket_type_id: z.string().min(1).max(64) },
      async ({ ticket_type_id }) =>
        run(async () => {
          const detail = await getTicketTypeDetail(ticket_type_id);
          if (!detail)
            return toolError(
              "invalid_intent",
              "ticket_type_id inexistente o evento no disponible",
            );
          return ok(detail);
        }),
    );

    server.tool(
      "buy_ticket",
      "Compra tickets para un evento respetando el spend_limit del usuario. Requiere API key (header Authorization: Bearer). Devuelve pending_payment + checkout_url (pago hospedado Stripe); el estado final se consulta con get_order. Reintenta con la MISMA idempotency_key.",
      buyTicketInputSchema.shape,
      async (args, extra) =>
        run(async () => {
          const keyId = extra?.authInfo?.clientId;
          if (!keyId) {
            return toolError(
              "unauthorized",
              "se requiere API key: header Authorization: Bearer <key>",
            );
          }
          if (apiKeyRateLimited(keyId)) {
            return toolError(
              "rate_limited",
              "límite de compras por minuto excedido; reintenta en un momento",
            );
          }
          return ok(await getPurchaseCore().run(args, mcpRail));
        }),
    );

    server.tool(
      "get_order",
      "Estado de una orden (pending_payment → confirmed). Al confirmarse incluye tickets[] y el path del .ics.",
      { order_id: z.string().min(1).max(64) },
      async ({ order_id }) =>
        run(async () => {
          const result = await getPurchaseCore().getOrderResult(order_id);
          if (!result)
            return toolError("invalid_intent", "order_id inexistente");
          return ok(mcpRail.formatResult(result));
        }),
    );

    server.tool(
      "set_reminder",
      "Agenda un recordatorio por email para un evento de OpenTicket (requiere event_id u order_id) y devuelve el .ics con alarmas. Default: 24h y 1h antes.",
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
              "se requiere event_id u order_id (adapter Q3)",
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
              return toolError("invalid_intent", "order_id inexistente");
            ev = detail.event;
          } else if (event_id) {
            ev = await getPublishedEvent(event_id);
          }
          if (!ev) {
            return toolError(
              "event_unavailable",
              "event_id inexistente o no publicado",
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

// required:false → discovery pasa sin key; buy_ticket exige authInfo por dentro.
const authed = withMcpAuth(handler, verifyApiKeyToken, { required: false });

export { authed as GET, authed as POST, authed as DELETE };
