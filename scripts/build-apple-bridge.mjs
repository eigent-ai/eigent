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

// Builds native/apple-bridge and copies the binary to
// resources/prebuilt/apple-bridge/, where the packaged app and `npm run dev`
// look for it. Apple Intelligence needs Apple silicon, so this is a no-op on
// any other machine.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(root, 'native', 'apple-bridge');
const outputDirectory = path.join(
  root,
  'resources',
  'prebuilt',
  'apple-bridge'
);
const binaryName = 'eigent-apple-bridge';

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  console.log(
    `[apple-bridge] Skipped: needs macOS on Apple silicon (this is ${process.platform}/${process.arch}).`
  );
  process.exit(0);
}

const build = spawnSync(
  'swift',
  ['build', '-c', 'release', '--package-path', packagePath],
  { stdio: 'inherit' }
);
if (build.status !== 0) {
  console.error('[apple-bridge] swift build failed.');
  process.exit(build.status ?? 1);
}

const binPath = spawnSync(
  'swift',
  ['build', '-c', 'release', '--package-path', packagePath, '--show-bin-path'],
  { encoding: 'utf8' }
);
if (binPath.status !== 0) {
  console.error('[apple-bridge] Could not find the build output.');
  process.exit(binPath.status ?? 1);
}

const source = path.join(binPath.stdout.trim(), binaryName);
fs.mkdirSync(outputDirectory, { recursive: true });
const destination = path.join(outputDirectory, binaryName);
fs.copyFileSync(source, destination);
fs.chmodSync(destination, 0o755);
console.log(`[apple-bridge] Built ${path.relative(root, destination)}`);
