// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

/**
 * Fails if UI source contains hard-coded colors instead of design tokens
 * (CSS variables such as var(--ds-...), var(--colors-...), component vars, or
 * Tailwind classes that map to those vars — not raw #hex / rgb() / hsl()).
 *
 * Usage:
 *   node scripts/check-design-token-usage.mjs
 *   node scripts/check-design-token-usage.mjs src/a.tsx   # lint-staged (one or more files)
 *
 * Exemptions:
 *   - End-of-line comment: // ds:allow-hardcoded-color
 *   - scripts/design-token-usage.allowlist — repo-relative paths, one per line (# comments ok)
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const EXT = new Set(['.ts', '.tsx', '.js', '.jsx']);

const SKIP_PREFIXES = ['src/lib/themeTokens/'];

const SKIP_FILE_RE =
  /\.(test|spec)\.(ts|tsx|js|jsx)$|vite-env\.d\.ts$|\.stories\.(ts|tsx)$/;

const HEX_RE = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;

const RGB_NUM_RE = /\brgba?\(\s*[\d.]/;
const HSL_NUM_RE = /\bhsla?\(\s*[\d.]/;

const ARBITRARY_HEX_RE =
  /\[[^\]]*#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b[^\]]*\]/;
const ARBITRARY_RGB_RE = /\[[^\]]*rgba?\([^\]]*\]/;

function loadAllowlist() {
  const path = join(REPO_ROOT, 'scripts/design-token-usage.allowlist');
  const set = new Set();
  if (!existsSync(path)) return set;
  const raw = readFileSync(path, 'utf8');
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    set.add(t.replaceAll('\\', '/'));
  }
  return set;
}

function shouldSkipPath(relPosix, allowlist) {
  const norm = relPosix.replaceAll('\\', '/');
  if (allowlist.has(norm)) return true;
  for (const prefix of SKIP_PREFIXES) {
    if (norm.startsWith(prefix)) return true;
  }
  if (SKIP_FILE_RE.test(norm)) return true;
  return false;
}

function* walkSrcFiles(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      yield* walkSrcFiles(p);
    } else {
      const ext = e.name.slice(e.name.lastIndexOf('.'));
      if (EXT.has(ext)) yield p;
    }
  }
}

function stripTrailingLineComment(line) {
  const idx = line.indexOf('//');
  if (idx === -1) return line;
  return line.slice(0, idx);
}

function lineHasExemption(line) {
  return line.includes('//') && line.includes('ds:allow-hardcoded-color');
}

function checkLine(rawLine, lineNum, fileRel, out) {
  if (lineHasExemption(rawLine)) return;
  const line = stripTrailingLineComment(rawLine);

  if (RGB_NUM_RE.test(line) || HSL_NUM_RE.test(line)) {
    out.push({
      file: fileRel,
      line: lineNum,
      message:
        'Use design tokens (e.g. var(--ds-...), Tailwind semantic colors) instead of raw rgb/hsl.',
      snippet: rawLine.trim(),
    });
    return;
  }

  HEX_RE.lastIndex = 0;
  let m;
  while ((m = HEX_RE.exec(line)) !== null) {
    const start = m.index;
    const before = line.slice(Math.max(0, start - 4), start);
    if (/url\s*\(\s*$/i.test(before)) continue;
    out.push({
      file: fileRel,
      line: lineNum,
      message: `Hard-coded hex "${m[0]}" — use a design token or Tailwind color that maps to var(--...).`,
      snippet: rawLine.trim(),
    });
    return;
  }

  if (ARBITRARY_HEX_RE.test(line) || ARBITRARY_RGB_RE.test(line)) {
    out.push({
      file: fileRel,
      line: lineNum,
      message:
        'Tailwind arbitrary color value ([#...] / [rgb(...)]) — use ds-* or semantic utilities.',
      snippet: rawLine.trim(),
    });
  }
}

function checkFile(absPath, allowlist) {
  const rel = relative(REPO_ROOT, absPath);
  const relPosix = rel.replaceAll('\\', '/');
  if (shouldSkipPath(relPosix, allowlist)) return [];

  const text = readFileSync(absPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const out = [];
  lines.forEach((ln, i) => checkLine(ln, i + 1, relPosix, out));
  return out;
}

function resolveCliFiles(argv) {
  const files = [];
  for (const a of argv) {
    if (a.startsWith('-')) continue;
    const abs = resolve(REPO_ROOT, a);
    if (existsSync(abs) && statSync(abs).isFile()) files.push(abs);
  }
  return files;
}

function main() {
  const allowlist = loadAllowlist();
  const argv = process.argv.slice(2).filter((a) => a !== '--');
  const explicit = resolveCliFiles(argv);

  const targets =
    explicit.length > 0
      ? explicit
      : [...walkSrcFiles(join(REPO_ROOT, 'src'))];

  const violations = [];
  for (const abs of targets) {
    violations.push(...checkFile(abs, allowlist));
  }

  if (violations.length === 0) {
    console.log('check-design-token-usage: OK (no hard-coded colors found).');
    process.exit(0);
  }

  console.error('check-design-token-usage: hard-coded colors detected:\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.message}`);
    console.error(
      `    ${v.snippet.slice(0, 200)}${v.snippet.length > 200 ? '…' : ''}\n`
    );
  }
  console.error(
    `Total: ${violations.length} finding(s). Fix or add // ds:allow-hardcoded-color on the line, or list the file in scripts/design-token-usage.allowlist (one path per line).`
  );
  process.exit(1);
}

main();
