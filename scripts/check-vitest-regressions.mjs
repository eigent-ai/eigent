#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const workspace = resolve(process.cwd());
const reportDirectory = resolve(
  process.env.VITEST_REPORT_DIR || join(workspace, 'test-results/regression')
);
const temporaryRoot = mkdtempSync(join(tmpdir(), 'eigent-vitest-regression-'));
const worktrees = [];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || workspace,
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

function addWorktree(label, commit) {
  const directory = join(temporaryRoot, label);
  const result = run('git', ['worktree', 'add', '--detach', directory, commit]);
  if (result.status !== 0) {
    throw new Error(
      `Could not create ${label} worktree: ${result.stderr.trim()}`
    );
  }
  worktrees.push(directory);
  return directory;
}

function decodeXml(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function attribute(attributes, name) {
  const match = attributes.match(new RegExp(`${name}="([^"]*)"`));
  return match ? decodeXml(match[1]) : '';
}

function readReport(path) {
  if (!existsSync(path)) {
    throw new Error(`Vitest did not produce ${path}`);
  }
  const xml = readFileSync(path, 'utf8');
  const root = xml.match(/<testsuites\b([^>]*)>/);
  if (!root) throw new Error(`Invalid JUnit report: ${path}`);
  const tests = Number(attribute(root[1], 'tests'));
  const failures = Number(attribute(root[1], 'failures'));
  if (!Number.isFinite(tests) || tests <= 0 || !Number.isFinite(failures)) {
    throw new Error(`Incomplete JUnit totals in ${path}`);
  }

  const failingTests = new Map();
  for (const suite of xml.matchAll(
    /<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/g
  )) {
    const suiteName = attribute(suite[1], 'name');
    for (const testCase of suite[2].matchAll(
      /<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g
    )) {
      if (!/<(?:failure|error)\b/.test(testCase[2])) continue;
      const className = attribute(testCase[1], 'classname') || suiteName;
      const testName = attribute(testCase[1], 'name');
      const identity = `${className} :: ${testName}`;
      failingTests.set(identity, (failingTests.get(identity) || 0) + 1);
    }
  }

  const parsedFailureCount = [...failingTests.values()].reduce(
    (total, count) => total + count,
    0
  );
  if (parsedFailureCount !== failures) {
    throw new Error(
      `JUnit failure total mismatch in ${path}: total=${failures}, parsed=${parsedFailureCount}`
    );
  }
  return { tests, failures, failingTests };
}

function installOrLinkDependencies(directory, installSeparately) {
  if (installSeparately) {
    const result = run('npm', ['install', '--ignore-scripts'], {
      cwd: directory,
      inherit: true,
    });
    if (result.status !== 0) {
      throw new Error(`npm install failed in ${directory}`);
    }
    return;
  }
  const sharedNodeModules = join(workspace, 'node_modules');
  if (!existsSync(sharedNodeModules)) {
    throw new Error('Run npm install before the Vitest regression gate');
  }
  symlinkSync(sharedNodeModules, join(directory, 'node_modules'), 'dir');
}

function runVitest(label, directory, options = {}) {
  const reportPath = join(reportDirectory, `${label}.xml`);
  rmSync(reportPath, { force: true });
  const executable = join(directory, 'node_modules/.bin/vitest');
  const args = [
    'run',
    '--no-cache',
    '--reporter=junit',
    `--outputFile=${reportPath}`,
  ];
  if (options.retry) args.push(`--retry=${options.retry}`);
  const result = run(executable, args, { cwd: directory, inherit: true });
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(
      `${label} Vitest exited unexpectedly with ${result.status}`
    );
  }
  return readReport(reportPath);
}

let exitCode = 1;
try {
  mkdirSync(reportDirectory, { recursive: true });
  let baseRef = process.env.VITEST_BASE_SHA;
  const headRef = process.env.VITEST_HEAD_SHA;
  if (baseRef && /^0+$/.test(baseRef)) baseRef = `${headRef}^`;
  const baseCommit = resolveCommit(baseRef, 'VITEST_BASE_SHA');
  const headCommit = resolveCommit(headRef, 'VITEST_HEAD_SHA');
  if (baseCommit === headCommit) {
    throw new Error('Vitest base and head resolve to the same commit');
  }

  const baseDirectory = addWorktree('base', baseCommit);
  const headDirectory = addWorktree('head', headCommit);
  const dependencyDiff = run('git', [
    'diff',
    '--quiet',
    baseCommit,
    headCommit,
    '--',
    'package.json',
    'package-lock.json',
    'npm-shrinkwrap.json',
  ]);
  const installSeparately = dependencyDiff.status === 1;
  if (dependencyDiff.status !== 0 && dependencyDiff.status !== 1) {
    throw new Error('Could not compare frontend dependency manifests');
  }
  installOrLinkDependencies(baseDirectory, installSeparately);
  installOrLinkDependencies(headDirectory, installSeparately);

  console.log(`Vitest baseline: ${baseCommit}`);
  const base = runVitest('base', baseDirectory);
  console.log(`Vitest candidate: ${headCommit} (retry=1)`);
  const head = runVitest('head', headDirectory, { retry: 1 });
  const regressions = [...head.failingTests.entries()]
    .flatMap(([failure, count]) => {
      const newCount = count - (base.failingTests.get(failure) || 0);
      return Array.from({ length: Math.max(0, newCount) }, () => failure);
    })
    .sort();

  console.log(
    `Vitest comparison: base ${base.tests} tests/${base.failures} failures; ` +
      `head ${head.tests} tests/${head.failures} failures.`
  );
  if (regressions.length > 0) {
    console.error(`New Vitest failures (${regressions.length}):`);
    regressions.forEach((failure) => console.error(`  - ${failure}`));
    exitCode = 1;
  } else {
    console.log('Vitest regression gate passed: no new failing tests.');
    exitCode = 0;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exitCode = 1;
} finally {
  for (const directory of worktrees.reverse()) {
    const result = run('git', ['worktree', 'remove', '--force', directory]);
    if (result.status !== 0) {
      console.error(`Could not remove temporary worktree ${directory}`);
      exitCode = 1;
    }
  }
  rmSync(temporaryRoot, { recursive: true, force: true });
}

process.exitCode = exitCode;
