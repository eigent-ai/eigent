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

# Install a signed + notarized runtime pack archive into a user folder the way
# the app would, then run it there and report whether macOS lets it run.
#
# usage: verify-runtime-pack.sh --archive runtime-pack.zip [options]
#
#   --quarantine MODE  how the download is marked (default: none)
#                        none     plain app download (Node https / fs writes set no quarantine)
#                        archive  quarantine on the archive; ditto propagates it on extract
#                        files    quarantine on every extracted file (worst case)
#   --electron APP     also spawn the checks from this signed Electron app
#                      (e.g. /Applications/Eigent.app) via ELECTRON_RUN_AS_NODE
#   --dest DIR         install root (default: ~/.eigent/runtime-spike)
#   --report DIR       where to write the report (default: ./runtime-pack-report-<mode>)
#   --keep             keep the unpacked pack after the run
#   --skip-control     skip the negative control (ad-hoc signed, quarantined binary)
#
# Exit codes: 0 PASS, 1 FAIL, 3 INCONCLUSIVE (Gatekeeper is not enforcing here).
# Works with the stock macOS bash 3.2.

set -uo pipefail

ARCHIVE=""
MODE="none"
ELECTRON_APP=""
DEST="$HOME/.eigent/runtime-spike"
REPORT=""
KEEP=0
CONTROL=1
HERE="$(cd "$(dirname "$0")" && pwd)"

while [ $# -gt 0 ]; do
  case "$1" in
    --archive) ARCHIVE="$2"; shift 2 ;;
    --quarantine) MODE="$2"; shift 2 ;;
    --electron) ELECTRON_APP="$2"; shift 2 ;;
    --dest) DEST="$2"; shift 2 ;;
    --report) REPORT="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --skip-control) CONTROL=0; shift ;;
    -h|--help) sed -n '16,33p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

case "$MODE" in none|archive|files) ;; *) echo "bad --quarantine: $MODE" >&2; exit 2 ;; esac
[ -f "$ARCHIVE" ] || { echo "archive not found: $ARCHIVE" >&2; exit 2; }
[ "$(uname -s)" = "Darwin" ] || { echo "macOS only" >&2; exit 2; }
ARCHIVE="$(cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE")"
if [ -n "$ELECTRON_APP" ]; then
  [ -d "$ELECTRON_APP" ] || { echo "Electron app not found: $ELECTRON_APP" >&2; exit 2; }
  ELECTRON_APP="$(cd "$ELECTRON_APP" && pwd)"
fi
electron_bin() { echo "$ELECTRON_APP/Contents/MacOS/$(plutil -extract CFBundleExecutable raw -o - "$ELECTRON_APP/Contents/Info.plist")"; }
REPORT="${REPORT:-$PWD/runtime-pack-report-$MODE}"
rm -rf "$REPORT"
mkdir -p "$REPORT/logs" "$DEST"
RESULTS="$REPORT/results.tsv"
printf 'check\tstatus\tseconds\tdetail\n' > "$RESULTS"

now() { perl -MTime::HiRes=time -e 'printf "%.3f\n", time'; }
elapsed() { perl -e 'printf "%.3f\n", $ARGV[1] - $ARGV[0]' "$1" "$2"; }
# run_timeout SECONDS cmd...  (macOS has no coreutils `timeout`)
run_timeout() { local t="$1"; shift; perl -e 'alarm shift; exec @ARGV or die "exec failed: $!\n"' "$t" "$@"; }
PACK=""
record() {
  local detail="$4"
  if [ -n "$PACK" ]; then detail="${detail//$PACK/<pack>}"; fi
  detail="$(echo "$detail" | tr '\t\n' '  ' | cut -c1-300)"
  printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$detail" >> "$RESULTS"
  echo "[$2] $1 (${3}s) $detail"
}
qtn_value() { printf '0083;%x;%s;%s' "$(date +%s)" "$1" "$(uuidgen)"; }

# check NAME REQUIRED(1|0) TIMEOUT cmd...
check() {
  local name="$1" required="$2" timeout="$3"; shift 3
  local log="$REPORT/logs/$name.log" t0 t1 rc status
  t0=$(now)
  run_timeout "$timeout" "$@" > "$log" 2>&1
  rc=$?
  t1=$(now)
  if [ $rc -eq 0 ]; then status=PASS; elif [ "$required" = 1 ]; then status=FAIL; else status=WARN; fi
  record "$name" "$status" "$(elapsed "$t0" "$t1")" "exit=$rc $(tail -c 240 "$log")"
}

START_TS="$(date '+%Y-%m-%d %H:%M:%S')"
{
  echo "date: $START_TS"
  sw_vers 2>/dev/null
  echo "arch: $(uname -m)"
  echo "spctl: $(spctl --status 2>&1)"
  echo "mode: $MODE"
  echo "archive: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
} | tee "$REPORT/environment.txt"

