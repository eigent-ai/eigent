#!/usr/bin/env bash

set -euo pipefail

# Guardrail for web separation:
# only src/host/createHost.ts may read window.electronAPI/window.ipcRenderer.
if command -v rg >/dev/null 2>&1; then
  set +e
  violations="$(
    rg -n \
      -e 'window\s*(\?\.)?\s*\.\s*(electronAPI|ipcRenderer)' \
      -e '\(window\s+as\s+any\)\s*\.\s*(electronAPI|ipcRenderer)' \
      -e 'window\s*\[\s*["'\''](electronAPI|ipcRenderer)["'\'']\s*\]' \
      --glob '*.{ts,tsx,js,jsx}' \
      --glob '!src/host/createHost.ts' \
      src
  )"
  search_status=$?
  set -e
  if ((search_status > 1)); then
    echo "Electron window access guard failed to scan source files." >&2
    exit "${search_status}"
  fi
else
  if [[ ! -d src ]] || ! command -v find >/dev/null 2>&1 || ! command -v grep >/dev/null 2>&1; then
    echo "Electron window access guard is missing its source tree or search tools." >&2
    exit 2
  fi
  set +e
  violations="$(
    find src -type f \
      \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' \) \
      ! -path 'src/host/createHost.ts' \
      -exec grep -HnE \
        -e 'window[[:space:]]*(\?\.)?[[:space:]]*\.[[:space:]]*(electronAPI|ipcRenderer)' \
        -e '\(window[[:space:]]+as[[:space:]]+any\)[[:space:]]*\.[[:space:]]*(electronAPI|ipcRenderer)' \
        -e "window[[:space:]]*\[[[:space:]]*['\"](electronAPI|ipcRenderer)['\"][[:space:]]*\]" \
        {} +
  )"
  search_status=$?
  set -e
  if ((search_status > 1)); then
    echo "Electron window access guard failed to scan source files." >&2
    exit "${search_status}"
  fi
fi

if [[ -n "${violations}" ]]; then
  echo "Found forbidden direct Electron window access outside Host bridge:"
  echo "${violations}"
  exit 1
fi

echo "Electron window access guard passed."
