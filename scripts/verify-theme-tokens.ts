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

// Standalone V2 design-token verification CLI.
//
// Runs the verifier over every registered theme/mode/contrast variant and
// prints a human-readable report. Exits with a non-zero code if any `error`
// findings are produced. Auxiliary contrast warnings do not fail the run
// unless `--strict` is passed.
//
// Usage:
//   npm run verify:theme
//   npm run verify:theme -- --strict           # auxiliary warnings fail too
//   npm run verify:theme -- --json             # machine-readable output
//   npm run verify:theme -- --contrast 0,50,100

import {
  getDefaultContrastGrid,
  listRegisteredThemes,
  verifyThemeEngine,
  type VerifyFinding,
} from '../src/lib/themeTokens/verifier';

type CliFlags = {
  strict: boolean;
  json: boolean;
  contrastGrid: number[];
};

function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = {
    strict: false,
    json: false,
    contrastGrid: getDefaultContrastGrid(),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--strict') flags.strict = true;
    else if (arg === '--json') flags.json = true;
    else if (arg === '--contrast') {
      const raw = argv[++i];
      if (raw) {
        flags.contrastGrid = raw
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n));
      }
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'Usage: verify-theme-tokens [options]',
          '',
          'Options:',
          '  --strict           Treat auxiliary contrast warnings as errors',
          '  --json             Emit JSON report on stdout',
          '  --contrast a,b,c   Override contrast grid (default: 0,25,43,75,100)',
          '  -h, --help         Show this help',
          '',
        ].join('\n')
      );
      process.exit(0);
    }
  }
  return flags;
}

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
};

function colorize(text: string, code: string): string {
  if (!process.stdout.isTTY) return text;
  return `${code}${text}${COLORS.reset}`;
}

function groupFindings(
  findings: VerifyFinding[]
): Map<string, VerifyFinding[]> {
  const groups = new Map<string, VerifyFinding[]>();
  for (const f of findings) {
    const key = `${f.mode} / ${f.themeId} / contrast=${f.contrast}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(f);
    else groups.set(key, [f]);
  }
  return groups;
}

function printHumanReport(
  themes: Array<{ mode: string; id: string }>,
  flags: CliFlags,
  report: ReturnType<typeof verifyThemeEngine>
): void {
  const { summary, findings } = report;

  process.stdout.write(
    `\n${colorize('Design Token Engine Verification (V2)', COLORS.bold)}\n`
  );
  process.stdout.write(
    colorize(
      `  Registered themes: ${themes.map((t) => `${t.mode}/${t.id}`).join(', ')}\n`,
      COLORS.dim
    )
  );
  process.stdout.write(
    colorize(
      `  Contrast grid:     ${flags.contrastGrid.join(', ')}\n`,
      COLORS.dim
    )
  );
  process.stdout.write(
    colorize(`  Variants checked:  ${summary.variantsChecked}\n\n`, COLORS.dim)
  );

  if (findings.length === 0) {
    process.stdout.write(
      `${colorize('PASS', COLORS.green)}  No findings — engine is clean.\n\n`
    );
    return;
  }

  const groups = groupFindings(findings);
  for (const [variant, bucket] of groups) {
    process.stdout.write(`${colorize(variant, COLORS.cyan)}\n`);
    for (const f of bucket) {
      const badge =
        f.severity === 'error'
          ? colorize('ERROR', COLORS.red)
          : colorize('WARN ', COLORS.yellow);
      const ratioSuffix =
        f.ratio !== undefined && f.threshold !== undefined
          ? colorize(
              `  (ratio ${f.ratio.toFixed(2)} / threshold ${f.threshold})`,
              COLORS.dim
            )
          : '';
      process.stdout.write(
        `  ${badge}  [${f.code}] ${f.message}${ratioSuffix}\n`
      );
      if (f.tokenKey && f.value) {
        process.stdout.write(
          colorize(`         ↳ ${f.tokenKey} = ${f.value}\n`, COLORS.dim)
        );
      }
    }
    process.stdout.write('\n');
  }

  const errBadge =
    summary.errors === 0
      ? colorize(`${summary.errors} errors`, COLORS.green)
      : colorize(`${summary.errors} errors`, COLORS.red);
  const warnBadge =
    summary.warnings === 0
      ? colorize(`${summary.warnings} warnings`, COLORS.green)
      : colorize(`${summary.warnings} warnings`, COLORS.yellow);
  process.stdout.write(`Summary: ${errBadge}, ${warnBadge}\n\n`);
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const themes = listRegisteredThemes();
  const report = verifyThemeEngine({
    contrastGrid: flags.contrastGrid,
    strictAuxContrast: flags.strict,
  });

  if (flags.json) {
    process.stdout.write(JSON.stringify({ themes, ...report }, null, 2) + '\n');
  } else {
    printHumanReport(themes, flags, report);
  }

  const failed = report.summary.errors > 0;
  process.exit(failed ? 1 : 0);
}

main();
