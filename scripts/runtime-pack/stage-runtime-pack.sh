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

# Copy resources/prebuilt into a standalone runtime pack directory, applying
# the same filters electron-builder applies to the "prebuilt" extraResource and
# the same cleanup config/before-sign.cjs does inside the .app.
#
# usage: stage-runtime-pack.sh <resources/prebuilt> <out-dir>

set -euo pipefail

SRC="${1:?usage: stage-runtime-pack.sh <prebuilt-dir> <out-dir>}"
OUT="${2:?usage: stage-runtime-pack.sh <prebuilt-dir> <out-dir>}"
HERE="$(cd "$(dirname "$0")" && pwd)"

[ -d "$SRC" ] || { echo "prebuilt dir not found: $SRC" >&2; exit 1; }
rm -rf "$OUT"
mkdir -p "$OUT"

# Mirrors the "resources/prebuilt" filter in electron-builder.json.
rsync -a \
  --exclude '/cache/' \
  --exclude '.npm-cache/' \
  --exclude '__pycache__/' \
  --exclude '*.pyc' \
  --exclude '*.pyo' \
  --exclude '/venv/lib/python*/site-packages/yt_dlp/' \
  --exclude '/venv/lib/python*/site-packages/yt_dlp-*.dist-info/' \
  --exclude '/uv_python/**/site-packages/setuptools/' \
  --exclude '/uv_python/**/site-packages/wheel/' \
  "$SRC/" "$OUT/"

# Mirrors config/before-sign.cjs: flac-mac is built against an SDK too old to
# notarize, and symlinks that point outside the pack would break on user Macs.
find "$OUT/venv/lib" -path '*/site-packages/speech_recognition/flac-mac' -type f -print -delete 2>/dev/null || true
node "$HERE/pack-tools.mjs" prune-symlinks "$OUT"

# Extended attributes (FinderInfo, quarantine, provenance) must not end up in
# signatures or in the archive.
xattr -cr "$OUT" 2>/dev/null || true

for required in bin/uv bin/bun venv/pyvenv.cfg terminal_venv/pyvenv.cfg uv_python; do
  [ -e "$OUT/$required" ] || { echo "staged pack is missing $required" >&2; exit 1; }
done

echo "staged runtime pack at $OUT"
node "$HERE/pack-tools.mjs" stats "$OUT"