# 1. "Download": copy the archive to a downloads folder and mark it.
SHA="$(shasum -a 256 "$ARCHIVE" | cut -d' ' -f1)"
if [ -f "$ARCHIVE.sha256" ]; then
  if grep -q "$SHA" "$ARCHIVE.sha256"; then record archive-sha256 PASS 0 "$SHA"
  else record archive-sha256 FAIL 0 "expected $(cat "$ARCHIVE.sha256") got $SHA"; fi
fi
WORK="$DEST/.work-$$"
rm -rf "$WORK"; mkdir -p "$WORK/downloads"
DL="$WORK/downloads/runtime-pack.zip"
cp "$ARCHIVE" "$DL"
if [ "$MODE" != none ]; then
  xattr -w com.apple.quarantine "$(qtn_value Eigent)" "$DL"
fi
echo "archive xattrs: $(xattr "$DL" | tr '\n' ' ')" >> "$REPORT/environment.txt"

# 2. Unpack into a temp dir, then move into place in one rename, as the app
#    must: replacing signed Mach-O files in place can get them killed.
NAME="${SHA:0:16}-$MODE"
PACK="$DEST/$NAME"
rm -rf "$PACK"
t0=$(now)
if ditto -x -k "$DL" "$WORK/unpacked" 2> "$REPORT/logs/unpack.log" && mv "$WORK/unpacked/runtime-pack" "$PACK"; then
  record unpack PASS "$(elapsed "$t0" "$(now)")" "$PACK"
else
  record unpack FAIL "$(elapsed "$t0" "$(now)")" "$(tail -c 240 "$REPORT/logs/unpack.log")"
  echo "cannot continue without an unpacked pack" >&2
  exit 1
fi
if [ "$MODE" = files ]; then
  QV="$(qtn_value Eigent)"
  find "$PACK" -type f -exec xattr -w com.apple.quarantine "$QV" {} +
fi
QUARANTINED="$(find "$PACK" -type f -xattr -print0 2>/dev/null | xargs -0 xattr 2>/dev/null | grep -c com.apple.quarantine || true)"
TOTAL_FILES="$(find "$PACK" -type f | wc -l | tr -d ' ')"
record quarantine-state INFO 0 "$QUARANTINED of $TOTAL_FILES files carry com.apple.quarantine; python: $(xattr -p com.apple.quarantine "$PACK/venv/bin/python" 2>/dev/null || echo none)"

# 3. Point the venvs at this pack's interpreter, as the app does at runtime.
#    Editing these text files must not break any signature (they are not sealed).
for venv in venv terminal_venv; do
  cfg="$PACK/$venv/pyvenv.cfg"
  if grep -q '{{PREBUILT_PYTHON_DIR}}' "$cfg"; then
    sed -i '' "s#{{PREBUILT_PYTHON_DIR}}#$PACK/uv_python#g" "$cfg"
  fi
done
record pyvenv-home INFO 0 "$(grep '^home' "$PACK/venv/pyvenv.cfg")"

# 4. Negative control: an ad-hoc signed, quarantined binary must be refused,
#    otherwise Gatekeeper is not enforcing here and a PASS proves nothing.
GK_ENFORCING=unknown
if [ "$CONTROL" = 1 ]; then
  mkdir -p "$WORK/control"
  cp "$PACK/bin/uv" "$WORK/control/uv-adhoc"
  codesign --force --sign - "$WORK/control/uv-adhoc" 2>/dev/null
  xattr -w com.apple.quarantine "$(qtn_value Safari)" "$WORK/control/uv-adhoc"
  t0=$(now)
  run_timeout 60 "$WORK/control/uv-adhoc" --version > "$REPORT/logs/control.log" 2>&1
  rc=$?
  if [ $rc -eq 0 ]; then
    GK_ENFORCING=no
    record control-adhoc-quarantined WARN "$(elapsed "$t0" "$(now)")" "ran (exit 0): Gatekeeper is NOT enforcing in this environment"
  else
    GK_ENFORCING=yes
    record control-adhoc-quarantined PASS "$(elapsed "$t0" "$(now)")" "refused as expected (exit=$rc) $(tail -c 160 "$REPORT/logs/control.log")"
  fi
fi

# 5. Signatures and notarization status of the unpacked files.
node_bin="$(command -v node || true)"
if [ -z "$node_bin" ] && [ -n "$ELECTRON_APP" ]; then
  node_bin="$(electron_bin)"
fi
if [ -n "$node_bin" ]; then
  ELECTRON_RUN_AS_NODE=1 "$node_bin" "$HERE/pack-tools.mjs" list-macho "$PACK" > "$WORK/macho.list"
  MACHO="$(tr -cd '\0' < "$WORK/macho.list" | wc -c | tr -d ' ')"
  t0=$(now)
  xargs -0 -n 50 -P 4 codesign --verify --strict < "$WORK/macho.list" > "$REPORT/logs/codesign-verify.log" 2>&1
  if [ -s "$REPORT/logs/codesign-verify.log" ]; then
    record codesign-verify-all FAIL "$(elapsed "$t0" "$(now)")" "$MACHO Mach-O; $(head -c 240 "$REPORT/logs/codesign-verify.log")"
  else
    record codesign-verify-all PASS "$(elapsed "$t0" "$(now)")" "$MACHO Mach-O files verify"
  fi
