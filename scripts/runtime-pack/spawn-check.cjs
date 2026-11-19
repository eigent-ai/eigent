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

/* global process, console, require */

// Spawn the runtime pack's binaries from inside a signed, hardened Electron
// process, the way the app starts the Brain (child_process.spawn of the venv
// Python). Run it with the Electron binary in Node mode:
//
//   ELECTRON_RUN_AS_NODE=1 /Applications/Eigent.app/Contents/MacOS/Eigent \
//     spawn-check.cjs <pack-dir> <dlopen_all.py>
//
// Prints one JSON line per check and exits non-zero if any required check
// failed.

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const [packDir, dlopenScript] = process.argv.slice(2);
if (!packDir) {
  console.error('usage: spawn-check.cjs <pack-dir> [dlopen_all.py]');
  process.exit(2);
}

const venvPython = path.join(packDir, 'venv', 'bin', 'python');
const terminalPython = path.join(packDir, 'terminal_venv', 'bin', 'python');
const checks = [
  {
    name: 'electron:venv-python-import',
    cmd: venvPython,
    args: [
      '-c',
      'import camel, numpy; print("camel", camel.__version__, "numpy", numpy.__version__)',
    ],
    required: true,
  },
  {
    name: 'electron:terminal-venv-python',
    cmd: terminalPython,
    args: [
      '-c',
      'import sys, ssl, sqlite3, ctypes; print(sys.version.split()[0])',
    ],
    required: true,
  },
  {
    name: 'electron:uv-version',
    cmd: path.join(packDir, 'bin', 'uv'),
    args: ['--version'],
    required: true,
  },
  {
    name: 'electron:bun-version',
    cmd: path.join(packDir, 'bin', 'bun'),
    args: ['--version'],
    required: true,
  },
];
if (dlopenScript) {
  checks.push({
    name: 'electron:dlopen-all-native-libs',
    cmd: venvPython,
    args: ['-I', dlopenScript, packDir],
    required: true,
  });
}

let failed = 0;
for (const check of checks) {
  const started = process.hrtime.bigint();
  const result = spawnSync(check.cmd, check.args, {
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  const ok = !result.error && result.status === 0;
  if (!ok && check.required) failed += 1;
  console.log(
    JSON.stringify({
      name: check.name,
      status: ok ? 'PASS' : 'FAIL',
      seconds: Number(seconds.toFixed(3)),
      exit: result.status,
      signal: result.signal,
      error: result.error ? String(result.error) : undefined,
      stdout: (result.stdout || '').trim().slice(-600),
      stderr: (result.stderr || '').trim().slice(-600),
    })
  );
}

console.log(
  JSON.stringify({
    name: 'electron:parent',
    execPath: process.execPath,
    electron: process.versions.electron || null,
    node: process.versions.node,
  })
);
process.exit(failed ? 1 : 0);
