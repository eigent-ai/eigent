#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const workspace = resolve(process.cwd());

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: workspace,
    env: process.env,
    encoding: 'utf8',
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

try {
  let baseRef = process.env.FORMAT_BASE_SHA;
  const headRef = process.env.FORMAT_HEAD_SHA;
  if (baseRef && /^0+$/.test(baseRef)) baseRef = `${headRef}^`;
  const baseCommit = resolveCommit(baseRef, 'FORMAT_BASE_SHA');
  const headCommit = resolveCommit(headRef, 'FORMAT_HEAD_SHA');
  const changed = run('git', [
    'diff',
    '--name-only',
    '-z',
    '--diff-filter=ACMR',
    baseCommit,
    headCommit,
  ]);
  if (changed.status !== 0) throw new Error('Could not list changed files');

  const files = changed.stdout
    .split('\0')
    .filter(Boolean)
    .filter(
      (file) =>
        (/^(src|test)\/.*\.tsx?$/.test(file) ||
          /^scripts\/.*\.mjs$/.test(file) ||
          /^\.github\/workflows\/.*\.ya?ml$/.test(file)) &&
        existsSync(resolve(workspace, file))
    );
  if (files.length === 0) {
    console.log('No changed frontend files require a Prettier check.');
  } else {
    const prettier = resolve(workspace, 'node_modules/.bin/prettier');
    const result = run(prettier, ['--check', ...files], { inherit: true });
    if (result.status !== 0) process.exitCode = result.status || 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
