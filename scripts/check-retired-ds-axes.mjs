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
 * Fails if product UI still references retired design-system axes:
 * inverse as a fill emphasis (`ds-*-inverse-*`), active/focus as color
 * states, transparent fill aliases, or the caution tone.
 *
 * Public inverse *text* (`text-ds-ink-inverse`, `text-ds-icon-inverse`) is
 * required on dark Accent fills and is not matched here.
 *
 * Compatibility generation in src/lib/themeTokens remains until two releases
 * show no regressions (Phase 7).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SRC_ROOT = join(REPO_ROOT, 'src');

const SKIP_PREFIXES = [
  'src/lib/themeTokens/',
  'src/style/generated/',
  'src/style/tokens/',
];

const SKIP_FILES = new Set([
  'src/components/ui/button.tsx',
  'src/components/ui/tag.tsx',
  'src/components/ui/semanticProps.ts',
]);

const SKIP_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;

const PATTERNS = [
  {
    id: 'inverse',
    regex: /ds-[a-z0-9-]*-inverse-[a-z0-9-]+/g,
  },
  {
    id: 'active-color',
    regex: /ds-[a-z0-9-]*-(?:default|subtle|muted|strong)-active\b/g,
  },
  {
    id: 'focus-color',
    regex: /ds-[a-z0-9-]*-(?:default|subtle|muted|strong)-focus\b/g,
  },
  {
    id: 'transparent-fill',
    regex: /fill-fill-transparent/g,
  },
  {
    id: 'caution-token',
    regex: /ds-(?:icon|text|bg|border|ring)-caution-/g,
  },
  {
    id: 'caution-prop',
    regex:
      /(?:variant|confirmVariant|confirmButtonVariant|cancelButtonVariant)=["']caution["']/g,
  },
];

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
      continue;
    }
    if (!/\.(tsx|ts|css)$/.test(entry.name)) continue;
    yield full;
  }
}

const hits = [];

for (const file of walk(SRC_ROOT)) {
  const rel = relative(REPO_ROOT, file).replaceAll('\\', '/');
  if (SKIP_FILES.has(rel)) continue;
  if (SKIP_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;
  if (SKIP_FILE_RE.test(rel)) continue;
  const text = readFileSync(file, 'utf8');
  for (const { id, regex } of PATTERNS) {
    regex.lastIndex = 0;
    const match = text.match(regex);
    if (!match) continue;
    hits.push({
      file: rel,
      id,
      samples: [...new Set(match)].slice(0, 5),
    });
  }
}

if (hits.length > 0) {
  const details = hits
    .map((hit) => `  ${hit.file} [${hit.id}] ${hit.samples.join(', ')}`)
    .join('\n');
  process.stderr.write(
    `FAIL  Retired design-system axes still referenced in product source:\n${details}\n`
  );
  process.exit(1);
}

process.stdout.write(
  'PASS  No product references to inverse/active/focus/transparent/caution axes.\n'
);
