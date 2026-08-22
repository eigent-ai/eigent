// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0.

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../../..');
const outputDirectory = path.resolve(scriptDirectory, '../current-token-usage');
const sourceRoot = path.join(repositoryRoot, 'src');
const declaredTokensPath = path.join(
  repositoryRoot,
  'src',
  'style',
  'generated',
  'declared-tokens.json'
);
const sourceExtensions = new Set(['.css', '.js', '.jsx', '.ts', '.tsx']);
const excludedFile = /\.(?:test|spec|stories)\.(?:js|jsx|ts|tsx)$/;

const directMappings = new Map([
  [
    '--bg-page',
    {
      target: '--ds-bg-neutral-subtle-default',
      action: 'Page/canvas surface',
      confidence: 'high',
    },
  ],
  [
    '--text-heading',
    {
      target: '--ds-text-neutral-strong-default',
      action: 'Strong Ink role',
      confidence: 'high',
    },
  ],
  [
    '--text-secondary',
    {
      target: '--ds-text-neutral-muted-default',
      action: 'Muted Ink role',
      confidence: 'high',
    },
  ],
  [
    '--border-secondary',
    {
      target: '--ds-border-neutral-subtle-default',
      action: 'Quiet Hairline role',
      confidence: 'high',
    },
  ],
  [
    '--border-focus',
    {
      target: '--ds-ring-brand-default-focus',
      action: 'Compose the Accent focus ring separately',
      confidence: 'high',
    },
  ],
  [
    '--fill-fill-secondary',
    {
      target: '--ds-bg-neutral-muted-default',
      action: 'Confirm surface emphasis at the call site',
      confidence: 'medium',
    },
  ],
  [
    '--fill-fill-primary',
    {
      target: 'Neutral or Accent semantic background',
      action: 'Manual: infer component intent before replacement',
      confidence: 'manual',
    },
  ],
  [
    '--dialog-overlay-scrim',
    {
      target: 'overlay.scrim exception token',
      action: 'Keep as an approved overlay exception until its recipe lands',
      confidence: 'manual',
    },
  ],
  [
    '--terminal-viewport-surface',
    {
      target: '--ds-bg-terminal-subtle-default',
      action: 'Terminal pattern surface',
      confidence: 'medium',
    },
  ],
  [
    '--fill-browser',
    {
      target: '--ds-bg-browser-subtle-default',
      action: 'Browser pattern surface',
      confidence: 'medium',
    },
  ],
  [
    '--fill-document',
    {
      target: '--ds-bg-document-subtle-default',
      action: 'Document pattern surface',
      confidence: 'medium',
    },
  ],
]);

const tailwind4Mappings = new Map([
  ['flex-shrink-0', 'shrink-0'],
  ['flex-grow-0', 'grow-0'],
  ['flex-shrink', 'shrink'],
  ['overflow-ellipsis', 'text-ellipsis'],
]);

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(absolute));
      continue;
    }
    if (
      sourceExtensions.has(path.extname(entry.name)) &&
      !excludedFile.test(entry.name)
    ) {
      files.push(absolute);
    }
  }
  return files;
}

function addOccurrence(map, key, file, line) {
  const existing = map.get(key) ?? { count: 0, files: new Set(), examples: [] };
  existing.count += 1;
  existing.files.add(file);
  if (existing.examples.length < 5) existing.examples.push(`${file}:${line}`);
  map.set(key, existing);
}

function scanMatches(text, regex, file, map) {
  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const rest = text.slice(match.index + match[0].length);
    if (
      rest.startsWith('{') ||
      rest.startsWith('-{') ||
      rest.startsWith('*') ||
      rest.startsWith('-*')
    ) {
      continue;
    }
    const key = match[1] ?? match[0];
    const line = text.slice(0, match.index).split('\n').length;
    addOccurrence(map, key, file, line);
  }
}

function serialiseOccurrences(map) {
  return [...map.entries()]
    .map(([name, value]) => ({
      name,
      count: value.count,
      files: [...value.files].sort(),
      examples: value.examples,
    }))
    .sort(
      (left, right) =>
        right.count - left.count || left.name.localeCompare(right.name)
    );
}

