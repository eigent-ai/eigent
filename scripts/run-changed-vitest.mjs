#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const workspace = resolve(process.cwd());
const testFilePattern = /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: workspace,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    stdio: options.inherit ? 'inherit' : 'pipe',
  });
  if (result.error) throw result.error;
  return result;
}

function resolveCommit(ref, label) {
  if (!ref || ref.startsWith('-') || !/^[A-Za-z0-9._/^~-]+$/.test(ref)) {
    throw new Error(`${label} must be a safe Git commit or ref`);
  }
  const result = run('git', ['rev-parse', '--verify', `${ref}^{commit}`]);
  if (result.status !== 0) {
    throw new Error(
      `Could not resolve ${label} ${ref}: ${result.stderr.trim()}`
    );
  }
  return result.stdout.trim();
}

function changedTestFiles(baseCommit, headCommit) {
  const result = run('git', [
    'diff',
    '--name-only',
    '--diff-filter=ACMR',
    '-z',
    baseCommit,
    headCommit,
    '--',
    'src',
    'test',
  ]);
  if (result.status !== 0) {
    throw new Error(
      `Could not list changed test files: ${result.stderr.trim()}`
    );
  }

  return result.stdout
    .split('\0')
    .filter(Boolean)
    .filter((path) => testFilePattern.test(path))
    .sort();
}

let exitCode = 1;
try {
  const headRef = process.env.VITEST_HEAD_SHA;
  let baseRef = process.env.VITEST_BASE_SHA;
  if (baseRef && /^0+$/.test(baseRef)) baseRef = `${headRef}^`;

  const baseCommit = resolveCommit(baseRef, 'VITEST_BASE_SHA');
  const headCommit = resolveCommit(headRef, 'VITEST_HEAD_SHA');
  const testFiles = changedTestFiles(baseCommit, headCommit);

  if (testFiles.length === 0) {
    console.log(
      'No frontend test files were added or updated; skipping Vitest.'
    );
    exitCode = 0;
  } else {
    console.log(`Running ${testFiles.length} changed frontend test file(s):`);
    testFiles.forEach((path) => console.log(`  - ${path}`));

    const executable = resolve(workspace, 'node_modules/.bin/vitest');
    if (!existsSync(executable)) {
      throw new Error('Vitest is not installed; run npm ci before this script');
    }
    const result = run(
      executable,
      ['run', '--passWithNoTests', ...testFiles.map((path) => `./${path}`)],
      { inherit: true }
    );
    exitCode = result.status ?? 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exitCode = 1;
}

process.exitCode = exitCode;
