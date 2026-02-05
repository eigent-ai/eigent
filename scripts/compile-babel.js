#!/usr/bin/env node
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Directly use venv's python.exe (not uv run) to avoid Windows .exe launcher
// placeholder issues - same reason we use direct python for backend/uvicorn.
/* global process, console */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const backendDir = path.join(projectRoot, 'backend');
const prebuiltVenvDir = path.join(projectRoot, 'resources', 'prebuilt', 'venv');
const isWindows = process.platform === 'win32';

// Prebuild uses resources/prebuilt/venv; dev may use backend/.venv
const devVenvDir = path.join(backendDir, '.venv');
let venvDir;
if (fs.existsSync(prebuiltVenvDir)) {
  venvDir = prebuiltVenvDir;
} else if (fs.existsSync(devVenvDir)) {
  venvDir = devVenvDir;
} else {
  console.error(
    'No Python venv found. Please run "uv sync" in the backend directory first.'
  );
  console.error(`   Looked for: ${prebuiltVenvDir}`);
  console.error(`   And: ${devVenvDir}`);
  process.exit(1);
}

const pythonPath = isWindows
  ? path.join(venvDir, 'Scripts', 'python.exe')
  : path.join(venvDir, 'bin', 'python');

if (!fs.existsSync(pythonPath)) {
  console.error(`Python executable not found at: ${pythonPath}`);
  console.error('   The venv may be corrupted. Please recreate it.');
  process.exit(1);
}

execSync(`"${pythonPath}" -m babel.messages.frontend compile -d lang`, {
  cwd: backendDir,
  stdio: 'inherit',
});
