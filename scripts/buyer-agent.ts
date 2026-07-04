/**
 * TestBuyerAgent (F1.5) — buyer-agent harness against the real MCP server.
 * The pitch scene: N agents fight for the last ticket, exactly 1 wins.
 *
 * Usage:
 *   pnpm agent:race                          # 3 agents vs the ticket with the lowest availability
 *   MCP_URL=https://…/api/mcp AGENTS=5 pnpm agent:race
 */
import "dotenv/config";

const MCP_URL = process.env.MCP_URL ?? "http://localhost:3111/api/mcp";
const AGENTS = Number(process.env.AGENTS ?? 3);
// buy_ticket requires an API key (README step 7). The seed creates this demo key.
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
  // streamable HTTP responds with SSE: the last `data:` line carries the result
  const data = body
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .pop();
  if (!data)
    throw new Error(`MCP response without data: ${body.slice(0, 200)}`);
  const parsed = JSON.parse(data.slice(5));
  if (parsed.error) throw new Error(`MCP error: ${parsed.error.message}`);
  return JSON.parse(parsed.result.content[0].text);
}

function log(agent: string, msg: string) {
  console.log(`[${agent}] ${msg}`);
}

async function main() {
  console.log(`── TestBuyerAgent · ${AGENTS} agents · ${MCP_URL} ──\n`);

  // 1. discover the ticket with the lowest availability (>0)
  const { events } = await callTool("search_events", {});
  const candidates = events
    .flatMap((e: any) => e.ticket_types.map((t: any) => ({ event: e, tt: t })))
    .filter((c: any) => c.tt.available > 0)
    .sort((a: any, b: any) => a.tt.available - b.tt.available);
  const target = candidates[0];
  if (!target) {
    console.error("no tickets available — run pnpm db:seed");
    process.exit(1);
  }
  console.log(
    `target: "${target.tt.name}" from "${target.event.title}" — ${target.tt.available} available\n`,
  );

  // 2. N agents buy IN PARALLEL with distinct keys (a real race)
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
        log(name, `✓ ${r.status} → order ${r.order_id}`);
        log(
          name,
          `  checkout: ${r.checkout_url ?? "(payment failed: check STRIPE_SECRET_KEY)"}`,
        );
        return { name, ok: true, orderId: r.order_id };
      } catch (err) {
        log(name, `✗ ${err instanceof Error ? err.message : err}`);
        return { name, ok: false, code: "error" };
      }
    }),
  );

  // 3. verdict
  const winners = race.filter((r) => r.ok);
  const losers = race.filter((r) => !r.ok);
  console.log(
    `\nresult: ${winners.length} reserved, ${losers.length} bounced [${losers.map((l) => l.code).join(", ")}]`,
  );
  if (target.tt.available === 1 && winners.length !== 1) {
    console.error(
      "FAIL: 1 spot was available but the winner count was not exactly 1",
    );
    process.exit(1);
  }
  console.log("OK: inventory held up under the agent race ✓");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
