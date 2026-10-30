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

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const fixturePath = path.join(
  repositoryRoot,
  'src',
  'style',
  `.tailwind4-verify-${process.pid}.css`
);
const outputPath = path.join(
  os.tmpdir(),
  `eigent-tailwind4-verify-${process.pid}.css`
);
const tailwindBinary = path.join(
  repositoryRoot,
  'node_modules',
  '.bin',
  'tailwindcss'
);

const fixture = `@import './index.css';
@source inline('short:block max-lg:block smooth-shadow-md smooth-shadow-ring-md bg-ds-accent-strong-default bg-ds-neutral-default-default bg-ds-bg-neutral-default-default text-ds-text-base text-body-sm text-ds-ink-default-default border-ds-hairline-default-default ring-ds-ring-focus shadow-ds-elevation-control h-ds-control-md');
`;

const requiredOutput = [
  ['public Neutral fill utility', '.bg-ds-neutral-default-default'],
  ['compatibility Neutral fill utility', '.bg-ds-bg-neutral-default-default'],
  ['compatibility typography alias', '.text-body-sm'],
  ['legacy custom shadow utility', '.shadow-button-shadow'],
  ['Tailwind 4 replacement utility', '.shrink-0'],
  ['shadow-plugin utility', '.smooth-shadow-md'],
  ['shadow-plugin ring utility', '.smooth-shadow-ring-md'],
  ['custom short-screen media query', '@media (max-height: 800px)'],
  ['custom max-lg responsive utility', '.max-lg\\:block'],
  ['public accent fill utility', '.bg-ds-accent-strong-default'],
  ['public Ink utility', '.text-ds-ink-default-default'],
  ['public Hairline utility', '.border-ds-hairline-default-default'],
  ['public focus ring utility', '.ring-ds-ring-focus'],
  ['generated type role utility', '.text-ds-text-base'],
  ['semantic elevation utility', '.shadow-ds-elevation-control'],
  ['control height utility', '.h-ds-control-md'],
];

const forbiddenOutput = [
  ['unprocessed Tailwind theme directive', '@theme'],
  ['unprocessed Tailwind utility directive', '@utility'],
  ['unprocessed config directive', '@config'],
  ['unprocessed source directive', '@source'],
  ['invalid empty selector', ':where()'],
  ['invalid layer media query', '@media layer(utilities)'],
];

function fail(message) {
  process.stderr.write(`FAIL  ${message}\n`);
  process.exitCode = 1;
}

try {
  const tailwindVersion = JSON.parse(
    fs.readFileSync(
      path.join(repositoryRoot, 'node_modules', 'tailwindcss', 'package.json'),
      'utf8'
    )
  ).version;
  const shadowPluginVersion = JSON.parse(
    fs.readFileSync(
      path.join(
        repositoryRoot,
        'node_modules',
        'shadow-plugin',
        'package.json'
      ),
      'utf8'
    )
  ).version;

  if (!tailwindVersion.startsWith('4.')) {
    fail(`Expected Tailwind 4, found ${tailwindVersion}`);
  }
  if (!shadowPluginVersion.startsWith('2.')) {
    fail(`Expected shadow-plugin 2, found ${shadowPluginVersion}`);
  }

  fs.writeFileSync(fixturePath, fixture, 'utf8');
  const result = spawnSync(
    tailwindBinary,
    ['-i', fixturePath, '-o', outputPath],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
    }
  );

  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    fail(`Tailwind compilation exited with status ${result.status}`);
  } else {
    if (/\b(?:warning|unexpected)\b/i.test(result.stderr)) {
      process.stderr.write(result.stderr);
      fail('Tailwind compilation emitted a CSS warning');
    }
    const css = fs.readFileSync(outputPath, 'utf8');
    for (const [label, sentinel] of requiredOutput) {
      if (!css.includes(sentinel)) fail(`Missing ${label}: ${sentinel}`);
    }
    for (const [label, sentinel] of forbiddenOutput) {
      if (css.includes(sentinel)) fail(`Found ${label}: ${sentinel}`);
    }
  }

  if (!process.exitCode) {
    process.stdout.write(
      `PASS  Tailwind ${tailwindVersion}, shadow-plugin ${shadowPluginVersion}, and Eigent config sentinels compiled correctly.\n`
    );
  }
} finally {
  fs.rmSync(fixturePath, { force: true });
  fs.rmSync(outputPath, { force: true });
}
