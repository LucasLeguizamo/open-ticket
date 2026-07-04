/**
 * TestBuyerAgent (F1.5) — harness agente-comprador contra el MCP server real.
 * Escena del pitch: N agentes pelean el último ticket, exactamente 1 gana.
 *
 * Uso:
 *   pnpm agent:race                          # 3 agentes vs el ticket con menos cupo
 *   MCP_URL=https://…/api/mcp AGENTS=5 pnpm agent:race
 */
import "dotenv/config";

const MCP_URL = process.env.MCP_URL ?? "http://localhost:3111/api/mcp";
const AGENTS = Number(process.env.AGENTS ?? 3);
// buy_ticket exige API key (README paso 7). El seed crea esta demo key.
const API_KEY =
  process.env.OPENTICKET_API_KEY ?? "ot_live_demo_key_solo_para_test";

let rpcId = 0;
async function callTool(name: string, args: unknown): Promise<any> {
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++rpcId,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const body = await res.text();
  // streamable HTTP responde SSE: la última línea `data:` trae el resultado
  const data = body
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .pop();
  if (!data) throw new Error(`respuesta MCP sin data: ${body.slice(0, 200)}`);
  const parsed = JSON.parse(data.slice(5));
  if (parsed.error) throw new Error(`MCP error: ${parsed.error.message}`);
  return JSON.parse(parsed.result.content[0].text);
}

function log(agent: string, msg: string) {
  console.log(`[${agent}] ${msg}`);
}

async function main() {
  console.log(`── TestBuyerAgent · ${AGENTS} agentes · ${MCP_URL} ──\n`);

  // 1. descubrir el ticket con menos cupo disponible (>0)
  const { events } = await callTool("search_events", {});
  const candidates = events
    .flatMap((e: any) => e.ticket_types.map((t: any) => ({ event: e, tt: t })))
    .filter((c: any) => c.tt.available > 0)
    .sort((a: any, b: any) => a.tt.available - b.tt.available);
  const target = candidates[0];
  if (!target) {
    console.error("no hay tickets disponibles — corre pnpm db:seed");
    process.exit(1);
  }
  console.log(
    `objetivo: "${target.tt.name}" de "${target.event.title}" — ${target.tt.available} disponible(s)\n`,
  );

  // 2. N agentes compran EN PARALELO con keys distintas (carrera real)
  const race = await Promise.all(
    Array.from({ length: AGENTS }, async (_, i) => {
      const name = `aria-${i + 1}`;
      try {
        const r = await callTool("buy_ticket", {
          event_id: target.event.id,
          ticket_type_id: target.tt.id,
          quantity: 1,
          buyer_email: `${name}@agents.test`,
          idempotency_key: `race-${Date.now()}-${name}`,
          spend_limit: {
            amount_minor: target.tt.price_minor * 2,
            currency: target.tt.currency,
          },
        });
        if (r.error) {
          log(name, `✗ ${r.error.code}`);
          return { name, ok: false, code: r.error.code };
        }
        log(name, `✓ ${r.status} → orden ${r.order_id}`);
        log(
          name,
          `  checkout: ${r.checkout_url ?? "(pago falló: revisa STRIPE_SECRET_KEY)"}`,
        );
        return { name, ok: true, orderId: r.order_id };
      } catch (err) {
        log(name, `✗ ${err instanceof Error ? err.message : err}`);
        return { name, ok: false, code: "error" };
      }
    }),
  );

  // 3. veredicto
  const winners = race.filter((r) => r.ok);
  const losers = race.filter((r) => !r.ok);
  console.log(
    `\nresultado: ${winners.length} reserva(s), ${losers.length} rebotado(s) [${losers.map((l) => l.code).join(", ")}]`,
  );
  if (target.tt.available === 1 && winners.length !== 1) {
    console.error("FAIL: había 1 cupo y no ganó exactamente 1 agente");
    process.exit(1);
  }
  console.log("OK: inventario respetado bajo carrera de agentes ✓");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
