#!/usr/bin/env bash

set -euo pipefail

# Guardrail for web separation:
# only src/host/createHost.ts may read window.electronAPI/window.ipcRenderer.
violations="$(
  rg -n \
    -e 'window\s*(\?\.)?\s*\.\s*(electronAPI|ipcRenderer)' \
    -e '\(window\s+as\s+any\)\s*\.\s*(electronAPI|ipcRenderer)' \
    -e 'window\s*\[\s*["'\''](electronAPI|ipcRenderer)["'\'']\s*\]' \
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
