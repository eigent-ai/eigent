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

// The Codex credential store imports electron for safeStorage; CI has no
// Electron binary, and these tests only need its folder lookup.
vi.mock('electron', () => ({ safeStorage: {} }));

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getCodexAuthDir } from '../../../../electron/main/subscriptionAuth/credentialStore';
import {
  ACCOUNT_REGISTRY_FILE,
  MIGRATION_MARKER_FILE,
  accountDirNameForUserId,
  legacyAccountDirName,
  registerAccountFolder,
  resolveAccountDirName,
} from '../../../../electron/main/utils/accountPath';
import {
  getEmailFolderPath,
  getEnvPath,
} from '../../../../electron/main/utils/envUtil';

let homeDir: string;
let eigent: string;
const resourcesPathDescriptor = Object.getOwnPropertyDescriptor(
  process,
  'resourcesPath'
);

function write(relative: string, content: string) {
  const target = path.join(eigent, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function read(relative: string): string {
  return fs.readFileSync(path.join(eigent, relative), 'utf-8');
}

function has(relative: string): boolean {
  return fs.existsSync(path.join(eigent, relative));
}

/** What an account had on disk before upgrading. */
function seedLegacyAccount(legacy: string, marker: string) {
  write(`.env.${legacy}`, `OPENAI_API_KEY=${marker}\n`);
  write(`${legacy}/codex-auth.json`, `{"owner":"${marker}"}`);
  write(`${legacy}/mcp-remote-0.1.22/abc_tokens.json`, `{"t":"${marker}"}`);
  write(`${legacy}/task_1/log.txt`, 'log');
}

beforeEach(() => {
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eigent home-'));
  eigent = path.join(homeDir, '.eigent');
  vi.spyOn(os, 'homedir').mockReturnValue(homeDir);
  // No packaged default env: getEnvPath must not invent a file.
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

describe('account folder names', () => {
  it('keeps the old name exactly, so old folders can be found', () => {
    expect(legacyAccountDirName('john.doe.x@example.com')).toBe('john_doe.x');
    expect(legacyAccountDirName('alice@work.com')).toBe('alice');
  });

  it('uses user_<id>, like the backend skills config', () => {
    expect(accountDirNameForUserId(42)).toBe('user_42');
    expect(accountDirNameForUserId('42')).toBe('user_42');
    expect(accountDirNameForUserId('user_42')).toBe('user_42');
  });

  it('never yields a name that is unsafe on Windows or escapes ~/.eigent', () => {
    expect(accountDirNameForUserId(null)).toBeNull();
    expect(accountDirNameForUserId('')).toBeNull();
    expect(accountDirNameForUserId('...')).toBeNull();
    expect(accountDirNameForUserId('a/../b')).toBeNull();
    for (const id of ['a\\b', 'C:x', 'x y', 'a*?"<>|']) {
      const name = accountDirNameForUserId(id);
      expect(name).toMatch(/^user_/);
      expect(name).not.toMatch(/[\\/:*?"<>|\s]/);
      expect(name).not.toContain('..');
    }
  });

  it('builds Windows paths under the profile folder', () => {
    const profile = 'C:\\Users\\Jane Doe';
    const dir = path.win32.join(
      profile,
      '.eigent',
      accountDirNameForUserId(7)!
    );
    expect(dir).toBe('C:\\Users\\Jane Doe\\.eigent\\user_7');
    expect(path.win32.dirname(dir)).toBe('C:\\Users\\Jane Doe\\.eigent');
  });
});

describe('registerAccountFolder', () => {
  it('fresh install: uses user_<id> with nothing to copy', () => {
    expect(getEnvPath('new@example.com')).toBe(path.join(eigent, '.env.new'));

    const result = registerAccountFolder('new@example.com', 5);

    expect(result.dirName).toBe('user_5');
    expect(result.migration?.status).toBe('nothing-to-migrate');
    expect(has(`user_5/${MIGRATION_MARKER_FILE}`)).toBe(true);
    expect(getEnvPath('new@example.com')).toBe(
      path.join(eigent, '.env.user_5')
    );
    expect(getEmailFolderPath('new@example.com').MCP_REMOTE_CONFIG_DIR).toBe(
      path.join(eigent, 'user_5')
    );
    expect(getCodexAuthDir('new@example.com')).toBe(
      path.join(eigent, 'user_5')
    );
  });

  it('upgrade with one account: copies keys, MCP and Codex sign-ins, keeps the old folder', () => {
    seedLegacyAccount('alice', 'alice-key');
    // Written by the backend's own skills-config migration: must survive.
    write('user_1/skills-config.json', '{"new":true}');
    write('alice/skills-config.json', '{"old":true}');

    const result = registerAccountFolder('alice@personal.com', 1);

    expect(result.migration?.status).toBe('migrated');
    expect(read('.env.user_1')).toBe('OPENAI_API_KEY=alice-key\n');
    expect(read('user_1/codex-auth.json')).toContain('alice-key');
    expect(read('user_1/mcp-remote-0.1.22/abc_tokens.json')).toContain(
      'alice-key'
    );
    expect(read('user_1/task_1/log.txt')).toBe('log');
    expect(read('user_1/skills-config.json')).toBe('{"new":true}');
    expect(result.migration?.skipped).toContain('skills-config.json');
    // Old data stays for other accounts and older app versions.
    expect(read('.env.alice')).toBe('OPENAI_API_KEY=alice-key\n');
    expect(has('alice/codex-auth.json')).toBe(true);
    // Every reader now uses the new place.
    expect(getEnvPath('alice@personal.com')).toBe(
      path.join(eigent, '.env.user_1')
    );
    expect(getCodexAuthDir('Alice@Personal.com ')).toBe(
      path.join(eigent, 'user_1')
    );
    const registry = JSON.parse(read(ACCOUNT_REGISTRY_FILE));
    expect(registry.accounts).toEqual({ 'alice@personal.com': 'user_1' });
  });

  it('two accounts that shared one old folder each get a copy and then stay apart', () => {
    seedLegacyAccount('alice', 'shared-key');

    const first = registerAccountFolder('alice@personal.com', 1);
    const second = registerAccountFolder('alice@work.com', 2);

    expect(first.migration?.sharedLegacyFolder).toBe(false);
    expect(second.migration?.sharedLegacyFolder).toBe(true);
    expect(read('.env.user_1')).toBe('OPENAI_API_KEY=shared-key\n');
    expect(read('.env.user_2')).toBe('OPENAI_API_KEY=shared-key\n');
    expect(has('alice/codex-auth.json')).toBe(true);

    // A key saved by one account no longer reaches the other.
    fs.writeFileSync(getEnvPath('alice@work.com'), 'OPENAI_API_KEY=work\n');
    expect(fs.readFileSync(getEnvPath('alice@personal.com'), 'utf-8')).toBe(
      'OPENAI_API_KEY=shared-key\n'
    );
    expect(getCodexAuthDir('alice@work.com')).not.toBe(
      getCodexAuthDir('alice@personal.com')
    );
  });

  it('migration already done: never copies again or overwrites newer data', () => {
    seedLegacyAccount('alice', 'old');
    registerAccountFolder('alice@personal.com', 1);
    fs.writeFileSync(path.join(eigent, '.env.user_1'), 'OPENAI_API_KEY=new\n');
    fs.rmSync(path.join(eigent, 'user_1', 'codex-auth.json'));

    const again = registerAccountFolder('alice@personal.com', 1);

    expect(again.migration?.status).toBe('already-done');
    expect(read('.env.user_1')).toBe('OPENAI_API_KEY=new\n');
    // Signed out of Codex after the move: the old sign-in must not come back.
    expect(has('user_1/codex-auth.json')).toBe(false);
  });

  it('a copy that fails partway keeps the old folder in use and retries next start', () => {
    seedLegacyAccount('alice', 'alice-key');
    const realCp = fs.cpSync;
    const cp = vi.spyOn(fs, 'cpSync').mockImplementation((src, dest, opts) => {
      if (String(src).endsWith('codex-auth.json')) {
        throw new Error('EACCES');
      }
      return realCp(src, dest, opts);
    });

    const failed = registerAccountFolder('alice@personal.com', 1);

    expect(failed.migration?.status).toBe('failed');
    expect(failed.migration?.failed).toEqual(['codex-auth.json']);
    expect(failed.dirName).toBe('alice');
    expect(has(`user_1/${MIGRATION_MARKER_FILE}`)).toBe(false);
    expect(has(ACCOUNT_REGISTRY_FILE)).toBe(false);
    // No half-copied leftovers next to the target.
    expect(
      fs
        .readdirSync(path.join(eigent, 'user_1'))
        .filter((n) => n.startsWith('.'))
    ).toEqual([]);
    expect(getEnvPath('alice@personal.com')).toBe(
      path.join(eigent, '.env.alice')
    );

    cp.mockRestore();
    const retried = registerAccountFolder('alice@personal.com', 1);

    expect(retried.migration?.status).toBe('migrated');
    expect(retried.migration?.copied).toEqual(['codex-auth.json']);
    expect(read('user_1/codex-auth.json')).toContain('alice-key');
    expect(resolveAccountDirName('alice@personal.com')).toBe('user_1');
  });

  it('never throws, even when ~/.eigent cannot be written', () => {
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {
      throw new Error('EROFS');
    });

    expect(() => registerAccountFolder('a@b.com', 1)).not.toThrow();
    expect(registerAccountFolder('a@b.com', 1).dirName).toBe('a');
  });

  it('ignores calls without an email or user id', () => {
    expect(registerAccountFolder('', 1)).toEqual({
      dirName: '',
      migration: null,
    });
    expect(registerAccountFolder('a@b.com', null).migration).toBeNull();
    expect(has(ACCOUNT_REGISTRY_FILE)).toBe(false);
  });

  it('copies only the account files out of an app folder an email used to map onto', () => {
    write('cache/codex-auth.json', '{"owner":"cache"}');
    write('cache/uv/huge.bin', 'x');

    registerAccountFolder('cache@example.com', 3);

    expect(has('user_3/codex-auth.json')).toBe(true);
    expect(has('user_3/uv')).toBe(false);
  });

  it('never copies from another account’s user_ folder', () => {
    write('user_7/codex-auth.json', '{"owner":"seven"}');

    const result = registerAccountFolder('user_7@example.com', 8);

    expect(result.migration?.status).toBe('nothing-to-migrate');
    expect(has('user_8/codex-auth.json')).toBe(false);
  });
});
