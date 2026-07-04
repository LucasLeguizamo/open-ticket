#!/usr/bin/env bash
# Harness de automejora — una pasada que verifica TODO el flujo del repo.
# Uso: pnpm harness   (ciclo: correr → arreglar FAILs → repetir hasta verde)
#
# Estados:
#   PASS    ok
#   FAIL    código roto → arreglar y re-correr (exit 1)
#   BLOCKED falta config/credencial externa (lista al final; no es bug)
#
# ponytail: bash+curl, sin framework. El server se levanta desde .next-build
# (nunca toca el .next del dev activo — ver memoria 2026-07-02).
set -u
cd "$(dirname "$0")/.."

PORT="${HARNESS_PORT:-3210}"
BASE="http://localhost:$PORT"
BODY="$(mktemp)"
SERVER_PID=""
RESULTS=()
FAILS=0
BLOCKED=()

report() { # status name [nota]
  RESULTS+=("$(printf '%-8s %-24s %s' "$1" "$2" "${3:-}")")
  [ "$1" = "FAIL" ] && FAILS=$((FAILS + 1))
  [ "$1" = "BLOCKED" ] && BLOCKED+=("$2 — ${3:-}")
  return 0
}

stage() { # name cmd...
  local name=$1; shift
  echo "▸ $name"
  local out
  if out=$("$@" 2>&1); then
    report PASS "$name"
  else
    report FAIL "$name" "$(echo "$out" | tail -4 | tr '\n' ' · ')"
  fi
}

expect() { # name want_code needle curl_args...
  local name=$1 want=$2 needle=$3; shift 3
  local code
  code=$(curl -s -o "$BODY" -w '%{http_code}' --max-time 20 "$@")
  if [ "$code" != "$want" ]; then
    report FAIL "$name" "HTTP $code (esperaba $want)"
  elif [ -n "$needle" ] && ! grep -q "$needle" "$BODY"; then
    report FAIL "$name" "respuesta sin '$needle'"
  else
    report PASS "$name"
  fi
}

cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
  rm -f "$BODY"
}
trap cleanup EXIT

echo "── OpenTicket harness · $(date '+%Y-%m-%d %H:%M') ──"

# 0. Credenciales externas (lo que depende de Lucas, no del código)
STRIPE_KEY=$(grep '^STRIPE_SECRET_KEY=' .env | cut -d= -f2-)
if [ -z "$STRIPE_KEY" ] || [ "$STRIPE_KEY" = "sk_test_xxx" ]; then
  report BLOCKED "env:stripe" "STRIPE_SECRET_KEY placeholder en .env"
elif curl -s -o /dev/null -w '%{http_code}' --max-time 10 -u "$STRIPE_KEY:" https://api.stripe.com/v1/balance | grep -q 200; then
  report PASS "env:stripe"
else
  report BLOCKED "env:stripe" "la clave Stripe no autentica contra la API (pagos darán payment_failed)"
fi
grep -q '^RESEND_API_KEY=..*' .env \
  && report PASS "env:resend" \
  || report BLOCKED "env:resend" "RESEND_API_KEY vacía — emails van a consola (no bloquea demo)"

# 1-4. Calidad de código
stage "lint" pnpm lint
stage "test:unit" pnpm test
if pg_isready -h localhost -q 2>/dev/null; then
  stage "test:integration" pnpm test:integration
else
  report BLOCKED "test:integration" "Postgres local apagado (brew services start postgresql@16)"
fi
stage "build" pnpm build:check

# 5. Server real desde .next-build
echo "▸ server ($BASE)"
NEXT_DIST_DIR=.next-build ./node_modules/.bin/next start -p "$PORT" >/dev/null 2>&1 &
SERVER_PID=$!
up=""
for _ in $(seq 1 30); do
  curl -s -o /dev/null --max-time 2 "$BASE" && { up=1; break; }
  sleep 1
done

if [ -z "$up" ]; then
  report FAIL "server" "no levantó en ${PORT} tras 30s"
else
  report PASS "server"
  # 6. Superficie agent-native (README pasos 1-4, 6, 7)
  expect "GET /" 200 "" "$BASE/"
  expect "GET /agents" 200 "" "$BASE/agents"
  expect "GET /api/events" 200 '"events"' "$BASE/api/events"
  expect "GET /llms.txt" 200 "" "$BASE/llms.txt"
  expect "GET /openapi.json" 200 '"openapi"' "$BASE/openapi.json"
  expect "GET /api/ticker" 200 "" "$BASE/api/ticker"
  expect "subscribe válido" 200 "subscribed" -X POST -H 'content-type: application/json' \
    -d '{"email":"harness@openticket.test"}' "$BASE/api/newsletter/subscribe"
  expect "subscribe basura" 400 "" -X POST -H 'content-type: application/json' \
    -d '{"email":"nope"}' "$BASE/api/newsletter/subscribe"
  MCP_HDR=(-H 'content-type: application/json' -H 'accept: application/json, text/event-stream')
  expect "mcp tools/list" 200 "buy_ticket" -X POST "${MCP_HDR[@]}" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "$BASE/api/mcp"
  expect "mcp buy sin key" 200 "unauthorized" -X POST "${MCP_HDR[@]}" \
    -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"buy_ticket","arguments":{"event_id":"evt_x","ticket_type_id":"tt_x","quantity":1,"buyer_email":"a@t.co","idempotency_key":"harness-noauth","spend_limit":{"amount_minor":1,"currency":"COP"}}}}' \
    "$BASE/api/mcp"

  # 7. Carrera de agentes (F1.5) contra el server del harness
  echo "▸ agent:race"
  RACE_OUT=$(MCP_URL="$BASE/api/mcp" AGENTS=3 pnpm agent:race 2>&1)
  RACE_CODE=$?
  if echo "$RACE_OUT" | grep -q "payment_failed"; then
    report BLOCKED "agent:race" "compra rebota en payment_failed → falta clave Stripe funcional"
  elif [ $RACE_CODE -eq 0 ]; then
    report PASS "agent:race"
  else
    report FAIL "agent:race" "$(echo "$RACE_OUT" | tail -3 | tr '\n' ' · ')"
  fi
fi

# ── Scoreboard ──
echo
echo "── resultado ──"
printf '%s\n' "${RESULTS[@]}"
if [ ${#BLOCKED[@]} -gt 0 ]; then
  echo
  echo "── pendiente de tu parte (no es bug) ──"
  printf '  · %s\n' "${BLOCKED[@]}"
fi
echo
if [ $FAILS -gt 0 ]; then
  echo "✗ $FAILS FAIL — arreglar y volver a correr: pnpm harness"
  exit 1
fi
echo "✓ todo verde (fuera de lo BLOCKED)"
