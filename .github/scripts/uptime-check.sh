#!/usr/bin/env bash
# Asks the health address up to TRIES times, WAIT seconds apart. Succeeds only on HTTP 200.
# Writes ok=true|false and code=<http status, or 000 for no answer> to $GITHUB_OUTPUT. Never fails the job itself:
# the next step decides what to do, so a down site raises an alarm instead of a red cross nobody reads.
set -u
url="${HEALTH_URL:?HEALTH_URL is required}"
tries="${TRIES:-3}"
wait_s="${WAIT:-20}"
body="$(mktemp)"
code=000
for i in $(seq 1 "$tries"); do
  code="$(curl -s -o "$body" -w '%{http_code}' --max-time 15 "$url" || true)"
  [ -n "$code" ] || code=000
  [ "$code" = "200" ] && break
  [ "$i" -lt "$tries" ] && sleep "$wait_s"
done
ok=false
[ "$code" = "200" ] && ok=true
{ echo "ok=$ok"; echo "code=$code"; } >> "${GITHUB_OUTPUT:-/dev/stdout}"
echo "checked $url -> $code (ok=$ok)"
