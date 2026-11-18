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

/* global console */

// electron-builder 24.x unlocks its temporary signing keychain with the
// certificate's password (CSC_KEY_PASSWORD) when it runs
// `security set-key-partition-list -k`. Older macOS ignored the wrong
// password; macOS 27 rejects it ("SecKeychainUnlock: The user name or
// passphrase you entered is not correct"), so macOS signing fails.
// electron-builder 26.17.0 and later pass the keychain's own password (25.x
// and 26.0-26.15 still have the bug). Apply the same
// change to the installed 24.x copy. No-op when the package is missing or
// already uses the keychain password; warns if the code has a different shape.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = '[patch-electron-builder-keychain]';

const REPLACEMENTS = [
  [
    'return await importCerts(keychainFile, certPaths, [cscKeyPassword, cscIKeyPassword].filter(it => it != null));',
    'return await importCerts(keychainFile, certPaths, [cscKeyPassword, cscIKeyPassword].filter(it => it != null), keychainPassword);',
  ],
  [
    'async function importCerts(keychainFile, paths, keyPasswords) {',
    'async function importCerts(keychainFile, paths, keyPasswords, keychainPassword) {',
  ],
  [
    '"set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", password, keychainFile]',
    '"set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", keychainPassword, keychainFile]',
  ],
];

// Present once the keychain's own password is used (patched 24.x, or 26.17+).
const FIXED_CALL = REPLACEMENTS[2][1];

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkgDir = join(root, 'node_modules', 'app-builder-lib');
const target = join(pkgDir, 'out', 'codeSign', 'macCodeSign.js');

function run() {
  if (!existsSync(target)) return;

  const { version } = JSON.parse(
    readFileSync(join(pkgDir, 'package.json'), 'utf8')
  );

  let source = readFileSync(target, 'utf8');
  if (source.includes(FIXED_CALL)) {
    console.log(`${TAG} app-builder-lib ${version}: no patch needed`);
    return;
  }

  const missing = REPLACEMENTS.filter(([before]) => !source.includes(before));
  if (missing.length > 0) {
    console.warn(
      `${TAG} app-builder-lib ${version}: code did not match, left unchanged. macOS signing may fail on macOS 27.`
    );
    return;
  }

  for (const [before, after] of REPLACEMENTS) {
    source = source.replace(before, after);
  }
  writeFileSync(target, source);
  console.log(`${TAG} app-builder-lib ${version}: patched ${target}`);
}

try {
  run();
} catch (error) {
  console.warn(`${TAG} failed:`, error.message);
}
