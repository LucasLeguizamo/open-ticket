/**
 * OpenAPI 3.1 for the public endpoints (README step 4).
 *
 * ponytail: hand-written. The README asked to generate it with zod-to-openapi
 * to avoid drift, but the public surface is 4 simple routes and only one
 * (subscribe) has a Zod schema. Not worth a new dep yet. Ceiling: once the
 * formal ACP feed (F2) exposes the schemas from core/adapter/rails/schemas.ts,
 * migrate to Zod-based generation and delete this literal.
 */
export function GET(req: Request): Response {
  const origin = new URL(req.url).origin;
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "OpenTicket — Public API",
      version: "0.1.0",
      description:
        "Public endpoints for agentic discovery. Purchases go through MCP (/api/mcp).",
    },
    servers: [{ url: origin }],
    paths: {
      "/api/events": {
        get: {
          summary: "Feed of published events",
          parameters: [
            {
              name: "q",
              in: "query",
              required: false,
              schema: { type: "string", maxLength: 200 },
              description: "Free text; empty = upcoming events.",
            },
          ],
          responses: {
            "200": {
              description: "Events with their ticket types",
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
          summary: "Live activity ticker (SSE)",
          responses: {
            "200": {
              description: "text/event-stream of TickerEvent",
              content: { "text/event-stream": {} },
            },
          },
        },
      },
      "/api/newsletter/subscribe": {
        post: {
          summary: "Subscribe an email to the digest",
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
            "200": { description: "Subscribed" },
            "400": { description: "Invalid email" },
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