function gitValue(args, fallback) {
  try {
    return execFileSync('git', args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function tableRows(rows, render) {
  return rows.length
    ? rows.map(render).join('')
    : '<tr><td colspan="5">No current usage found.</td></tr>';
}

const cssVariables = new Map();
const semanticUtilities = new Map();
const arbitraryGeometry = new Map();
const typographyUtilities = new Map();
const radiusUtilities = new Map();
const shadowUtilities = new Map();
const removedTailwindUtilities = new Map();
const sourceFiles = walk(sourceRoot);

for (const absolute of sourceFiles) {
  const relative = path
    .relative(repositoryRoot, absolute)
    .replaceAll('\\', '/');
  const text = readFileSync(absolute, 'utf8');
  scanMatches(text, /var\(\s*(--[a-zA-Z0-9_-]+)/g, relative, cssVariables);
  scanMatches(
    text,
    /\b((?:bg|text|border|ring-offset|ring|fill|stroke|shadow|rounded|divide|outline|min-h|max-h|min-w|max-w|size|gap|px|py|pt|pr|pb|pl|h|w)-ds-[a-z0-9-]+)\b/g,
    relative,
    semanticUtilities
  );
  scanMatches(
    text,
    /\b((?:h|w|min-h|max-h|min-w|max-w|p[trblxy]?|m[trblxy]?|gap|space-[xy]|rounded)-\[[^\]\s"'`]+\])/g,
    relative,
    arbitraryGeometry
  );
  scanMatches(
    text,
    /\b(text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl))\b/g,
    relative,
    typographyUtilities
  );
  scanMatches(
    text,
    /\b(rounded(?:-(?:sm|md|lg|xl|2xl|3xl|full))?)\b/g,
    relative,
    radiusUtilities
  );
  scanMatches(
    text,
    /\b(shadow(?:-[a-z0-9-[\]]+)?)\b/g,
    relative,
    shadowUtilities
  );
  for (const oldClass of tailwind4Mappings.keys()) {
    scanMatches(
      text,
      new RegExp(`\\b(${oldClass})\\b`, 'g'),
      relative,
      removedTailwindUtilities
    );
  }
}

const cssVariableRows = serialiseOccurrences(cssVariables).map((row) => {
  const mapping = directMappings.get(row.name);
  const alreadySemantic = row.name.startsWith('--ds-');
  return {
    ...row,
    target: alreadySemantic
      ? 'Keep semantic token'
      : (mapping?.target ?? 'Manual semantic-role review'),
    action: alreadySemantic
      ? 'No migration required'
      : (mapping?.action ?? 'Resolve intent at each call site'),
    confidence: alreadySemantic ? 'keep' : (mapping?.confidence ?? 'manual'),
  };
});

const report = {
  schemaVersion: 1,
  branch: gitValue(['branch', '--show-current'], 'unknown'),
  scannedFiles: sourceFiles.length,
  summary: {
    cssVariableReferences: cssVariableRows.reduce(
      (sum, row) => sum + row.count,
      0
    ),
    uniqueCssVariables: cssVariableRows.length,
    semanticUtilityReferences: serialiseOccurrences(semanticUtilities).reduce(
      (sum, row) => sum + row.count,
      0
    ),
    arbitraryGeometryReferences: serialiseOccurrences(arbitraryGeometry).reduce(
      (sum, row) => sum + row.count,
      0
    ),
    removedTailwindUtilities: serialiseOccurrences(
      removedTailwindUtilities
    ).reduce((sum, row) => sum + row.count, 0),
    manualTokenReferences: cssVariableRows
      .filter((row) => row.confidence === 'manual')
      .reduce((sum, row) => sum + row.count, 0),
  },
  cssVariables: cssVariableRows,
  utilities: {
    semantic: serialiseOccurrences(semanticUtilities),
    arbitraryGeometry: serialiseOccurrences(arbitraryGeometry),
    typography: serialiseOccurrences(typographyUtilities),
    radius: serialiseOccurrences(radiusUtilities),
    shadow: serialiseOccurrences(shadowUtilities),
    removedInTailwind4: serialiseOccurrences(removedTailwindUtilities).map(
      (row) => ({ ...row, target: tailwind4Mappings.get(row.name) })
    ),
  },
};

const migrationRows = cssVariableRows.filter(
  (row) => row.confidence !== 'keep'
);
const migrationMarkdown = `# Current token migration diff

Generated from \`${report.branch}\`.

This report is generated evidence, not an automatic codemod. High-confidence
mappings may be migrated mechanically after focused visual tests exist. Manual
mappings require component-intent review.

## Summary

| Measure | Count |
| --- | ---: |
| Production source files scanned | ${report.scannedFiles} |
| CSS variable references | ${report.summary.cssVariableReferences} |
| Unique CSS variables | ${report.summary.uniqueCssVariables} |
| Existing semantic utility references | ${report.summary.semanticUtilityReferences} |
| Arbitrary geometry references | ${report.summary.arbitraryGeometryReferences} |
| Manual token references | ${report.summary.manualTokenReferences} |
| Removed Tailwind 4 utility references | ${report.summary.removedTailwindUtilities} |

## CSS token migration queue

| Current token | References | Files | Proposed destination | Confidence | Action |
| --- | ---: | ---: | --- | --- | --- |
${migrationRows
  .map(
    (row) =>
      `| \`${row.name}\` | ${row.count} | ${row.files.length} | ${row.target.includes('--') ? `\`${row.target}\`` : row.target} | ${row.confidence} | ${row.action} |`
  )
  .join('\n')}

## Tailwind 4 removed-utility queue

| Current class | Replacement | References | Files |
| --- | --- | ---: | ---: |
${report.utilities.removedInTailwind4.length ? report.utilities.removedInTailwind4.map((row) => `| \`${row.name}\` | \`${row.target}\` | ${row.count} | ${row.files.length} |`).join('\n') : '| None | — | 0 | 0 |'}

## Migration rule

Do not replace every legacy alias with the same new token. Resolve the call
site as Accent, Neutral, Ink, Hairline, Feedback, Category, or an approved
pattern exception; then migrate the component recipe and its states together.
`;

const cssRows = tableRows(
  migrationRows,
  (row) => `<tr>
  <td><code>${escapeHtml(row.name)}</code></td>
  <td>${row.count}</td>
  <td>${row.files.length}</td>
  <td>${escapeHtml(row.target)}</td>
  <td><span class="confidence ${escapeHtml(row.confidence)}">${escapeHtml(row.confidence)}</span><small>${escapeHtml(row.action)}</small></td>
</tr>`
);
const tailwindRows = tableRows(
  report.utilities.removedInTailwind4,
  (row) =>
    `<tr><td><code>${escapeHtml(row.name)}</code></td><td><code>${escapeHtml(row.target)}</code></td><td>${row.count}</td><td>${row.files.length}</td><td>${escapeHtml(row.examples.join(', '))}</td></tr>`
);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Current token and CSS usage · Eigent</title>
<style>
:root{font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1d1d1d;background:#faf7f6;font-size:13px}*{box-sizing:border-box}body{margin:0}.shell{max-width:1180px;margin:auto;padding:40px 28px 80px}header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;margin-bottom:32px}h1{font-size:32px;letter-spacing:-.04em;margin:0}p{color:#666;line-height:1.6}.links{display:flex;gap:8px;flex-wrap:wrap}.links a{border:1px solid #d8d4d2;border-radius:999px;color:inherit;padding:7px 12px;text-decoration:none}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid #ddd8d6;border-radius:16px;overflow:hidden;background:#fff}.metric{padding:16px;border-right:1px solid #eee9e7}.metric:last-child{border:0}.metric strong,.metric span{display:block}.metric strong{font-size:22px}.metric span{color:#777;font-size:11px;margin-top:3px}.panel{margin-top:18px;border:1px solid #ddd8d6;border-radius:16px;overflow:hidden;background:#fff}.panel h2{font-size:15px;margin:0;padding:16px 18px;border-bottom:1px solid #eee9e7}.scroll{overflow:auto}table{width:100%;border-collapse:collapse;min-width:820px}th,td{text-align:left;vertical-align:top;padding:11px 12px;border-bottom:1px solid #eee9e7}th{font-size:10px;text-transform:uppercase;color:#777}td{font-size:11px}td small{display:block;color:#777;margin-top:4px;max-width:260px}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px}.confidence{display:inline-block;border-radius:999px;padding:2px 7px;background:#eee}.confidence.high,.confidence.keep{background:#dcfce7;color:#166534}.confidence.medium{background:#fef3c7;color:#92400e}.confidence.manual{background:#fee2e2;color:#991b1b}.note{border:1px solid #ddd8d6;border-radius:14px;background:#f3f0ef;padding:14px 16px;margin-top:18px}.meta{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;color:#777}@media(max-width:760px){header{display:block}.links{margin-top:16px}.metrics{grid-template-columns:repeat(2,1fr)}.metric:nth-child(2){border-right:0}.metric:nth-child(-n+2){border-bottom:1px solid #eee9e7}}
</style></head><body><main class="shell">
<header><div><div class="meta">${escapeHtml(report.branch)}</div><h1>Current token and CSS usage</h1><p>Generated inventory and migration diff for the approved Eigent design-system plan.</p></div><nav class="links"><a href="baseline.html">Current visual baseline</a><a href="../new-design-system-plan/index.html">Approved plan</a><a href="../migration-plan/MIGRATION_PLAN.md">Migration plan</a></nav></header>
<section class="metrics"><div class="metric"><strong>${report.scannedFiles}</strong><span>production files scanned</span></div><div class="metric"><strong>${report.summary.cssVariableReferences}</strong><span>CSS variable references</span></div><div class="metric"><strong>${report.summary.arbitraryGeometryReferences}</strong><span>arbitrary geometry uses</span></div><div class="metric"><strong>${report.summary.manualTokenReferences}</strong><span>manual token decisions</span></div></section>
<div class="note"><strong>Migration safety rule</strong><p>High-confidence rows are candidates for mechanical replacement. Manual rows must be resolved from component intent; this generator deliberately does not rewrite product code.</p></div>
<section class="panel"><h2>Legacy token migration queue</h2><div class="scroll"><table><thead><tr><th>Current</th><th>Refs</th><th>Files</th><th>Destination</th><th>Decision</th></tr></thead><tbody>${cssRows}</tbody></table></div></section>
<section class="panel"><h2>Tailwind 4 removed utilities</h2><div class="scroll"><table><thead><tr><th>Current</th><th>Replacement</th><th>Refs</th><th>Files</th><th>Examples</th></tr></thead><tbody>${tailwindRows}</tbody></table></div></section>
</main></body></html>`;

mkdirSync(outputDirectory, { recursive: true });
writeFileSync(
  path.join(outputDirectory, 'usage-report.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8'
);
writeFileSync(
  path.join(outputDirectory, 'MIGRATION_DIFF.md'),
  migrationMarkdown,
  'utf8'
);
writeFileSync(path.join(outputDirectory, 'index.html'), html, 'utf8');

const prettier = path.join(repositoryRoot, 'node_modules', '.bin', 'prettier');
execFileSync(
  prettier,
  ['--write', path.join(outputDirectory, 'usage-report.json')],
  {
    cwd: repositoryRoot,
    stdio: 'inherit',
  }
);

let declaredTokens;
try {
  declaredTokens = JSON.parse(readFileSync(declaredTokensPath, 'utf8'));
} catch {
  process.stderr.write(
    'FAIL  src/style/generated/declared-tokens.json is missing. Run npm run generate:design-tokens first.\n'
  );
  process.exit(1);
}
const declaredCssVars = new Set(declaredTokens.cssVariables);
const declaredUtilityTokens = new Set(declaredTokens.utilityTokens);
const unresolved = [];

function utilityTokenFromClass(className) {
  const match = className.match(
    /^(?:bg|text|border|ring-offset|ring|fill|stroke|shadow|rounded|divide|outline|min-h|max-h|min-w|max-w|size|gap|px|py|pt|pr|pb|pl|h|w)-(ds-[a-z0-9-]+)$/
  );
  return match?.[1] ?? null;
}

for (const row of serialiseOccurrences(semanticUtilities)) {
  const token = utilityTokenFromClass(row.name);
  if (token && !declaredUtilityTokens.has(token)) {
    unresolved.push({
      kind: 'utility',
      name: row.name,
      token,
      count: row.count,
      examples: row.examples,
    });
  }
}

for (const row of cssVariableRows) {
  if (row.name.startsWith('--ds-') && !declaredCssVars.has(row.name)) {
    unresolved.push({
      kind: 'css-variable',
      name: row.name,
      token: row.name,
      count: row.count,
      examples: row.examples,
    });
  }
}

if (unresolved.length > 0) {
  const details = unresolved
    .map(
      (item) => `  ${item.name} (${item.count}×) e.g. ${item.examples[0] ?? ''}`
    )
    .join('\n');
  process.stderr.write(
    `FAIL  Unresolved design-system tokens (not declared in manifest/generated tokens):\n${details}\n`
  );
  process.exitCode = 1;
}

process.stdout.write(
  `Built ${path.relative(repositoryRoot, outputDirectory)} (${report.scannedFiles} files scanned)\n`
);
