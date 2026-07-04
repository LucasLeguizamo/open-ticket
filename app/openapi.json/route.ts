/**
 * OpenAPI 3.1 de los endpoints públicos (README paso 4).
 *
 * ponytail: escrito a mano. El README pedía generarlo con zod-to-openapi para
 * no desincronizar, pero la superficie pública son 4 rutas simples y solo una
 * (subscribe) tiene schema Zod. No vale una dep nueva todavía. Ceiling: cuando
 * el feed ACP formal (F2) exponga los schemas de core/adapter/rails/schemas.ts,
 * migrar a generación desde Zod y borrar este literal.
 */
export function GET(req: Request): Response {
  const origin = new URL(req.url).origin;
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "OpenTicket — Public API",
      version: "0.1.0",
      description:
        "Endpoints públicos de descubrimiento agéntico. La compra se hace por MCP (/api/mcp).",
    },
    servers: [{ url: origin }],
    paths: {
      "/api/events": {
        get: {
          summary: "Feed de eventos publicados",
          parameters: [
            {
              name: "q",
              in: "query",
              required: false,
              schema: { type: "string", maxLength: 200 },
              description: "Texto libre; vacío = próximos eventos.",
            },
          ],
          responses: {
            "200": {
              description: "Eventos con sus tipos de ticket",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/EventsResponse" },
                },
              },
            },
          },
        },
      },
      "/api/ticker": {
        get: {
          summary: "Ticker de actividad en vivo (SSE)",
          responses: {
            "200": {
              description: "Stream text/event-stream de TickerEvent",
              content: { "text/event-stream": {} },
            },
          },
        },
      },
      "/api/newsletter/subscribe": {
        post: {
          summary: "Suscribir un email al digest",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email"],
                  properties: {
                    email: { type: "string", format: "email", maxLength: 254 },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Suscrito" },
            "400": { description: "Email inválido" },
            "429": { description: "Rate limit" },
          },
        },
      },
    },
    components: {
      schemas: {
        EventsResponse: {
          type: "object",
          properties: {
            count: { type: "integer" },
            events: {
              type: "array",
              items: { $ref: "#/components/schemas/Event" },
            },
          },
        },
        Event: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            slug: { type: "string" },
            venue: { type: ["string", "null"] },
            starts_at: { type: "string", format: "date-time" },
            timezone: { type: "string" },
            currency: { type: "string" },
            status: { type: "string" },
            ticket_types: {
              type: "array",
              items: { $ref: "#/components/schemas/TicketType" },
            },
          },
        },
        TicketType: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            price_minor: { type: "integer" },
            currency: { type: "string" },
            available: { type: "integer" },
            status: { type: "string" },
          },
        },
      },
    },
  };
  return Response.json(spec, {
    headers: { "cache-control": "public, max-age=300, s-maxage=3600" },
  });
}
