#!/usr/bin/env bash
# One command to put the receptionist on the internet for a live test call.
#
#   scripts/test-call.sh           start tunnel + server, print the Telnyx URLs, stay up until Ctrl-C
#   scripts/test-call.sh --check   same, but verify the public URL answers and then shut down
#
# Uses a Cloudflare quick tunnel (no account, no DNS change, address changes every run), so it is for
# testing only. For a permanent number use a named tunnel on an owned domain (see HOSTING.md).
# Secrets stay in .env; this script never prints their values.
set -euo pipefail
cd "$(dirname "$0")/.."

CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1
PORT="$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2 || true)"
PORT="${PORT:-8789}"
LOG_DIR="$(mktemp -d)"

fail() { echo "ERROR: $*" >&2; exit 1; }

command -v node >/dev/null || fail "node is not installed (need >= 22.13)."
command -v cloudflared >/dev/null || fail "cloudflared is not installed. Get the .deb from github.com/cloudflare/cloudflared/releases."
[ -f .env ] || fail "No .env here. Run: cp .env.example .env  and fill TEXML_WEBHOOK_TOKEN."
[ -d node_modules ] || npm ci --no-audit --no-fund >/dev/null
ls tenants/*.json >/dev/null 2>&1 || fail "No business profile in tenants/. Copy tenants.example/coastal-hvac.json and edit it."

TOKEN="$(grep -E '^TEXML_WEBHOOK_TOKEN=' .env | cut -d= -f2)"
[ -n "$TOKEN" ] && [ "$TOKEN" != "GENERATE-A-LONG-RANDOM-SECRET" ] || fail "TEXML_WEBHOOK_TOKEN in .env is not set."

cleanup() {
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true
  [ -n "${TUNNEL_PID:-}" ] && kill "$TUNNEL_PID" 2>/dev/null || true
  rm -rf "$LOG_DIR"
}
trap cleanup EXIT INT TERM

echo "Opening tunnel..."
cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" >"$LOG_DIR/tunnel.log" 2>&1 &
TUNNEL_PID=$!
HOST=""
for _ in $(seq 1 60); do
  HOST="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG_DIR/tunnel.log" | head -1 | sed 's|https://||' || true)"
  [ -n "$HOST" ] && break
  kill -0 "$TUNNEL_PID" 2>/dev/null || { tail -5 "$LOG_DIR/tunnel.log" >&2; fail "The tunnel exited. Check the network."; }
  read -r -t 1 _ </dev/null || true
done
[ -n "$HOST" ] || { tail -5 "$LOG_DIR/tunnel.log" >&2; fail "No tunnel address after 60 seconds."; }

# The server reads its public address from the environment; these override .env for this run only.
PUBLIC_BASE_URL="https://$HOST" PUBLIC_WS_URL="wss://$HOST/conversation-relay" \
  node --env-file-if-exists=.env src/server.js >"$LOG_DIR/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 30); do
  curl -fsS -m 2 "http://127.0.0.1:$PORT/health" >"$LOG_DIR/health.json" 2>/dev/null && break
  kill -0 "$SERVER_PID" 2>/dev/null || { tail -8 "$LOG_DIR/server.log" >&2; fail "The server exited on start."; }
  read -r -t 1 _ </dev/null || true
done
[ -s "$LOG_DIR/health.json" ] || fail "The server did not answer on port $PORT."

PUBLIC_OK="no"
for _ in $(seq 1 30); do
  if curl -fsS -m 5 "https://$HOST/health" >/dev/null 2>&1; then PUBLIC_OK="yes"; break; fi
  read -r -t 2 _ </dev/null || true
done
VOICE_CODE="$(curl -s -m 8 -o "$LOG_DIR/texml.xml" -w '%{http_code}' -X POST "https://$HOST/texml/voice?token=$TOKEN" || true)"
NOTOKEN_CODE="$(curl -s -m 8 -o /dev/null -w '%{http_code}' -X POST "https://$HOST/texml/voice" || true)"

set_or_missing() { grep -qE "^$1=.+" .env && echo "set" || echo "MISSING"; }

echo
echo "=== Receptionist is up ==="
echo "Health (local):        $(cat "$LOG_DIR/health.json")"
echo "Reachable from internet: $PUBLIC_OK"
echo "Voice webhook answers: HTTP $VOICE_CODE with token, HTTP $NOTOKEN_CODE without (expect 200 and 401/403)"
grep -q '<ConversationRelay' "$LOG_DIR/texml.xml" 2>/dev/null && echo "TeXML:                 contains ConversationRelay pointing at wss://$HOST/conversation-relay"
echo
echo "=== Paste these into Telnyx (Mission Control) ==="
echo "TeXML application > Voice URL (POST):"
echo "  https://$HOST/texml/voice?token=<TEXML_WEBHOOK_TOKEN from .env>"
echo "Messaging profile > Inbound webhook:"
echo "  https://$HOST/sms/inbound"
echo
echo "=== Keys in .env ==="
echo "ANTHROPIC_API_KEY:   $(set_or_missing ANTHROPIC_API_KEY)   (without it the local Ollama model answers, too slow for a phone call)"
echo "TELNYX_API_KEY:      $(set_or_missing TELNYX_API_KEY)   (only needed to SEND texts; calls work without it)"
echo "TELNYX_PUBLIC_KEY:   $(set_or_missing TELNYX_PUBLIC_KEY)   (signature check on inbound texts)"
echo "Tenant numbers:      $(grep -ho '"phoneNumbers"[^]]*]' tenants/*.json | tr -d '\n')"
echo "  -> put your real Telnyx number in tenants/<business>.json \"phoneNumbers\" so calls route to that business."
echo
if [ "$CHECK_ONLY" = 1 ]; then
  [ "$PUBLIC_OK" = "yes" ] && [ "$VOICE_CODE" = "200" ] || fail "Public check failed."
  echo "Check passed. Shutting down."
  exit 0
fi
echo "Leave this window open and call the number. Ctrl-C stops the tunnel and the server."
echo "After the call: npm run costs   (Claude spend)   and   curl -H \"Authorization: Bearer <OPERATOR_TOKEN>\" http://127.0.0.1:$PORT/operator/leads"
wait "$SERVER_PID"
