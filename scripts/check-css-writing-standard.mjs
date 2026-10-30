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
 * Regression check for the Electron CSS writing standard:
 * - Any Tailwind border-width utility must cover all four sides.
 * - Unused axes are written as 0 (`border-x-0`, `border-t-0`, …).
 * - A bare `border` / `border-0` still needs explicit `border-x` + `border-y`.
 * - Retired component-color aliases (`text-text-*`, `bg-surface-*`, …) fail.
 *
 * Usage:
 *   node scripts/check-css-writing-standard.mjs
 *   node scripts/check-css-writing-standard.mjs --fix
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SRC_ROOT = join(REPO_ROOT, 'src');
const FIX_MODE = process.argv.includes('--fix');

const SKIP_PREFIXES = [
  'src/lib/themeTokens/',
  'src/style/generated/',
  'src/style/tokens/',
];

const SKIP_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;

const LINE_STRING_RE = /(['"])((?:\\.|[^\\\n])*?)\1/g;
const TEMPLATE_RE = /`((?:\\.|[^\\`$])*?)`/g;

const WIDTH_UTILITY_RE =
  /^(!)?border(?:-(x|y|t|r|b|l))?(?:-(0|\d+|\[[^\]]+\]))?$/;

const ALIAS_PATTERNS = [
  {
    id: 'text-text',
    regex: /(?<![\w-])(?:!)?text-text-[a-z0-9-]+/g,
  },
  {
    id: 'text-icon',
    regex: /(?<![\w-])(?:!)?text-icon-[a-z0-9-]+/g,
  },
  {
    id: 'bg-surface',
    regex: /(?<![\w-])(?:!)?bg-surface-[a-z0-9-]+/g,
  },
  {
    id: 'shadcn-surface',
    regex:
      /(?<![\w-])(?:bg-background|text-foreground|bg-card|text-muted-foreground|border-border|bg-popover|text-popover-foreground)(?![\w-])/g,
  },
  {
    id: 'shadcn-primary',
    regex:
      /(?<![\w-])(?:bg-primary|text-primary-foreground|border-primary|focus:border-primary)(?![\w-])/g,
  },
  {
    id: 'shadcn-destructive',
    regex:
      /(?<![\w-])(?:bg-destructive|text-destructive|border-destructive)(?:\/[\w.]+)?(?![\w-])/g,
  },
  {
    id: 'ring-ring',
    regex: /(?<![\w-])ring-ring(?![\w-])/g,
  },
  {
    id: 'legacy-warning',
    regex: /(?<![\w-])(?:bg-warning\/[\d.]+|text-warning)(?![\w-])/g,
  },
  {
    id: 'input-bg-alias',
    regex: /(?<![\w-])bg-input-bg-[a-z0-9-]+/g,
  },
  {
    id: 'code-surface',
    regex: /(?<![\w-])bg-code-surface(?![\w-])/g,
  },
  {
    id: 'radix-primary-scale',
    regex: /(?<![\w-])(?:bg|text)-primary-\d+(?![\w-])/g,
  },
  {
    id: 'text-red',
    regex: /(?<![\w-])text-red-\d+(?![\w-])/g,
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

function splitVariant(token) {
  let depth = 0;
  let lastColon = -1;
  for (let i = 0; i < token.length; i += 1) {
    const ch = token[i];
    if (ch === '[') depth += 1;
    else if (ch === ']') depth -= 1;
    else if (ch === ':' && depth === 0) lastColon = i;
  }
  if (lastColon === -1) return { variant: '', utility: token };
  return {
    variant: token.slice(0, lastColon + 1),
    utility: token.slice(lastColon + 1),
  };
}

function parseWidth(utility) {
  const match = WIDTH_UTILITY_RE.exec(utility);
  if (!match) return null;
  return {
    important: Boolean(match[1]),
    axis: match[2] ?? '',
    size: match[3] ?? '',
  };
}

function sizeSuffix(size) {
  return size ? `-${size}` : '';
}

function applyWidth(covered, axis, size) {
  const value = size || '1';
  if (!axis) {
    covered.t = value;
    covered.r = value;
    covered.b = value;
    covered.l = value;
    covered.shorthand = value;
    return;
  }
  if (axis === 'x') {
    covered.l = value;
    covered.r = value;
    covered.axisX = value;
    return;
  }
  if (axis === 'y') {
    covered.t = value;
    covered.b = value;
    covered.axisY = value;
    return;
  }
  covered[axis] = value;
  covered[`named${axis}`] = true;
}

function emptyCoverage() {
  return {
    t: undefined,
    r: undefined,
    b: undefined,
    l: undefined,
    namedt: undefined,
    namedr: undefined,
    namedb: undefined,
    namedl: undefined,
    axisX: undefined,
    axisY: undefined,
    shorthand: undefined,
    important: false,
  };
}

function analyzeBag(widthTokens) {
  const covered = emptyCoverage();
  for (const token of widthTokens) {
    applyWidth(covered, token.axis, token.size);
    if (token.important) covered.important = true;
  }
  const sidesDefined = ['t', 'r', 'b', 'l'].every(
    (side) => covered[side] !== undefined
  );
  const namedFour =
    covered.t !== undefined &&
    covered.r !== undefined &&
    covered.b !== undefined &&
    covered.l !== undefined &&
    covered.axisX === undefined &&
    covered.axisY === undefined &&
    covered.shorthand === undefined;
  const hasExplicitAxes =
    covered.axisX !== undefined && covered.axisY !== undefined;
  const hasAxisAndNamedY =
    covered.axisX !== undefined &&
    covered.t !== undefined &&
    covered.b !== undefined;
  const hasAxisAndNamedX =
    covered.axisY !== undefined &&
    covered.l !== undefined &&
    covered.r !== undefined;
  const writingOk =
    hasExplicitAxes || hasAxisAndNamedY || hasAxisAndNamedX || namedFour;
  return { covered, sidesDefined, writingOk };
}

function axisClass(prefix, axis, value) {
  return `${prefix}border-${axis}${sizeSuffix(value === '1' ? '' : value)}`;
}

function missingClasses(covered, variant) {
  const bang = covered.important ? '!' : '';
  const prefix = `${variant}${bang}`;
  const classes = [];

  const left = covered.l !== undefined;
  const right = covered.r !== undefined;
  const top = covered.t !== undefined;
  const bottom = covered.b !== undefined;

  if (!left && !right) classes.push(`${prefix}border-x-0`);
  else {
    if (!left) classes.push(`${prefix}border-l-0`);
    if (!right) classes.push(`${prefix}border-r-0`);
  }
  if (!top && !bottom) classes.push(`${prefix}border-y-0`);
  else {
    if (!top) classes.push(`${prefix}border-t-0`);
    if (!bottom) classes.push(`${prefix}border-b-0`);
  }

  if (left && right && top && bottom) {
    if (covered.axisX === undefined) {
      if (covered.l === covered.r) {
        classes.push(axisClass(prefix, 'x', covered.l));
      } else {
        if (!covered.namedl) classes.push(axisClass(prefix, 'l', covered.l));
        if (!covered.namedr) classes.push(axisClass(prefix, 'r', covered.r));
      }
    }
    if (covered.axisY === undefined) {
      if (covered.t === covered.b) {
        classes.push(axisClass(prefix, 'y', covered.t));
      } else {
        if (!covered.namedt) classes.push(axisClass(prefix, 't', covered.t));
        if (!covered.namedb) classes.push(axisClass(prefix, 'b', covered.b));
      }
    }
  }

  return [...new Set(classes)];
}

function tokenizeClassString(value) {
  return value.split(/\s+/).filter(Boolean);
}

function looksLikeClassList(value) {
  const tokens = tokenizeClassString(value);
  if (tokens.length === 0) return false;
  // Variant/enum names such as TabsAppearance "border" are not class lists.
  if (tokens.length === 1 && tokens[0] === 'border') return false;
  if (/[;{}=]/.test(value) && !/\[[^\]]*\]/.test(value)) return false;
  let classlike = 0;
  for (const token of tokens) {
    if (
      /^!?[a-zA-Z@][\w-]*(?:\[[^\]]+\])?(?::[^\s]+)*$/.test(token) ||
      token.startsWith('[') ||
      token.includes(':')
    ) {
      classlike += 1;
    }
  }
  return classlike / tokens.length >= 0.75;
}

function analyzeClassString(value) {
  if (!looksLikeClassList(value)) {
    return { ok: true, bags: [], replacements: null };
  }
  if (!/(?:^|[\s:])!?border(?:-|$)/.test(value)) {
    return { ok: true, bags: [], replacements: null };
  }
  const tokens = tokenizeClassString(value);
  const bags = new Map();
  tokens.forEach((token, index) => {
    const { variant, utility } = splitVariant(token);
    const width = parseWidth(utility);
    if (!width) return;
    const key = variant;
    if (!bags.has(key)) {
      bags.set(key, { variant, widths: [], indexes: [] });
    }
    const bag = bags.get(key);
    bag.widths.push(width);
    bag.indexes.push(index);
  });

  if (bags.size === 0) return { ok: true, bags: [], replacements: null };

  let ok = true;
  const insertAt = [];
  for (const bag of bags.values()) {
    const result = analyzeBag(bag.widths);
    if (result.sidesDefined && result.writingOk) continue;
    ok = false;
    const extras = missingClasses(result.covered, bag.variant);
    if (extras.length > 0) {
      insertAt.push({ index: Math.min(...bag.indexes), extras });
    }
  }

  if (ok) return { ok: true, bags: [...bags.keys()], replacements: null };

  const next = [...tokens];
  insertAt
    .sort((a, b) => b.index - a.index)
    .forEach(({ index, extras }) => {
      const existing = new Set(next);
      const unique = extras.filter((cls) => !existing.has(cls));
      if (unique.length === 0) return;
      next.splice(index, 0, ...unique);
    });

  return {
    ok: false,
    bags: [...bags.keys()],
    replacements: next.join(' '),
  };
}

function unescapeStringLiteral(raw, quote) {
  if (quote === '`') return raw;
  return raw.replace(/\\([\\'"`])/g, '$1');
}

function escapeStringLiteral(value, quote) {
  if (quote === '`') return value;
  const slash = quote === '"' ? '"' : "'";
  return value.replaceAll('\\', '\\\\').replaceAll(slash, `\\${slash}`);
}

function selfTest() {
  const cases = [
    ['border-b', false, 'border-x-0 border-t-0 border-b'],
    ['border-x-0 border-t-0 border-b', true, 'border-x-0 border-t-0 border-b'],
    ['border border-solid', false, 'border-x border-y border border-solid'],
    [
      'border border-solid border-x border-y',
      true,
      'border border-solid border-x border-y',
    ],
    ['border-0', false, 'border-x-0 border-y-0 border-0'],
    ['border-0 border-b', false, 'border-x-0 border-t-0 border-0 border-b'],
    ['border-x-0 border-y-0', true, 'border-x-0 border-y-0'],
    [
      '!border !border-solid !border-x !border-y',
      true,
      '!border !border-solid !border-x !border-y',
    ],
    [
      'hover:border-b',
      false,
      'hover:border-x-0 hover:border-t-0 hover:border-b',
    ],
    ['file:border-0', false, 'file:border-x-0 file:border-y-0 file:border-0'],
    [
      'border-ds-hairline-default-default',
      true,
      'border-ds-hairline-default-default',
    ],
    ['border', true, 'border'],
    [
      'border-b-[1px] border-solid',
      false,
      'border-x-0 border-t-0 border-b-[1px] border-solid',
    ],
    [
      'border-x-0 border-t-0 border-b-1',
      true,
      'border-x-0 border-t-0 border-b-1',
    ],
  ];

  const failures = [];
  for (const [input, expectOk, expectOut] of cases) {
    const result = analyzeClassString(input);
    if (result.ok !== expectOk) {
      failures.push(`${input}: ok=${result.ok} expected ${expectOk}`);
      continue;
    }
    const out = result.replacements ?? input;
    if (out !== expectOut) {
      failures.push(`${input}: got "${out}" expected "${expectOut}"`);
    }
  }
  if (failures.length > 0) {
    process.stderr.write(
      `FAIL  CSS writing-standard self-test:\n${failures.map((line) => `  ${line}`).join('\n')}\n`
    );
    process.exit(1);
  }
}

selfTest();

const hits = [];
const aliasHits = [];
let filesFixed = 0;

for (const file of walk(SRC_ROOT)) {
  const rel = relative(REPO_ROOT, file).replaceAll('\\', '/');
  if (SKIP_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue;
  if (SKIP_FILE_RE.test(rel)) continue;
  const original = readFileSync(file, 'utf8');
  let text = original;

  for (const { id, regex } of ALIAS_PATTERNS) {
    regex.lastIndex = 0;
    const match = text.match(regex);
    if (!match) continue;
    aliasHits.push({
      file: rel,
      id,
      samples: [...new Set(match)].slice(0, 5),
    });
  }

  const stringHits = [];
  LINE_STRING_RE.lastIndex = 0;
  let stringMatch = LINE_STRING_RE.exec(text);
  while (stringMatch) {
    stringHits.push({
      quote: stringMatch[1],
      raw: stringMatch[2],
      index: stringMatch.index,
      length: stringMatch[0].length,
    });
    stringMatch = LINE_STRING_RE.exec(text);
  }
  TEMPLATE_RE.lastIndex = 0;
  let templateMatch = TEMPLATE_RE.exec(text);
  while (templateMatch) {
    stringHits.push({
      quote: '`',
      raw: templateMatch[1],
      index: templateMatch.index,
      length: templateMatch[0].length,
    });
    templateMatch = TEMPLATE_RE.exec(text);
  }
  stringHits.sort((a, b) => a.index - b.index);

  const replacements = [];
  for (const stringHit of stringHits) {
    const value = unescapeStringLiteral(stringHit.raw, stringHit.quote);
    if (!value.includes('border')) continue;
    const result = analyzeClassString(value);
    if (result.ok) continue;
    hits.push({
      file: rel,
      sample: value.length > 120 ? `${value.slice(0, 117)}...` : value,
      fixed: result.replacements,
    });
    if (FIX_MODE && result.replacements && result.replacements !== value) {
      replacements.push({
        start: stringHit.index,
        end: stringHit.index + stringHit.length,
        next: `${stringHit.quote}${escapeStringLiteral(result.replacements, stringHit.quote)}${stringHit.quote}`,
      });
    }
  }

  if (FIX_MODE && replacements.length > 0) {
    replacements.sort((a, b) => b.start - a.start);
    for (const { start, end, next } of replacements) {
      text = `${text.slice(0, start)}${next}${text.slice(end)}`;
    }
    if (text !== original) {
      writeFileSync(file, text);
      filesFixed += 1;
    }
  }
}

if (FIX_MODE && filesFixed > 0) {
  process.stdout.write(
    `Updated ${filesFixed} file(s) with complete border-x / border-y axes.\n`
  );
}

if (aliasHits.length > 0 || (hits.length > 0 && !FIX_MODE)) {
  const details = [];
  if (hits.length > 0 && !FIX_MODE) {
    details.push(
      'Incomplete border axes (every direct border needs border-x and border-y, unused = 0):'
    );
    for (const hit of hits.slice(0, 80)) {
      details.push(`  ${hit.file}`);
      details.push(`    ${hit.sample}`);
    }
    if (hits.length > 80) {
      details.push(`  … ${hits.length - 80} more`);
    }
    details.push(
      `  (${hits.length} class string(s). Re-run with --fix to apply zeros / explicit axes.)`
    );
  }
  if (aliasHits.length > 0) {
    details.push('Retired component-color aliases:');
    for (const hit of aliasHits) {
      details.push(`  ${hit.file} [${hit.id}] ${hit.samples.join(', ')}`);
    }
  }
  process.stderr.write(`FAIL  CSS writing standard:\n${details.join('\n')}\n`);
  process.exit(1);
}

if (FIX_MODE && hits.length > 0 && aliasHits.length === 0) {
  process.stdout.write(
    `PASS  Applied border-axis completions (${hits.length} class string(s)). Re-run without --fix to verify.\n`
  );
  process.exit(0);
}

process.stdout.write(
  'PASS  CSS writing standard: complete border axes and no retired color aliases.\n'
);
