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

const diff = spawnSync(
  'git',
  ['diff', '--exit-code', '--', 'src/style/generated'],
  { cwd: repositoryRoot, encoding: 'utf8' }
);

if (diff.status !== 0) {
  process.stderr.write(
    'FAIL  Generated design-system tokens are dirty. Run `npm run generate:design-tokens`, then commit the output.\n'
  );
  if (diff.stdout) process.stderr.write(diff.stdout);
  process.exit(1);
}

const untracked = spawnSync(
  'git',
  ['ls-files', '--others', '--exclude-standard', '--', 'src/style/generated'],
  { cwd: repositoryRoot, encoding: 'utf8' }
);

if (untracked.stdout && untracked.stdout.trim().length > 0) {
  process.stderr.write(
    'FAIL  Generated design-system tokens are untracked. Commit src/style/generated.\n'
  );
  process.stderr.write(untracked.stdout);
  process.exit(1);
}

process.stdout.write(
  'PASS  Generated design-system tokens match the git tree.\n'
);
