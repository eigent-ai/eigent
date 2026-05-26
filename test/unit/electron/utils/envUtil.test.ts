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

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

// ---------------------------------------------------------------------------
// Mocks – vi.hoisted ensures mocks are available when vi.mock factories run.
// ---------------------------------------------------------------------------

const {
  mockExistsSync,
  mockMkdirSync,
  mockCopyFileSync,
  mockChmodSync,
  mockReadFileSync,
  mockReaddirSync,
  mockHomedir,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockMkdirSync: vi.fn(),
  mockCopyFileSync: vi.fn(),
  mockChmodSync: vi.fn(),
  mockReadFileSync: vi.fn<(path: string, encoding: string) => string>(),
  mockReaddirSync: vi.fn(),
  mockHomedir: vi.fn<() => string>(),
}));

vi.mock('fs', () => ({
  default: {
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    copyFileSync: mockCopyFileSync,
    chmodSync: mockChmodSync,
    readFileSync: mockReadFileSync,
    readdirSync: mockReaddirSync,
  },
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  copyFileSync: mockCopyFileSync,
  chmodSync: mockChmodSync,
  readFileSync: mockReadFileSync,
  readdirSync: mockReaddirSync,
}));

vi.mock('os', () => ({
  default: { homedir: mockHomedir },
  homedir: mockHomedir,
}));

import {
  ENV_END,
  ENV_START,
  getEmailFolderPath,
  getEnvPath,
  maskProxyUrl,
  parseEnvBlock,
  readGlobalEnvKey,
  removeEnvKey,
  updateEnvBlock,
} from '@/../electron/main/utils/envUtil';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal .env content string with an MCP integration block. */
function envWithBlock(entries: Record<string, string>): string {
  const lines = [ENV_START];
  for (const [k, v] of Object.entries(entries)) {
    lines.push(`${k}=${v}`);
  }
  lines.push(ENV_END);
  return lines.join('\n');
}

// ===========================================================================
// Tests
// ===========================================================================

