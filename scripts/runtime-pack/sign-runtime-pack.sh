#!/usr/bin/env bash
# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
# ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

# Sign every Mach-O file in a staged runtime pack with a Developer ID identity,
# the hardened runtime and a secure timestamp. Executables get the same
# entitlements the app gives its child processes (entitlementsInherit in
# electron-builder.json); libraries get none. Then verify every signature.
#
# usage: sign-runtime-pack.sh <pack-dir> <identity-sha1> <entitlements.plist> [keychain]
# env:   SIGN_JOBS (default 4) parallel codesign processes

set -euo pipefail

PACK="${1:?usage: sign-runtime-pack.sh <pack-dir> <identity> <entitlements> [keychain]}"
IDENTITY="${2:?missing signing identity}"
ENTITLEMENTS="${3:?missing entitlements plist}"
KEYCHAIN="${4:-}"
JOBS="${SIGN_JOBS:-4}"
HERE="$(cd "$(dirname "$0")" && pwd)"

LIST="$(mktemp)"
LIBS="$(mktemp)"
EXECS="$(mktemp)"
BUNDLES="$(mktemp)"
trap 'rm -f "$LIST" "$LIBS" "$EXECS" "$BUNDLES"' EXIT

node "$HERE/pack-tools.mjs" list-macho "$PACK" > "$LIST"
node "$HERE/pack-tools.mjs" list-macho-lib "$PACK" > "$LIBS"
node "$HERE/pack-tools.mjs" list-macho-exec "$PACK" > "$EXECS"
node "$HERE/pack-tools.mjs" list-bundles "$PACK" > "$BUNDLES"
nul_count() { tr -cd '\0' < "$1" | wc -c | tr -d ' '; }
COUNT="$(nul_count "$LIST")"
LIB_COUNT="$(nul_count "$LIBS")"
EXEC_COUNT="$(nul_count "$EXECS")"
BUNDLE_COUNT="$(nul_count "$BUNDLES")"
echo "Mach-O files to sign: $COUNT ($EXEC_COUNT executables, $LIB_COUNT libraries); nested bundles: $BUNDLE_COUNT"

# Entitlements only take effect on main executables; Apple asks not to put
# them on dylibs or Python extension modules.
BASE_ARGS=(--force --timestamp --options runtime --sign "$IDENTITY")
if [ -n "$KEYCHAIN" ]; then
  BASE_ARGS+=(--keychain "$KEYCHAIN")
fi
EXEC_ARGS=("${BASE_ARGS[@]}" --entitlements "$ENTITLEMENTS")

start=$(date +%s)
# Libraries first, then executables, then bundles deepest-first so each bundle
# seals already-signed contents.
if [ "$LIB_COUNT" -gt 0 ]; then
  xargs -0 -n 25 -P "$JOBS" codesign "${BASE_ARGS[@]}" < "$LIBS"
fi
if [ "$EXEC_COUNT" -gt 0 ]; then
  xargs -0 -n 25 -P "$JOBS" codesign "${EXEC_ARGS[@]}" < "$EXECS"
fi
if [ "$BUNDLE_COUNT" -gt 0 ]; then
  xargs -0 -n 1 codesign "${EXEC_ARGS[@]}" < "$BUNDLES"
fi
sign_seconds=$(( $(date +%s) - start ))
echo "signed $COUNT Mach-O files in ${sign_seconds}s"

start=$(date +%s)
FAILURES="$(mktemp)"
# codesign --verify prints nothing on success; collect any failure output.
xargs -0 -n 50 -P "$JOBS" codesign --verify --strict < "$LIST" 2> "$FAILURES" || true
if [ -s "$FAILURES" ]; then
  echo "signature verification failed:" >&2
  head -50 "$FAILURES" >&2
  rm -f "$FAILURES"
  exit 1
fi
rm -f "$FAILURES"
echo "verified $COUNT signatures in $(( $(date +%s) - start ))s"

# Machine-readable timings for the workflow summary.
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "macho_count=$COUNT"
    echo "macho_exec_count=$EXEC_COUNT"
    echo "bundle_count=$BUNDLE_COUNT"
    echo "sign_seconds=$sign_seconds"
  } >> "$GITHUB_OUTPUT"
fi
