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

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getEnvPath,
  writeEnvFile,
} from '../../../../electron/main/utils/envUtil';

describe('envUtil file permissions', () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent-env-perm-'));
    vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
    Object.defineProperty(process, 'resourcesPath', {
      value: path.join(homeDir, 'resources'),
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it('restricts an existing user env file to 0600', () => {
    const eigentDir = path.join(homeDir, '.eigent');
    fs.mkdirSync(eigentDir, { recursive: true });
    const envPath = path.join(eigentDir, '.env.user');
    fs.writeFileSync(envPath, 'API_KEY=secret\n');
    fs.chmodSync(envPath, 0o644);

    const resolved = getEnvPath('user@example.com');

    expect(resolved).toBe(envPath);
    expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
  });

  it('writes env files with 0600 even when umask would leave them world-readable', () => {
    const envPath = path.join(homeDir, '.env');
    fs.writeFileSync(envPath, 'OLD=1\n');
    fs.chmodSync(envPath, 0o644);

    writeEnvFile(envPath, 'API_KEY=secret\n');

    expect(fs.readFileSync(envPath, 'utf-8')).toBe('API_KEY=secret\n');
    expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
  });

  it('creates a missing env file with 0600', () => {
    const envPath = path.join(homeDir, '.env');

    writeEnvFile(envPath, 'API_KEY=secret\n');

    expect(fs.existsSync(envPath)).toBe(true);
    expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
  });
});
