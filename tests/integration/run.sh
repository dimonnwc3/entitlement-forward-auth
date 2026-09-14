#!/usr/bin/env bash
# Integration tests: forward-auth behind nginx / traefik / caddy.
# Route matrix mirrors the host-scoped routes in config.yaml.
# Usage: tests/integration/run.sh [--mock] [--keep]
set -euo pipefail

cd "$(dirname "$0")"

set -a
source ../../.env
set +a

APP="${TEST_AUTH_APP:?TEST_AUTH_APP not set in .env}"
USER="${TEST_AUTH_USER:?TEST_AUTH_USER not set in .env}"

# identity header names come from config (authHeaders may override defaults)
AUTH_USER_HEADER=$(bun -e '
import { YAML } from "bun";
const c = YAML.parse(await Bun.file("../../config.yaml").text()) ?? {};
console.log(c.authHeaders?.user ?? "X-Auth-User");
')

PROXIES=(
  "nginx:8081"
  "traefik:8082"
  "caddy:8083"
)

# name|host|path — must mirror routes in config.yaml
ROUTES=(
  "backend1|backend1.example.com|/forms/render/html"
  "backend2-v1|backend2.example.com|/v1/process/source"
  "backend2-v1alpha|backend2.example.com|/v1alpha/process/source"
  "backend3|backend3.example.com|/v1/complete"
)

KEEP=0
MOCK=0
for arg in "$@"; do
  case $arg in
    --keep) KEEP=1 ;;
    --mock) MOCK=1 ;;
  esac
done

COMPOSE_FILES=(-f docker-compose.yml)
if [[ $MOCK -eq 1 ]]; then
  COMPOSE_FILES+=(-f docker-compose.mock.yml)
fi

PASS=0
FAIL=0

check() {
  local name=$1 expected=$2 actual=$3
  if [[ "$actual" == "$expected" ]]; then
    echo "PASS  $name"
    PASS=$((PASS + 1))
  else
    echo "FAIL  $name: expected [$expected], got [$actual]"
    FAIL=$((FAIL + 1))
  fi
}