else
  record codesign-verify-all WARN 0 "skipped: no node or --electron to list Mach-O files"
fi
PY_REAL="$(cd "$PACK/venv/bin" && perl -MCwd=realpath -e 'print realpath(shift)' python)"
for bin in "$PACK/bin/uv" "$PACK/bin/bun" "$PY_REAL"; do
  rel="${bin#"$PACK"/}"
  if codesign --verify --strict --check-notarization -R='notarized' "$bin" > "$REPORT/logs/notarized-$(basename "$bin").log" 2>&1; then
    record "notarized:$rel" PASS 0 "ticket found (online lookup)"
  else
    record "notarized:$rel" WARN 0 "$(tail -c 200 "$REPORT/logs/notarized-$(basename "$bin").log")"
  fi
done

# 6. Run the pack directly from the shell.
check direct-venv-python-import 1 300 "$PACK/venv/bin/python" -c 'import camel, numpy; print("camel", camel.__version__, "numpy", numpy.__version__)'
check direct-terminal-venv-python 1 120 "$PACK/terminal_venv/bin/python" -c 'import sys, ssl, sqlite3, ctypes; print(sys.version.split()[0])'
check direct-uv-version 1 60 "$PACK/bin/uv" --version
check direct-bun-version 1 60 "$PACK/bin/bun" --version
check direct-uv-sees-pack-python 0 60 env UV_PYTHON_INSTALL_DIR="$PACK/uv_python" "$PACK/bin/uv" python list --only-installed
check direct-dlopen-all-native-libs 1 900 "$PACK/venv/bin/python" -I "$HERE/dlopen_all.py" "$PACK"
cp "$REPORT/logs/direct-dlopen-all-native-libs.log" "$REPORT/dlopen-direct.json" 2>/dev/null || true

# 7. Run the same checks as children of a signed, hardened Electron process.
if [ -n "$ELECTRON_APP" ]; then
  ebin="$(electron_bin)"
  codesign -dv --verbose=2 "$ELECTRON_APP" > "$REPORT/logs/electron-parent-signature.log" 2>&1
  t0=$(now)
  run_timeout 1200 env ELECTRON_RUN_AS_NODE=1 "$ebin" "$HERE/spawn-check.cjs" "$PACK" "$HERE/dlopen_all.py" > "$REPORT/electron-spawn.jsonl" 2> "$REPORT/logs/electron-spawn.stderr"
  rc=$?
  if [ $rc -eq 0 ]; then st=PASS; else st=FAIL; fi
  record electron-spawn "$st" "$(elapsed "$t0" "$(now)")" "parent=$ebin exit=$rc; $(grep -c '"status":"PASS"' "$REPORT/electron-spawn.jsonl") passed, $(grep -c '"status":"FAIL"' "$REPORT/electron-spawn.jsonl") failed"
fi

# 8. Quarantine after first run, and what Gatekeeper / AMFI logged meanwhile.
record quarantine-after-run INFO 0 "python: $(xattr -p com.apple.quarantine "$PY_REAL" 2>/dev/null || echo none)"
log show --style compact --start "$START_TS" \
  --predicate 'process == "syspolicyd" OR process == "amfid" OR subsystem == "com.apple.syspolicy" OR eventMessage CONTAINS[c] "quarantine"' \
  > "$REPORT/logs/syspolicy.log" 2>&1 || true

# 9. Verdict.
FAILS="$(awk -F'\t' 'NR>1 && $2=="FAIL"' "$RESULTS" | wc -l | tr -d ' ')"
if [ "$FAILS" -gt 0 ]; then VERDICT=FAIL; code=1
elif [ "$MODE" != none ] && [ "$GK_ENFORCING" != yes ]; then VERDICT=INCONCLUSIVE; code=3
else VERDICT=PASS; code=0; fi

{
  echo "# Runtime pack verification: $VERDICT"
  echo
  echo "- Mode: \`$MODE\`  ·  Gatekeeper enforcing (negative control): $GK_ENFORCING"
  echo "- macOS: $(sw_vers -productVersion 2>/dev/null) ($(uname -m))  ·  spctl: $(spctl --status 2>&1)"
  echo "- Pack: \`$PACK\`"
  echo
  echo "| Check | Status | Seconds | Detail |"
  echo "|---|---|---|---|"
  awk -F'\t' 'NR>1 { gsub(/\|/, "/", $4); printf "| %s | %s | %s | %s |\n", $1, $2, $3, $4 }' "$RESULTS"
} > "$REPORT/summary.md"
cat "$REPORT/summary.md"

if [ "$KEEP" = 0 ]; then rm -rf "$PACK"; fi
rm -rf "$WORK"
exit $code
