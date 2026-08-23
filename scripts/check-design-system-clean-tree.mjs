// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('node', ['scripts/generate-design-tokens.mjs']);
run('node', [
  'docs/design-system/legacy-process/scripts/build-token-usage-report.mjs',
]);

const diff = spawnSync(
  'git',
  [
    'diff',
    '--exit-code',
    '--',
    'src/style/generated',
    'docs/design-system/legacy-process/current-token-usage/usage-report.json',
    'docs/design-system/legacy-process/current-token-usage/MIGRATION_DIFF.md',
    'docs/design-system/current-token-usage/index.html',
  ],
  { cwd: repositoryRoot, encoding: 'utf8' }
);

if (diff.status !== 0) {
  process.stderr.write(
    'FAIL  Generated design-system artifacts are dirty. Run `npm run generate:design-tokens` and `npm run build:design-system:usage`, then commit the output.\n'
  );
  if (diff.stdout) process.stderr.write(diff.stdout);
  process.exit(1);
}

const untracked = spawnSync(
  'git',
  [
    'ls-files',
    '--others',
    '--exclude-standard',
    '--',
    'src/style/generated',
    'docs/design-system/legacy-process/current-token-usage/usage-report.json',
    'docs/design-system/legacy-process/current-token-usage/MIGRATION_DIFF.md',
    'docs/design-system/current-token-usage/index.html',
  ],
  { cwd: repositoryRoot, encoding: 'utf8' }
);

if (untracked.stdout && untracked.stdout.trim().length > 0) {
  process.stderr.write(
    'FAIL  Generated design-system artifacts are untracked. Commit src/style/generated and the usage-report outputs.\n'
  );
  process.stderr.write(untracked.stdout);
  process.exit(1);
}

process.stdout.write(
  'PASS  Generated design-system artifacts match the git tree.\n'
);