describe('envUtil', () => {
  let originalResourcesPath: string | undefined;

  beforeAll(() => {
    // process.resourcesPath is undefined in jsdom; provide a stub.
    originalResourcesPath = (process as any).resourcesPath;
    Object.defineProperty(process, 'resourcesPath', {
      value: '/fake/resources',
      writable: true,
      configurable: true,
    });
  });

  afterAll(() => {
    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      writable: true,
      configurable: true,
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockHomedir.mockReturnValue('/home/testuser');
  });

  // -------------------------------------------------------------------------
  // Constants
  // -------------------------------------------------------------------------
  describe('exported constants', () => {
    it('should export ENV_START marker', () => {
      expect(ENV_START).toBe('# === MCP INTEGRATION ENV START ===');
    });

    it('should export ENV_END marker', () => {
      expect(ENV_END).toBe('# === MCP INTEGRATION ENV END ===');
    });
  });

  // -------------------------------------------------------------------------
  // parseEnvBlock
  // -------------------------------------------------------------------------
  describe('parseEnvBlock()', () => {
    it('should locate start and end markers in a well-formed block', () => {
      const content = envWithBlock({ API_KEY: '123', HOST: 'localhost' });
      const result = parseEnvBlock(content);

      expect(result.start).toBe(0);
      expect(result.end).toBe(3); // line index of ENV_END
      expect(result.lines).toHaveLength(4);
    });

    it('should return lines.length for both indices when markers are absent', () => {
      const content = 'FOO=bar\nBAZ=qux';
      const result = parseEnvBlock(content);

      expect(result.start).toBe(result.lines.length);
      expect(result.end).toBe(result.lines.length);
    });

    it('should handle start present but end missing', () => {
      const content = ENV_START + '\nKEY=val';
      const result = parseEnvBlock(content);

      expect(result.start).toBe(0);
      expect(result.end).toBe(result.lines.length);
    });

    it('should handle end present but start missing', () => {
      const content = 'KEY=val\n' + ENV_END;
      const result = parseEnvBlock(content);

      expect(result.start).toBe(result.lines.length);
      expect(result.end).toBe(1);
    });

    it('should split on both LF and CRLF line endings', () => {
      const content = ENV_START + '\r\nKEY=val\r\n' + ENV_END;
      const result = parseEnvBlock(content);

      expect(result.lines).toHaveLength(3);
      expect(result.start).toBe(0);
      expect(result.end).toBe(2);
    });

    it('should trim whitespace when locating markers', () => {
      const content = '  ' + ENV_START + '  \nKEY=val\n  ' + ENV_END + '  ';
      const result = parseEnvBlock(content);

      expect(result.start).toBe(0);
      expect(result.end).toBe(2);
    });

    it('should return lines.length for both indices when content is empty string', () => {
      const result = parseEnvBlock('');
      // '' splits to [''] → lines.length = 1, findIndex returns -1 for both markers,
      // so both indices become lines.length (1).
      expect(result.lines).toEqual(['']);
      expect(result.start).toBe(result.lines.length);
      expect(result.end).toBe(result.lines.length);
    });
  });

  // -------------------------------------------------------------------------
  // updateEnvBlock
  // -------------------------------------------------------------------------
  describe('updateEnvBlock()', () => {
    it('should add a new key to an existing block', () => {
      const lines = envWithBlock({ API_KEY: 'old' }).split(/\r?\n/);
      const result = updateEnvBlock(lines, { NEW_KEY: 'value' });

      const blockContent = result.join('\n');
      expect(blockContent).toContain('API_KEY=old');
      expect(blockContent).toContain('NEW_KEY=value');
      expect(blockContent).toContain(ENV_START);
      expect(blockContent).toContain(ENV_END);
    });

    it('should update an existing key value', () => {
      const lines = envWithBlock({ API_KEY: 'old' }).split(/\r?\n/);
      const result = updateEnvBlock(lines, { API_KEY: 'new' });

      const blockContent = result.join('\n');
      expect(blockContent).toContain('API_KEY=new');
      expect(blockContent).not.toContain('API_KEY=old');
    });

    it('should create a new block when no markers exist', () => {
      const lines = ['FOO=bar', 'BAZ=qux'];
      const result = updateEnvBlock(lines, { API_KEY: 'val' });

      expect(result).toContain(ENV_START);
      expect(result).toContain(ENV_END);
      expect(result).toContain('API_KEY=val');
      // Original lines should still be present (appended after them)
      expect(result).toContain('FOO=bar');
    });

    it('should handle end before start as missing block', () => {
      const lines = [ENV_END, 'MID=line', ENV_START];
      const result = updateEnvBlock(lines, { KEY: 'val' });

      // Should append a new block since end < start is treated as invalid
      expect(result).toContain(ENV_START);
      expect(result).toContain(ENV_END);
      expect(result).toContain('KEY=val');
    });

    it('should handle multiple key-value updates in one call', () => {
      const lines = envWithBlock({ A: '1' }).split(/\r?\n/);
      const result = updateEnvBlock(lines, { B: '2', C: '3' });

      const joined = result.join('\n');
      expect(joined).toContain('A=1');
      expect(joined).toContain('B=2');
      expect(joined).toContain('C=3');
    });

    it('should preserve lines outside the block', () => {
      const lines = [
        'OUTSIDE_BEFORE=true',
        ENV_START,
        'KEY=old',
        ENV_END,
        'OUTSIDE_AFTER=true',
      ];
      const result = updateEnvBlock(lines, { KEY: 'new' });

      expect(result[0]).toBe('OUTSIDE_BEFORE=true');
      expect(result[result.length - 1]).toBe('OUTSIDE_AFTER=true');
      expect(result).toContain('KEY=new');
    });

    it('should overwrite key regardless of case pattern in existing block', () => {
      const lines = envWithBlock({ MY_KEY: 'v1' }).split(/\r?\n/);
      const result = updateEnvBlock(lines, { MY_KEY: 'v2' });

      const joined = result.join('\n');
      expect(joined).toContain('MY_KEY=v2');
      expect(joined).not.toContain('MY_KEY=v1');
    });

    it('should handle empty kv object gracefully', () => {
      const lines = envWithBlock({ A: '1' }).split(/\r?\n/);
      const result = updateEnvBlock(lines, {});

      // Block markers should still exist; content unchanged
      expect(result).toContain(ENV_START);
      expect(result).toContain(ENV_END);
      expect(result).toContain('A=1');
    });

    it('should handle value containing equals sign', () => {
      const lines = envWithBlock({}).split(/\r?\n/);
      const result = updateEnvBlock(lines, { URL: 'http://host?key=val' });

      expect(result.join('\n')).toContain('URL=http://host?key=val');
    });
  });

  // -------------------------------------------------------------------------
  // removeEnvKey
  // -------------------------------------------------------------------------
  describe('removeEnvKey()', () => {
    it('should remove a key from the block', () => {
      const lines = envWithBlock({ KEEP: 'yes', REMOVE: 'no' }).split(/\r?\n/);
      const result = removeEnvKey(lines, 'REMOVE');

      const joined = result.join('\n');
      expect(joined).toContain('KEEP=yes');
      expect(joined).not.toContain('REMOVE=');
    });

    it('should return lines unchanged if no block markers exist', () => {
      const lines = ['FOO=bar', 'BAZ=qux'];
      const result = removeEnvKey(lines, 'FOO');

      expect(result).toEqual(lines);
    });

    it('should return lines unchanged if only start marker exists', () => {
      const lines = [ENV_START, 'FOO=bar'];
      const result = removeEnvKey(lines, 'FOO');

      expect(result).toEqual(lines);
    });

    it('should return lines unchanged if end < start', () => {
      const lines = [ENV_END, ENV_START, 'FOO=bar'];
      const result = removeEnvKey(lines, 'FOO');

      expect(result).toEqual(lines);
    });

    it('should not remove a key that is a prefix of another key', () => {
      const lines = envWithBlock({
        API_KEY: 'keep',
        API_KEY_EXTRA: 'also keep',
      }).split(/\r?\n/);

      // Removing "API" should not match "API_KEY" or "API_KEY_EXTRA"
      const result = removeEnvKey(lines, 'API');
      const joined = result.join('\n');
      expect(joined).toContain('API_KEY=keep');
      expect(joined).toContain('API_KEY_EXTRA=also keep');
    });

    it('should preserve lines outside the block', () => {
      const lines = [
        'BEFORE=1',
        ENV_START,
        'TARGET=remove',
        ENV_END,
        'AFTER=1',
      ];
      const result = removeEnvKey(lines, 'TARGET');

      expect(result[0]).toBe('BEFORE=1');
      expect(result[result.length - 1]).toBe('AFTER=1');
      expect(result).not.toContain('TARGET=remove');
    });

    it('should handle removing a key that does not exist in the block', () => {
      const lines = envWithBlock({ A: '1' }).split(/\r?\n/);
      const result = removeEnvKey(lines, 'NONEXISTENT');

      expect(result.join('\n')).toContain('A=1');
    });

    it('should handle empty block content', () => {
      const lines = [ENV_START, ENV_END];
      const result = removeEnvKey(lines, 'ANY_KEY');

      expect(result).toEqual([ENV_START, ENV_END]);
    });
  });

  // -------------------------------------------------------------------------
  // readGlobalEnvKey
  // -------------------------------------------------------------------------
  describe('readGlobalEnvKey()', () => {
    const globalEnvPath = '/home/testuser/.eigent/.env';

    it('should return null when global .env file does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      expect(readGlobalEnvKey('ANY_KEY')).toBeNull();
      expect(mockExistsSync).toHaveBeenCalledWith(globalEnvPath);
    });

    it('should return the value of an existing key', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('MY_KEY=my_value\nOTHER=thing');

      expect(readGlobalEnvKey('MY_KEY')).toBe('my_value');
    });

    it('should return null when key is not found', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('OTHER=thing\nUNRELATED=val');

      expect(readGlobalEnvKey('MY_KEY')).toBeNull();
    });

    it('should strip surrounding double quotes from value', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('KEY="quoted value"');

      expect(readGlobalEnvKey('KEY')).toBe('quoted value');
    });

    it('should strip surrounding single quotes from value', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("KEY='quoted value'");

      expect(readGlobalEnvKey('KEY')).toBe('quoted value');
    });

    it('should NOT strip mismatched quotes', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('KEY="mismatch\'');

      expect(readGlobalEnvKey('KEY')).toBe('"mismatch\'');
    });

    it('should return null when readFileSync throws', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockImplementation(() => {
        throw new Error('read error');
      });

      expect(readGlobalEnvKey('ANY')).toBeNull();
    });

    it('should handle empty file content', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('');

      expect(readGlobalEnvKey('ANY')).toBeNull();
    });

    it('should handle value with leading/trailing whitespace after prefix', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('KEY=  spaced  ');

      expect(readGlobalEnvKey('KEY')).toBe('spaced');
    });

    it('should handle CRLF line endings', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('KEY=val\r\nOTHER=thing\r\n');

      expect(readGlobalEnvKey('KEY')).toBe('val');
      expect(readGlobalEnvKey('OTHER')).toBe('thing');
    });

    it('should handle empty value', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('KEY=');

      expect(readGlobalEnvKey('KEY')).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // maskProxyUrl
  // -------------------------------------------------------------------------
  describe('maskProxyUrl()', () => {
    it('should mask username and password in a URL', () => {
      expect(maskProxyUrl('http://user:pass@host:8080')).toBe(
        'http://***:***@host:8080/'
      );
    });

    it('should return URL unchanged when no credentials present', () => {
      // maskProxyUrl returns the original string as-is when there are no creds
      expect(maskProxyUrl('http://host:8080')).toBe('http://host:8080');
    });

    it('should return URL unchanged when only username is present', () => {
      // URL API treats "user@" as having username but empty password
      const result = maskProxyUrl('http://user@host:8080');
      expect(result).toContain('***');
    });

    it('should return invalid URL as-is', () => {
      expect(maskProxyUrl('not-a-url')).toBe('not-a-url');
    });

    it('should return empty string as-is', () => {
      expect(maskProxyUrl('')).toBe('');
    });

    it('should mask HTTPS URLs with credentials', () => {
      const result = maskProxyUrl('https://admin:secret@api.example.com/path');
      expect(result).toContain('***');
      expect(result).toContain('api.example.com');
      expect(result).not.toContain('admin');
      expect(result).not.toContain('secret');
    });

    it('should handle URL with special characters in password', () => {
      const result = maskProxyUrl('http://user:p@ss:w0rd@host:8080');
      expect(result).toContain('***');
      expect(result).not.toContain('p@ss');
    });

    it('should handle socks5 proxy URLs', () => {
      const result = maskProxyUrl('socks5://user:pass@host:1080');
      expect(result).toContain('***');
    });

    it('should return URL without credentials unchanged (no protocol)', () => {
      expect(maskProxyUrl('localhost:3000')).toBe('localhost:3000');
    });
  });

  // -------------------------------------------------------------------------
  // getEnvPath
  // -------------------------------------------------------------------------
  describe('getEnvPath()', () => {
    const eigentDir = '/home/testuser/.eigent';

    it('should sanitize email local part for the filename', () => {
      mockExistsSync.mockReturnValue(true);

      const result = getEnvPath('user.name@example.com');

      expect(result).toContain('.env.user_name');
      expect(result).toMatch(/user_name/);
    });

    it('should replace special characters with underscores', () => {
      mockExistsSync.mockReturnValue(true);

      const result = getEnvPath('u s\\e/r*name@example.com');

      expect(result).toMatch(/u_s_e_r_name/);
    });

    it('should create .eigent directory if it does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      getEnvPath('test@example.com');

      expect(mockMkdirSync).toHaveBeenCalledWith(eigentDir, {
        recursive: true,
      });
    });

    it('should NOT create .eigent directory if it already exists', () => {
      // First call: eigentDir exists
      mockExistsSync.mockReturnValue(true);

      getEnvPath('test@example.com');

      expect(mockMkdirSync).not.toHaveBeenCalled();
    });

    it('should copy default env and set permissions when user env does not exist', () => {
      // existsSync calls: 1) eigentDir → true, 2) envPath → false, 3) defaultEnv → true
      mockExistsSync
        .mockReturnValueOnce(true) // eigentDir exists
        .mockReturnValueOnce(false) // user env does not exist
        .mockReturnValueOnce(true); // default env exists

      const result = getEnvPath('user@example.com');

      expect(mockCopyFileSync).toHaveBeenCalled();
      expect(mockChmodSync).toHaveBeenCalledWith(result, 0o600);
    });

    it('should NOT copy default env when user env already exists', () => {
      // existsSync calls: 1) eigentDir → true, 2) user env → true
      mockExistsSync.mockReturnValue(true);

      getEnvPath('user@example.com');

      expect(mockCopyFileSync).not.toHaveBeenCalled();
      expect(mockChmodSync).not.toHaveBeenCalled();
    });

    it('should NOT copy default env when default env does not exist', () => {
      mockExistsSync
        .mockReturnValueOnce(true) // eigentDir
        .mockReturnValueOnce(false) // user env
        .mockReturnValueOnce(false); // default env

      getEnvPath('user@example.com');

      expect(mockCopyFileSync).not.toHaveBeenCalled();
    });

    it('should strip the domain part of the email', () => {
      mockExistsSync.mockReturnValue(true);

      const result = getEnvPath('alice@company.org');
      expect(result).not.toContain('company');
      expect(result).toMatch(/\.env\.alice$/);
    });
  });

  // -------------------------------------------------------------------------
  // getEmailFolderPath
  // -------------------------------------------------------------------------
  describe('getEmailFolderPath()', () => {
    const eigentDir = '/home/testuser/.eigent';

    it('should create user config directory if it does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      const result = getEmailFolderPath('user@example.com');

      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('user'),
        { recursive: true }
      );
      expect(result.tempEmail).toBe('user');
    });

    it('should sanitize email for folder name', () => {
      mockExistsSync.mockReturnValue(false);

      const result = getEmailFolderPath('my.user name@example.com');

      expect(result.tempEmail).toBe('my_user_name');
      expect(result.MCP_REMOTE_CONFIG_DIR).toContain('my_user_name');
    });

    it('should detect token file presence', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['myserver-token.json', 'other.txt']);

      const result = getEmailFolderPath('test@example.com');

      expect(result.hasToken).toBe(true);
    });

    it('should detect token absence', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['config.json', 'data.txt']);

      const result = getEmailFolderPath('test@example.com');

      expect(result.hasToken).toBe(false);
    });

    it('should handle readdirSync error gracefully (hasToken = false)', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation(() => {
        throw new Error('ENOENT');
      });

      const result = getEmailFolderPath('test@example.com');

      expect(result.hasToken).toBe(false);
    });

    it('should return correct directory paths', () => {
      mockExistsSync.mockReturnValue(false);

      const result = getEmailFolderPath('alice@example.com');

      expect(result.MCP_CONFIG_DIR).toBe(eigentDir);
      expect(result.MCP_REMOTE_CONFIG_DIR).toMatch(
        new RegExp(`^${eigentDir}/alice$`)
      );
    });
  });
});
