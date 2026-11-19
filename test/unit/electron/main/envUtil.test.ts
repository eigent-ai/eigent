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

import crypto from 'node:crypto';
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
  const resourcesPathDescriptor = Object.getOwnPropertyDescriptor(
    process,
    'resourcesPath'
  );
  const posixIt = it.skipIf(process.platform === 'win32');

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
    if (resourcesPathDescriptor) {
      Object.defineProperty(process, 'resourcesPath', resourcesPathDescriptor);
    } else {
      Reflect.deleteProperty(process, 'resourcesPath');
    }
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  posixIt('restricts an existing user env file to 0600', () => {
    const eigentDir = path.join(homeDir, '.eigent');
    fs.mkdirSync(eigentDir, { recursive: true });
    const envPath = path.join(eigentDir, '.env.user');
    fs.writeFileSync(envPath, 'API_KEY=secret\n');
    fs.chmodSync(envPath, 0o644);

    const resolved = getEnvPath('user@example.com');

    expect(resolved).toBe(envPath);
    expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
  });

  posixIt(
    'writes env files with 0600 even when umask would leave them world-readable',
    () => {
      const envPath = path.join(homeDir, '.env');
      fs.writeFileSync(envPath, 'OLD=1\n');
      fs.chmodSync(envPath, 0o644);

      writeEnvFile(envPath, 'API_KEY=secret\n');

      expect(fs.readFileSync(envPath, 'utf-8')).toBe('API_KEY=secret\n');
      expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
    }
  );

  posixIt('creates a missing env file with 0600', () => {
    const envPath = path.join(homeDir, '.env');

    writeEnvFile(envPath, 'API_KEY=secret\n');

    expect(fs.existsSync(envPath)).toBe(true);
    expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
  });

  it('creates a missing env file with the requested content', () => {
    const envPath = path.join(homeDir, '.env');

    writeEnvFile(envPath, 'API_KEY=secret\n');

    expect(fs.readFileSync(envPath, 'utf-8')).toBe('API_KEY=secret\n');
    expect(fs.readdirSync(homeDir)).toEqual(['.env']);
  });

  it('keeps the previous content until the complete replacement is ready', () => {
    const envPath = path.join(homeDir, '.env');
    fs.writeFileSync(envPath, 'OLD=1\n');
    const rename = fs.renameSync;
    const replace = vi
      .spyOn(fs, 'renameSync')
      .mockImplementation((source, destination) => {
        expect(fs.readFileSync(envPath, 'utf-8')).toBe('OLD=1\n');
        expect(fs.readFileSync(source, 'utf-8')).toBe('API_KEY=secret\n');
        if (process.platform !== 'win32') {
          expect(fs.statSync(source).mode & 0o777).toBe(0o600);
        }
        rename(source, destination);
      });

    writeEnvFile(envPath, 'API_KEY=secret\n');

    expect(replace).toHaveBeenCalledOnce();
    expect(fs.readFileSync(envPath, 'utf-8')).toBe('API_KEY=secret\n');
    expect(fs.readdirSync(homeDir)).toEqual(['.env']);
  });

  posixIt(
    'does not expose new credentials through a previously opened public file',
    () => {
      const envPath = path.join(homeDir, '.env');
      fs.writeFileSync(envPath, 'OLD=1\n');
      fs.chmodSync(envPath, 0o644);
      const reader = fs.openSync(envPath, 'r');
      try {
        writeEnvFile(envPath, 'API_KEY=new-secret\n');

        expect(fs.readFileSync(reader, 'utf-8')).toBe('OLD=1\n');
        expect(fs.readFileSync(envPath, 'utf-8')).toBe('API_KEY=new-secret\n');
        expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
      } finally {
        fs.closeSync(reader);
      }
    }
  );

  posixIt('fails before writing credentials when chmod is denied', () => {
    const envPath = path.join(homeDir, '.env');
    fs.writeFileSync(envPath, 'OLD=1\n');
    fs.chmodSync(envPath, 0o644);
    const failure = Object.assign(new Error('operation not permitted'), {
      code: 'EPERM',
    });
    vi.spyOn(fs, 'fchmodSync').mockImplementation(() => {
      throw failure;
    });
    const write = vi.spyOn(fs, 'writeFileSync');

    expect(() => writeEnvFile(envPath, 'API_KEY=secret\n')).toThrow(failure);

    expect(write).not.toHaveBeenCalled();
    expect(fs.readFileSync(envPath, 'utf-8')).toBe('OLD=1\n');
    expect(fs.readdirSync(homeDir)).toEqual(['.env']);
  });

  posixIt(
    'rejects a filesystem that does not enforce the requested mode',
    () => {
      const envPath = path.join(homeDir, '.env');
      const chmod = fs.fchmodSync;
      vi.spyOn(fs, 'fchmodSync').mockImplementation((descriptor) =>
        chmod(descriptor, 0o644)
      );
      const write = vi.spyOn(fs, 'writeFileSync');

      expect(() => writeEnvFile(envPath, 'API_KEY=secret\n')).toThrow(
        'Cannot enforce owner-only'
      );

      expect(write).not.toHaveBeenCalled();
      expect(fs.readdirSync(homeDir)).toEqual([]);
    }
  );

  it.each(['writeFileSync', 'fsyncSync', 'renameSync'] as const)(
    'preserves the previous file and cleans up when %s fails',
    (operation) => {
      const envPath = path.join(homeDir, '.env');
      fs.writeFileSync(envPath, 'OLD=1\n');
      const failure = new Error(`${operation} failed`);
      vi.spyOn(fs, operation).mockImplementation(() => {
        throw failure;
      });

      expect(() => writeEnvFile(envPath, 'API_KEY=secret\n')).toThrow(failure);

      expect(fs.readFileSync(envPath, 'utf-8')).toBe('OLD=1\n');
      expect(fs.readdirSync(homeDir)).toEqual(['.env']);
    }
  );

  it('does not overwrite or remove a colliding temporary file', () => {
    const id = '00000000-0000-0000-0000-000000000000';
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(id);
    const collision = path.join(homeDir, `.env-${id}.tmp`);
    fs.writeFileSync(collision, 'unrelated content');

    expect(() =>
      writeEnvFile(path.join(homeDir, '.env'), 'API_KEY=secret\n')
    ).toThrow();

    expect(fs.readFileSync(collision, 'utf-8')).toBe('unrelated content');
    expect(fs.readdirSync(homeDir)).toEqual([path.basename(collision)]);
  });

  posixIt(
    'preserves existing symlink bindings when replacing their target',
    () => {
      const target = path.join(homeDir, 'bound.env');
      const envPath = path.join(homeDir, '.env');
      fs.writeFileSync(target, 'OLD=1\n');
      fs.symlinkSync('bound.env', envPath);

      writeEnvFile(envPath, 'API_KEY=secret\n');

      expect(fs.lstatSync(envPath).isSymbolicLink()).toBe(true);
      expect(fs.readlinkSync(envPath)).toBe('bound.env');
      expect(fs.readFileSync(target, 'utf-8')).toBe('API_KEY=secret\n');
      expect(fs.statSync(target).mode & 0o777).toBe(0o600);
    }
  );

  posixIt('rejects dangling symlinks without replacing the binding', () => {
    const envPath = path.join(homeDir, '.env');
    fs.symlinkSync('missing.env', envPath);

    expect(() => writeEnvFile(envPath, 'API_KEY=secret\n')).toThrow();

    expect(fs.lstatSync(envPath).isSymbolicLink()).toBe(true);
    expect(fs.readdirSync(homeDir)).toEqual(['.env']);
  });

  it('initializes a user env from the packaged default using the safe writer', () => {
    const packagedDir = path.join(process.resourcesPath, 'backend');
    fs.mkdirSync(packagedDir, { recursive: true });
    fs.writeFileSync(path.join(packagedDir, '.env'), 'DEFAULT_KEY=secret\n');

    const envPath = getEnvPath('user@example.com');

    expect(fs.readFileSync(envPath, 'utf-8')).toBe('DEFAULT_KEY=secret\n');
    if (process.platform !== 'win32') {
      expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
    }
    expect(fs.readdirSync(path.dirname(envPath))).toEqual(['.env.user']);
  });

  it('keeps existing-file permission hardening best-effort on load', () => {
    const eigentDir = path.join(homeDir, '.eigent');
    fs.mkdirSync(eigentDir);
    const envPath = path.join(eigentDir, '.env.user');
    fs.writeFileSync(envPath, 'API_KEY=secret\n');
    vi.spyOn(fs, 'chmodSync').mockImplementation(() => {
      throw new Error('chmod failed');
    });

    expect(getEnvPath('user@example.com')).toBe(envPath);
    expect(fs.readFileSync(envPath, 'utf-8')).toBe('API_KEY=secret\n');
  });
});
