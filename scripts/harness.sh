#!/usr/bin/env bash
# Self-improvement harness — one pass that verifies the ENTIRE repo flow.
# Usage: pnpm harness   (loop: run → fix FAILs → repeat until green)
#
# Statuses:
#   PASS    ok
#   FAIL    broken code → fix and re-run (exit 1)
#   BLOCKED missing external config/credential (listed at the end; not a bug)
#
# ponytail: bash+curl, no framework. The server boots from .next-build
# (never touches the .next of an active dev server — see memory 2026-07-02).
set -u
cd "$(dirname "$0")/.."

PORT="${HARNESS_PORT:-3210}"
BASE="http://localhost:$PORT"
BODY="$(mktemp)"
SERVER_PID=""
RESULTS=()
FAILS=0
BLOCKED=()

report() { # status name [note]
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
    report FAIL "$name" "HTTP $code (expected $want)"
  elif [ -n "$needle" ] && ! grep -q "$needle" "$BODY"; then
    report FAIL "$name" "response missing '$needle'"
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

# 0. External credentials (things that depend on Lucas, not on the code)
STRIPE_KEY=$(grep '^STRIPE_SECRET_KEY=' .env | cut -d= -f2-)
if [ -z "$STRIPE_KEY" ] || [ "$STRIPE_KEY" = "sk_test_xxx" ]; then
  report BLOCKED "env:stripe" "STRIPE_SECRET_KEY is a placeholder in .env"
elif curl -s -o /dev/null -w '%{http_code}' --max-time 10 -u "$STRIPE_KEY:" https://api.stripe.com/v1/balance | grep -q 200; then
  report PASS "env:stripe"
else
  report BLOCKED "env:stripe" "Stripe key does not authenticate against the API (payments will return payment_failed)"
fi
grep -q '^RESEND_API_KEY=..*' .env \
  && report PASS "env:resend" \
  || report BLOCKED "env:resend" "RESEND_API_KEY is empty — emails go to the console (does not block the demo)"

# 1-4. Code quality
stage "lint" pnpm lint
stage "test:unit" pnpm test
if pg_isready -h localhost -q 2>/dev/null; then
  stage "test:integration" pnpm test:integration
else
  report BLOCKED "test:integration" "local Postgres is down (brew services start postgresql@16)"
fi
stage "build" pnpm build:check

# 5. Real server from .next-build
echo "▸ server ($BASE)"
NEXT_DIST_DIR=.next-build ./node_modules/.bin/next start -p "$PORT" >/dev/null 2>&1 &
SERVER_PID=$!
up=""
for _ in $(seq 1 30); do
  curl -s -o /dev/null --max-time 2 "$BASE" && { up=1; break; }
  sleep 1
done

if [ -z "$up" ]; then
  report FAIL "server" "did not come up on ${PORT} after 30s"
else
  report PASS "server"
  # 6. Agent-native surface (README steps 1-4, 6, 7)
  expect "GET /" 200 "" "$BASE/"
  expect "GET /agents" 200 "" "$BASE/agents"
  expect "GET /api/events" 200 '"events"' "$BASE/api/events"
  expect "GET /llms.txt" 200 "" "$BASE/llms.txt"
  expect "GET /openapi.json" 200 '"openapi"' "$BASE/openapi.json"
  expect "GET /api/ticker" 200 "" "$BASE/api/ticker"
  expect "subscribe valid" 200 "subscribed" -X POST -H 'content-type: application/json' \
    -d '{"email":"harness@openticket.test"}' "$BASE/api/newsletter/subscribe"
  expect "subscribe garbage" 400 "" -X POST -H 'content-type: application/json' \
    -d '{"email":"nope"}' "$BASE/api/newsletter/subscribe"
  MCP_HDR=(-H 'content-type: application/json' -H 'accept: application/json, text/event-stream')
  expect "mcp tools/list" 200 "buy_ticket" -X POST "${MCP_HDR[@]}" \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "$BASE/api/mcp"
  expect "mcp buy without key" 200 "unauthorized" -X POST "${MCP_HDR[@]}" \
    -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"buy_ticket","arguments":{"event_id":"evt_x","ticket_type_id":"tt_x","quantity":1,"buyer_email":"a@t.co","idempotency_key":"harness-noauth","spend_limit":{"amount_minor":1,"currency":"COP"}}}}' \
    "$BASE/api/mcp"

  # 6a. otick CLI (A6/A7) — dogfoods the public surface from the sibling repo.
  # Deterministic: `otick events --json` hits GET /api/events (no auth, no Stripe)
  # against this same harness server, expecting exit 0 + an "events" array. Runs
  # ONLY when the CLI binary is built at ../otick; otherwise BLOCKED (a missing
  # sibling checkout is not a bug in THIS repo). The CLI is pointed at $BASE via
  # OPENTICKET_BASE_URL (env override; see otick src/config.ts).
  OTICK_BIN="../otick/dist/bin.js"
  if [ -f "$OTICK_BIN" ]; then
    echo "▸ cli:otick events"
    if OTICK_OUT=$(OPENTICKET_BASE_URL="$BASE" node "$OTICK_BIN" events --json 2>&1) \
       && echo "$OTICK_OUT" | grep -q '"events"'; then
      report PASS "cli:otick"
    else
      report FAIL "cli:otick" "$(echo "$OTICK_OUT" | tail -3 | tr '\n' ' · ')"
    fi
  else
    report BLOCKED "cli:otick" "sibling CLI not built — run \`npm run build\` in ../otick to enable this check"
  fi

  # 6b. URL import (F6/E3) — PROPOSED, not wired.
  # The deterministic import path is fully covered by `pnpm test` above
  # (test/unit/import-{extract,fetch,fixtures,orchestrator}.test.ts), so the
  # harness already guards it via the unit stage. A LIVE end-to-end check would
  # need three things this harness can't give deterministically:
  #   1. the organizer server action /organizer/import is auth-gated
  #      (requireOrganizer) — no session cookie in a curl-only harness;
  #   2. a real reachable external URL emitting schema.org/Event JSON-LD —
  #      network-dependent, would flake CI when the third party is down;
  #   3. safeFetchHtml refuses loopback, so we can't self-host the fixture and
  #      point the import at it (that's the SSRF guard working as intended).
  # When F3's preview + a test-organizer session land, wire it as e.g.:
  #   expect "import luma draft" 200 '"coverage"' -X POST "${ORG_HDR[@]}" \
  #     -d '{"url":"https://lu.ma/<known-fixture-event>"}' "$BASE/organizer/import"
  # Until then: leave OUT of the live run rather than add a flaky check.

  # 7. Agent race (F1.5) against the harness server
  echo "▸ agent:race"
  RACE_OUT=$(MCP_URL="$BASE/api/mcp" AGENTS=3 pnpm agent:race 2>&1)
  RACE_CODE=$?
  if echo "$RACE_OUT" | grep -q "payment_failed"; then
    report BLOCKED "agent:race" "purchase bounces with payment_failed → a working Stripe key is missing"
  elif [ $RACE_CODE -eq 0 ]; then
    report PASS "agent:race"
  else
    report FAIL "agent:race" "$(echo "$RACE_OUT" | tail -3 | tr '\n' ' · ')"
  fi
fi

# ── Scoreboard ──
echo
echo "── results ──"
printf '%s\n' "${RESULTS[@]}"
if [ ${#BLOCKED[@]} -gt 0 ]; then
  echo
  echo "── waiting on you (not a bug) ──"
  printf '  · %s\n' "${BLOCKED[@]}"
fi
echo
if [ $FAILS -gt 0 ]; then
  echo "✗ $FAILS FAIL — fix and run again: pnpm harness"
  exit 1
fi
echo "✓ all green (aside from BLOCKED)"
