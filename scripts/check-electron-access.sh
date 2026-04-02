#!/usr/bin/env bash

set -euo pipefail

# Guardrail for web separation:
# only src/host/createHost.ts may read window.electronAPI/window.ipcRenderer.
violations="$(
  rg -n \
    -e 'window\.electronAPI' \
    -e 'window\.ipcRenderer' \
    --glob '*.{ts,tsx,js,jsx}' \
    --glob '!src/host/createHost.ts' \
    src || true
)"

if [[ -n "${violations}" ]]; then
  echo "Found forbidden direct Electron window access outside Host bridge:"
  echo "${violations}"
  exit 1
fi

echo "Electron window access guard passed."