cleanup() {
  if [[ $KEEP -eq 0 ]]; then
    docker compose "${COMPOSE_FILES[@]}" down --remove-orphans --volumes >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "== starting stack =="
docker compose "${COMPOSE_FILES[@]}" up -d --build --quiet-pull >/dev/null
docker compose "${COMPOSE_FILES[@]}" up -d --wait >/dev/null 2>&1 || true

# wait for auth + proxies to answer
for i in $(seq 1 60); do
  ok=1
  for entry in "${PROXIES[@]}"; do
    port=${entry#*:}
    curl -s -o /dev/null --max-time 2 "http://localhost:$port/" || ok=0
  done
  [[ $ok -eq 1 ]] && break
  sleep 1
done

for entry in "${PROXIES[@]}"; do
  proxy=${entry%%:*}
  port=${entry#*:}
  base="http://localhost:$port"
  echo
  echo "== $proxy (:$port) =="

  for rentry in "${ROUTES[@]}"; do
    IFS='|' read -r rname rhost rpath <<<"$rentry"

    code=$(curl -s -o /dev/null -w '%{http_code}' \
      -H "Host: $rhost" "$base$rpath")
    check "$proxy/$rname: no auth headers -> 401" 401 "$code"

    code=$(curl -s -o /dev/null -w '%{http_code}' \
      -H "Host: $rhost" -H "X-Auth-App: $APP" -H "$AUTH_USER_HEADER:$USER" "$base$rpath")
    check "$proxy/$rname: valid credentials -> 200" 200 "$code"
  done

  # full checks on backend1 (only route without injected upstream headers,
  # so whoami output is safe to print)
  IFS='|' read -r gname ghost gpath <<<"${ROUTES[0]}"

  code=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Host: $ghost" -H "X-Auth-App: nosuchapp" -H "$AUTH_USER_HEADER:$USER" "$base$gpath")
  check "$proxy: unknown app -> 401" 401 "$code"

  code=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Host: $ghost" -H "X-Auth-App: $APP" -H "$AUTH_USER_HEADER:nosuchuser" "$base$gpath")
  check "$proxy: unknown user -> 403 (not entitled)" 403 "$code"

  code=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Host: $ghost" -H "$AUTH_USER_HEADER:$USER" "$base$gpath")
  check "$proxy: missing app header -> defaultApp -> 200" 200 "$code"

  body=$(curl -s -w '\n%{http_code}' \
    -H "Host: $ghost" -H "X-Auth-App: $APP" -H "$AUTH_USER_HEADER:$USER" "$base$gpath")
  code=${body##*$'\n'}
  body=${body%$'\n'*}
  check "$proxy: identity headers injected into backend request" 200 "$code"
  if grep -q "X-Forwarded-App: $APP" <<<"$body" &&
    grep -q "X-Forwarded-User: $USER" <<<"$body"; then
    echo "PASS  $proxy: identity headers present in backend request"
    PASS=$((PASS + 1))
  else
    echo "FAIL  $proxy: identity headers missing in backend request"
    echo "$body" | grep -i "x-forwarded" || echo "(no X-Forwarded-* headers in whoami output)"
    FAIL=$((FAIL + 1))
  fi

  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    -H "Host: $ghost" -H "X-Auth-App: $APP" -H "$AUTH_USER_HEADER:$USER" \
    -H 'Content-Type: application/json' -d '{"a":1}' "$base$gpath?x=1")
  check "$proxy: POST with body+query -> 200" 200 "$code"

  body=$(curl -s -H "Host: $ghost" -H "X-Auth-App: $APP" -H "$AUTH_USER_HEADER:$USER" "$base$gpath?q=1")
  if grep -Eq "GET $gpath\?q=1 " <<<"$body"; then
    echo "PASS  $proxy: method+path+query preserved"
    PASS=$((PASS + 1))
  else
    echo "FAIL  $proxy: method+path+query not preserved"
    echo "$body" | head -5
    FAIL=$((FAIL + 1))
  fi

  # client-spoofed X-Forwarded-* must be overwritten by proxy:
  # if forwarded as-is, host "spoofed.invalid" matches no route -> 401
  code=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Host: $ghost" -H "X-Auth-App: $APP" -H "$AUTH_USER_HEADER:$USER" \
    -H 'X-Forwarded-Method: GET' -H 'X-Forwarded-Uri: /' -H 'X-Forwarded-Host: spoofed.invalid' \
    "$base$gpath")
  check "$proxy: spoofed X-Forwarded-* overwritten -> 200" 200 "$code"

  # host with no configured route answers 401 like every other rejection:
  # nginx auth_request turns any status besides 200/401/403 into an
  # unexpected 500, so the auth endpoint only speaks those three
  code=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Host: unrouted.example.com" -H "X-Auth-App: $APP" -H "$AUTH_USER_HEADER:$USER" "$base/x")
  check "$proxy: no matching route -> 401" 401 "$code"

  if [[ $MOCK -eq 1 ]]; then
    code=$(curl -s -o /dev/null -w '%{http_code}' \
      -H "Host: $ghost" -H "X-Auth-App: $APP" -H "$AUTH_USER_HEADER:rcoutage" "$base$gpath")
    check "$proxy: RC 5xx fails open -> 200" 200 "$code"

    code=$(curl -s -o /dev/null -w '%{http_code}' \
      -H "Host: $ghost" -H "X-Auth-App: $APP" -H "$AUTH_USER_HEADER:rclimited" "$base$gpath")
    check "$proxy: RC 429 fails open -> 200" 200 "$code"

    code=$(curl -s -o /dev/null -w '%{http_code}' \
      -H "Host: $ghost" -H "X-Auth-App: $APP" -H "$AUTH_USER_HEADER:rcbadkey" "$base$gpath")
    check "$proxy: RC 4xx fails closed -> 500" 500 "$code"
  fi
done

echo
echo "== result: $PASS passed, $FAIL failed =="
[[ $FAIL -eq 0 ]]
