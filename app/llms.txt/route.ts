/**
 * llms.txt (README paso 3, formato llmstxt.org) — cómo un agente que NO habla
 * MCP descubre y compra en OpenTicket. Route handler (no archivo estático) para
 * que las URLs usen el host real de cada entorno (preview/prod), sin placeholder.
 */
export function GET(req: Request): Response {
  const origin = new URL(req.url).origin;
  const body = `# OpenTicket

> Ticketing agent-native: cada ticket es descubrible y comprable por un agente
> de IA. Pago con Stripe (checkout hospedado). "Your agent handles the checkout."

## Descubrimiento
- [Feed de eventos (JSON)](${origin}/api/events): eventos publicados + tipos de ticket con precio (unidades mínimas), moneda ISO 4217 y cupo disponible.
- [Ticker en vivo (SSE)](${origin}/api/ticker): stream de actividad pública, sin PII.
- [OpenAPI 3.1](${origin}/openapi.json): spec de los endpoints públicos.

## Compra vía MCP (recomendado)
- Servidor MCP (streamable HTTP): ${origin}/api/mcp
- Tools: search_events, get_ticket, buy_ticket, set_reminder.
- buy_ticket devuelve pending_payment + checkout_url (Stripe). Consultá el estado con get_order.
- Reintentá SIEMPRE con la misma idempotency_key (la generás vos, cliente).
- Errores estructurados: sold_out, mandate_exceeded, invalid_intent.

## Notas
- Respetá el spend_limit del usuario en buy_ticket.
- Los GET de descubrimiento no requieren auth. La compra puede requerir API key al abrir el feed público.
`;
  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=3600",
    },
  });
}
