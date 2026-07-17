#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
BACKEND_LOG="${TMP_DIR}/backend.log"
FRONTEND_LOG="${TMP_DIR}/frontend.log"
BACKEND_PID=""
FRONTEND_PID=""

BRAIN_HOST="${BRAIN_HOST:-127.0.0.1}"
BRAIN_PORT="${BRAIN_PORT:-5001}"
WEB_HOST="${WEB_HOST:-127.0.0.1}"
WEB_PORT="${WEB_PORT:-5173}"

cleanup() {
  local exit_code=$?
  if [[ -n "${FRONTEND_PID}" ]] && kill -0 "${FRONTEND_PID}" >/dev/null 2>&1; then
    kill "${FRONTEND_PID}" >/dev/null 2>&1 || true
    wait "${FRONTEND_PID}" 2>/dev/null || true
  fi
  if [[ -n "${BACKEND_PID}" ]] && kill -0 "${BACKEND_PID}" >/dev/null 2>&1; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
    wait "${BACKEND_PID}" 2>/dev/null || true
  fi
  if [[ ${exit_code} -ne 0 ]]; then
    echo
    echo "[smoke] backend log:"
    cat "${BACKEND_LOG}" || true
    echo
    echo "[smoke] frontend log:"
    cat "${FRONTEND_LOG}" || true
  fi
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT INT TERM

wait_http() {
  local url="$1"
  local label="$2"
  local timeout_seconds="${3:-120}"
  local started_at
  started_at="$(date +%s)"

  while true; do
    if curl --silent --show-error --output /dev/null --fail "${url}"; then
      return 0
    fi
    if (( "$(date +%s)" - started_at > timeout_seconds )); then
      echo "[smoke] timeout waiting for ${label}: ${url}" >&2
      return 1
    fi
    sleep 1
  done
}

assert_html_doc() {
  local file="$1"
  local label="$2"
  if ! grep -Eiq "<!doctype html>|<html" "${file}"; then
    echo "[smoke] ${label} does not look like an HTML entry document" >&2
    return 1
  fi
}

echo "[smoke] starting backend on ${BRAIN_HOST}:${BRAIN_PORT}"
(
  cd "${ROOT_DIR}/backend"
  EIGENT_BRAIN_HOST="${BRAIN_HOST}" \
  EIGENT_BRAIN_PORT="${BRAIN_PORT}" \
  EIGENT_DEBUG="false" \
  uv run python main.py >"${BACKEND_LOG}" 2>&1
) &
BACKEND_PID=$!

wait_http "http://${BRAIN_HOST}:${BRAIN_PORT}/health" "backend health"

echo "[smoke] checking session header + health detail"
curl --silent --show-error \
  --header "X-Channel: web" \
  --dump-header "${TMP_DIR}/health_headers.txt" \
  --output "${TMP_DIR}/health.json" \
  "http://${BRAIN_HOST}:${BRAIN_PORT}/health"

if ! grep -qi '^x-session-id:' "${TMP_DIR}/health_headers.txt"; then
  echo "[smoke] missing X-Session-ID header in /health response" >&2
  exit 1
fi

curl --silent --show-error \
  --header "X-Channel: web" \
  --output "${TMP_DIR}/health_detail.json" \
  "http://${BRAIN_HOST}:${BRAIN_PORT}/health?detail=true"

python3 - "${TMP_DIR}/health_detail.json" <<'PY'
import json
import sys
from pathlib import Path

payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
assert isinstance(payload, dict), "health detail payload must be object"
assert "capabilities" in payload, "health detail missing capabilities"
assert isinstance(payload["capabilities"], dict), "capabilities must be object"
PY

echo "[smoke] starting web frontend on ${WEB_HOST}:${WEB_PORT}"
(
  cd "${ROOT_DIR}"
  npm run dev:web -- --host "${WEB_HOST}" --port "${WEB_PORT}" >"${FRONTEND_LOG}" 2>&1
) &
FRONTEND_PID=$!

wait_http "http://${WEB_HOST}:${WEB_PORT}/" "frontend root"

curl --silent --show-error \
  --output "${TMP_DIR}/web_root.html" \
  "http://${WEB_HOST}:${WEB_PORT}/"
assert_html_doc "${TMP_DIR}/web_root.html" "web root"

status_code="$(curl --silent --show-error \
  --output "${TMP_DIR}/web_route.html" \
  --write-out "%{http_code}" \
  "http://${WEB_HOST}:${WEB_PORT}/project/smoke-route")"
if [[ "${status_code}" != "200" ]]; then
  echo "[smoke] browser-router route fallback failed: status=${status_code}" >&2
  exit 1
fi
assert_html_doc "${TMP_DIR}/web_route.html" "web route fallback"

echo "[smoke] PASS: web + local brain smoke checks completed"
