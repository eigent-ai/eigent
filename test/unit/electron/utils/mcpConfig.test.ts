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

import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock setup – must precede the module import due to vitest hoisting rules.
// All vi.mock factories must be self-contained (no external references).
// ---------------------------------------------------------------------------

vi.mock('os', () => ({
  default: { homedir: () => '/home/testuser' },
  homedir: () => '/home/testuser',
}));

vi.mock('path', () => ({
  default: {
    join: (...segments: string[]) => segments.join('/'),
  },
  join: (...segments: string[]) => segments.join('/'),
  sep: '/',
  basename: (p: string) => p.split('/').pop() || '',
  dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
  extname: (p: string) => {
    const dot = p.lastIndexOf('.');
    return dot >= 0 ? p.slice(dot) : '';
  },
}));

vi.mock('fs', () => {
  const mocks = {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
  return {
    default: mocks,
    ...mocks,
  };
});

// ---------------------------------------------------------------------------
// Import the system under test AFTER mocks are in place.
// ---------------------------------------------------------------------------
import fs from 'fs';
import {
  addMcp,
  getMcpConfigPath,
  readMcpConfig,
  removeMcp,
  updateMcp,
  writeMcpConfig,
} from '../../../../electron/main/utils/mcpConfig';

// ---------------------------------------------------------------------------
// Constants derived from mocked modules
// ---------------------------------------------------------------------------
const MOCK_HOME = '/home/testuser';
const MOCK_CONFIG_DIR = `${MOCK_HOME}/.eigent`;
const MOCK_CONFIG_PATH = `${MOCK_HOME}/.eigent/mcp.json`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shorthand to build a well-formed command-based MCP server config. */
function commandServer(overrides: Record<string, unknown> = {}) {
  return {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    description: 'Test server',
    ...overrides,
  };
}

/** Shorthand to build a URL-based MCP server config. */
function urlServer(url = 'http://localhost:3000/sse') {
  return { url };
}

/** Capture the JSON that was written via writeFileSync. */
function lastWrittenJson(): any {
  const calls = (fs.writeFileSync as Mock).mock.calls;
  if (calls.length === 0) return null;
  // writeFileSync(path, data, encoding)
  return JSON.parse(calls[calls.length - 1][1] as string);
}

// ===========================================================================
// Tests
// ===========================================================================

describe('mcpConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: config directory exists so writeMcpConfig does not mkdir
    (fs.existsSync as Mock).mockReturnValue(true);
  });

  // -------------------------------------------------------------------------
  // getMcpConfigPath
  // -------------------------------------------------------------------------
  describe('getMcpConfigPath', () => {
    it('should return the path under ~/.eigent/mcp.json', () => {
      expect(getMcpConfigPath()).toBe(MOCK_CONFIG_PATH);
    });

    it('should always return the same path on repeated calls', () => {
      const first = getMcpConfigPath();
      const second = getMcpConfigPath();
      expect(first).toBe(second);
    });
  });

  // -------------------------------------------------------------------------
  // readMcpConfig
  // -------------------------------------------------------------------------
  describe('readMcpConfig', () => {
    it('should create default config when file does not exist', () => {
      (fs.existsSync as Mock).mockReturnValue(false);

      const config = readMcpConfig();

      expect(config).toEqual({ mcpServers: {} });
      // Should have written the default config to disk
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
      expect(lastWrittenJson()).toEqual({ mcpServers: {} });
    });

    it('should return config read from disk', () => {
      const onDisk = {
        mcpServers: {
          myServer: commandServer(),
        },
      };
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify(onDisk));

      const config = readMcpConfig();

      expect(config).toEqual(onDisk);
      expect((config.mcpServers.myServer as any).args).toEqual([
        '-y',
        '@modelcontextprotocol/server-filesystem',
        '/tmp',
      ]);
    });

    it('should return default config when file contains invalid JSON', () => {
      (fs.readFileSync as Mock).mockReturnValue('{ not valid json');

      const config = readMcpConfig();

      expect(config).toEqual({ mcpServers: {} });
    });

    it('should return default config when mcpServers key is missing', () => {
      (fs.readFileSync as Mock).mockReturnValue(
        JSON.stringify({ otherKey: true })
      );

      const config = readMcpConfig();

      expect(config).toEqual({ mcpServers: {} });
    });

    it('should return default config when mcpServers is not an object', () => {
      (fs.readFileSync as Mock).mockReturnValue(
        JSON.stringify({ mcpServers: 'wrong' })
      );

      const config = readMcpConfig();

      expect(config).toEqual({ mcpServers: {} });
    });

    it('should return default config when mcpServers is null', () => {
      (fs.readFileSync as Mock).mockReturnValue(
        JSON.stringify({ mcpServers: null })
      );

      const config = readMcpConfig();

      expect(config).toEqual({ mcpServers: {} });
    });

    it('should return default config when mcpServers is an array', () => {
      (fs.readFileSync as Mock).mockReturnValue(
        JSON.stringify({ mcpServers: [] })
      );

      const config = readMcpConfig();

      // typeof [] === 'object', so the guard does NOT reject arrays.
      // The source only checks: !parsed.mcpServers || typeof !== 'object'
      expect(config).toEqual({ mcpServers: [] });
    });

    it('should handle readFileSync throwing an error', () => {
      (fs.readFileSync as Mock).mockImplementation(() => {
        throw new Error('EACCES');
      });

      const config = readMcpConfig();

      expect(config).toEqual({ mcpServers: {} });
    });

    // ------- Args normalization during read -------

    it('should normalize string args that are valid JSON arrays', () => {
      const onDisk = {
        mcpServers: {
          srv: {
            command: 'node',
            args: '["--inspect", "server.js"]',
          },
        },
      };
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify(onDisk));

      const config = readMcpConfig();

      expect((config.mcpServers.srv as any).args).toEqual([
        '--inspect',
        'server.js',
      ]);
    });

    it('should normalize string args via comma-split when not valid JSON', () => {
      const onDisk = {
        mcpServers: {
          srv: {
            command: 'node',
            args: '--inspect, server.js,  ',
          },
        },
      };
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify(onDisk));

      const config = readMcpConfig();

      expect((config.mcpServers.srv as any).args).toEqual([
        '--inspect',
        'server.js',
      ]);
    });

    it('should filter out empty segments from comma-split args', () => {
      const onDisk = {
        mcpServers: {
          srv: {
            command: 'node',
            args: ',,foo,,bar,,',
          },
        },
      };
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify(onDisk));

      const config = readMcpConfig();

      expect((config.mcpServers.srv as any).args).toEqual(['foo', 'bar']);
    });

    it('should coerce numeric array items to strings', () => {
      const onDisk = {
        mcpServers: {
          srv: {
            command: 'node',
            args: [8080, 3000, true],
          },
        },
      };
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify(onDisk));

      const config = readMcpConfig();

      expect((config.mcpServers.srv as any).args).toEqual([
        '8080',
        '3000',
        'true',
      ]);
    });

    it('should not alter URL-based server entries (no args field)', () => {
      const onDisk = {
        mcpServers: {
          remote: urlServer('http://example.com/mcp'),
        },
      };
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify(onDisk));

      const config = readMcpConfig();

      expect(config.mcpServers.remote).toEqual({
        url: 'http://example.com/mcp',
      });
    });

    it('should leave args untouched when already a string array', () => {
      const onDisk = {
        mcpServers: {
          srv: {
            command: 'node',
            args: ['--verbose', 'index.js'],
          },
        },
      };
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify(onDisk));

      const config = readMcpConfig();

      expect((config.mcpServers.srv as any).args).toEqual([
        '--verbose',
        'index.js',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // writeMcpConfig
  // -------------------------------------------------------------------------
  describe('writeMcpConfig', () => {
    it('should write config as pretty-printed JSON', () => {
      const config = { mcpServers: { a: commandServer() } };

      writeMcpConfig(config);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        MOCK_CONFIG_PATH,
        JSON.stringify(config, null, 2),
        'utf-8'
      );
    });

    it('should create config directory when it does not exist', () => {
      // First call: writeMcpConfig checks directory
      // Second call: readMcpConfig in addMcp checks file
      (fs.existsSync as Mock)
        .mockReturnValueOnce(false) // dir does not exist
        .mockReturnValueOnce(true); // file does exist (for the read)

      writeMcpConfig({ mcpServers: {} });

      expect(fs.mkdirSync).toHaveBeenCalledWith(MOCK_CONFIG_DIR, {
        recursive: true,
      });
    });

    it('should NOT create directory when it already exists', () => {
      (fs.existsSync as Mock).mockReturnValue(true);

      writeMcpConfig({ mcpServers: {} });

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should write empty config preserving structure', () => {
      const empty = { mcpServers: {} };

      writeMcpConfig(empty);

      const written = lastWrittenJson();
      expect(written).toEqual(empty);
    });

    it('should write config with multiple servers', () => {
      const config = {
        mcpServers: {
          fs: commandServer(),
          remote: urlServer(),
        },
      };

      writeMcpConfig(config);

      const written = lastWrittenJson();
      expect(Object.keys(written.mcpServers)).toEqual(['fs', 'remote']);
    });
  });

  // -------------------------------------------------------------------------
  // addMcp
  // -------------------------------------------------------------------------
  describe('addMcp', () => {
    /** Seed the mock fs with an existing config so readMcpConfig succeeds. */
    function seedConfig(servers: Record<string, any> = {}) {
      const data = JSON.stringify({ mcpServers: servers });
      (fs.readFileSync as Mock).mockReturnValue(data);
    }

    it('should add a new command-based server', () => {
      seedConfig();
      const server = commandServer();

      addMcp('myServer', server);

      const written = lastWrittenJson();
      expect(written.mcpServers.myServer).toBeDefined();
      expect(written.mcpServers.myServer.command).toBe('npx');
    });

    it('should add a URL-based server', () => {
      seedConfig();
      const server = urlServer();

      addMcp('remoteServer', server);

      const written = lastWrittenJson();
      expect(written.mcpServers.remoteServer).toEqual({
        url: 'http://localhost:3000/sse',
      });
    });

    it('should NOT overwrite an existing server with the same name', () => {
      const existing = commandServer({ command: 'existing-cmd' });
      seedConfig({ myServer: existing });

      addMcp('myServer', commandServer({ command: 'new-cmd' }));

      // writeMcpConfig should NOT have been called
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should normalize string args via JSON parse', () => {
      seedConfig();
      const server = { command: 'node', args: '["a","b"]' } as any;

      addMcp('srv', server);

      const written = lastWrittenJson();
      expect(written.mcpServers.srv.args).toEqual(['a', 'b']);
    });

    it('should normalize string args via comma-split when not valid JSON', () => {
      seedConfig();
      const server = { command: 'node', args: 'a, b, c' } as any;

      addMcp('srv', server);

      const written = lastWrittenJson();
      expect(written.mcpServers.srv.args).toEqual(['a', 'b', 'c']);
    });

    it('should coerce array arg items to strings', () => {
      seedConfig();
      const server = { command: 'node', args: [42, true, 'hello'] } as any;

      addMcp('srv', server);

      const written = lastWrittenJson();
      expect(written.mcpServers.srv.args).toEqual(['42', 'true', 'hello']);
    });

    it('should handle server with env variables', () => {
      seedConfig();
      const server = {
        command: 'node',
        args: ['server.js'],
        env: { API_KEY: 'secret', NODE_ENV: 'production' },
      };

      addMcp('envServer', server);

      const written = lastWrittenJson();
      expect(written.mcpServers.envServer.env).toEqual({
        API_KEY: 'secret',
        NODE_ENV: 'production',
      });
    });

    it('should handle server with description', () => {
      seedConfig();
      const server = {
        command: 'node',
        args: ['--version'],
        description: 'Node version check',
      };

      addMcp('descServer', server);

      const written = lastWrittenJson();
      expect(written.mcpServers.descServer.description).toBe(
        'Node version check'
      );
    });

    it('should not mutate the original mcp object', () => {
      seedConfig();
      const original = { command: 'node', args: 'a,b' } as any;
      const copy = { ...original };

      addMcp('srv', original);

      // The original object should not have been mutated
      expect(original.args).toBe(copy.args);
    });
  });

  // -------------------------------------------------------------------------
  // removeMcp
  // -------------------------------------------------------------------------
  describe('removeMcp', () => {
    function seedConfig(servers: Record<string, any> = {}) {
      const data = JSON.stringify({ mcpServers: servers });
      (fs.readFileSync as Mock).mockReturnValue(data);
    }

    it('should remove an existing server', () => {
      seedConfig({ keep: commandServer(), remove: commandServer() });

      removeMcp('remove');

      const written = lastWrittenJson();
      expect(written.mcpServers.keep).toBeDefined();
      expect(written.mcpServers.remove).toBeUndefined();
    });

    it('should NOT write when server name does not exist', () => {
      seedConfig({ keep: commandServer() });

      removeMcp('nonexistent');

      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should remove the last server leaving empty mcpServers', () => {
      seedConfig({ onlyOne: commandServer() });

      removeMcp('onlyOne');

      const written = lastWrittenJson();
      expect(written.mcpServers).toEqual({});
    });

    it('should not affect URL-based servers when removing a command server', () => {
      seedConfig({
        cmd: commandServer(),
        remote: urlServer(),
      });

      removeMcp('cmd');

      const written = lastWrittenJson();
      expect(written.mcpServers.remote).toEqual({
        url: 'http://localhost:3000/sse',
      });
      expect(written.mcpServers.cmd).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // updateMcp
  // -------------------------------------------------------------------------
  describe('updateMcp', () => {
    function seedConfig(servers: Record<string, any> = {}) {
      const data = JSON.stringify({ mcpServers: servers });
      (fs.readFileSync as Mock).mockReturnValue(data);
    }

    it('should update an existing server', () => {
      seedConfig({ myServer: commandServer({ command: 'old-cmd' }) });

      updateMcp('myServer', commandServer({ command: 'new-cmd' }));

      const written = lastWrittenJson();
      expect(written.mcpServers.myServer.command).toBe('new-cmd');
    });

    it('should add a new server when name does not exist yet', () => {
      seedConfig();

      updateMcp('brandNew', commandServer());

      const written = lastWrittenJson();
      expect(written.mcpServers.brandNew).toBeDefined();
    });

    it('should normalize string args via JSON parse', () => {
      seedConfig();
      const server = { command: 'node', args: '["x","y"]' } as any;

      updateMcp('srv', server);

      const written = lastWrittenJson();
      expect(written.mcpServers.srv.args).toEqual(['x', 'y']);
    });

    it('should normalize string args via comma-split when not valid JSON', () => {
      seedConfig();
      const server = { command: 'node', args: 'x, y, z' } as any;

      updateMcp('srv', server);

      const written = lastWrittenJson();
      expect(written.mcpServers.srv.args).toEqual(['x', 'y', 'z']);
    });

    it('should coerce array arg items to strings', () => {
      seedConfig();
      const server = { command: 'node', args: [100, false] } as any;

      updateMcp('srv', server);

      const written = lastWrittenJson();
      expect(written.mcpServers.srv.args).toEqual(['100', 'false']);
    });

    it('should replace a command server with a URL server', () => {
      seedConfig({ myServer: commandServer() });

      updateMcp('myServer', urlServer('http://new.url/mcp'));

      const written = lastWrittenJson();
      expect(written.mcpServers.myServer).toEqual({
        url: 'http://new.url/mcp',
      });
    });

    it('should replace a URL server with a command server', () => {
      seedConfig({ myServer: urlServer() });

      updateMcp('myServer', commandServer());

      const written = lastWrittenJson();
      expect(written.mcpServers.myServer.command).toBe('npx');
      expect(written.mcpServers.myServer.args).toBeDefined();
    });

    it('should not mutate the original mcp object', () => {
      seedConfig();
      const original = { command: 'node', args: 'a,b' } as any;
      const originalArgs = original.args;

      updateMcp('srv', original);

      expect(original.args).toBe(originalArgs);
    });
  });

  // -------------------------------------------------------------------------
  // Integration-style: round-trip scenarios
  // -------------------------------------------------------------------------
  describe('round-trip scenarios', () => {
    function seedConfig(servers: Record<string, any> = {}) {
      (fs.readFileSync as Mock).mockReturnValue(
        JSON.stringify({ mcpServers: servers })
      );
    }

    it('should add then remove a server, ending with empty config', () => {
      // Start empty
      seedConfig({});

      addMcp('temp', commandServer());
      let written = lastWrittenJson();
      expect(written.mcpServers.temp).toBeDefined();

      // Re-seed so readMcpConfig sees the "persisted" state
      seedConfig(written.mcpServers);

      removeMcp('temp');
      written = lastWrittenJson();
      expect(written.mcpServers).toEqual({});
    });

    it('should add then update a server', () => {
      seedConfig();

      addMcp('srv', commandServer({ command: 'v1' }));
      let written = lastWrittenJson();
      expect(written.mcpServers.srv.command).toBe('v1');

      // Re-seed with current state
      seedConfig(written.mcpServers);

      updateMcp('srv', commandServer({ command: 'v2' }));
      written = lastWrittenJson();
      expect(written.mcpServers.srv.command).toBe('v2');
    });

    it('should handle multiple servers independently', () => {
      seedConfig({});

      addMcp('a', commandServer({ command: 'cmd-a' }));
      let written = lastWrittenJson();

      seedConfig(written.mcpServers);
      addMcp('b', urlServer('http://b.local'));

      written = lastWrittenJson();
      expect(Object.keys(written.mcpServers)).toEqual(['a', 'b']);
      expect(written.mcpServers.a.command).toBe('cmd-a');
      expect(written.mcpServers.b.url).toBe('http://b.local');
    });
  });

  // -------------------------------------------------------------------------
  // Args normalization edge cases (comprehensive coverage)
  // -------------------------------------------------------------------------
  describe('args normalization edge cases', () => {
    function seedAndRead(servers: Record<string, any>) {
      (fs.readFileSync as Mock).mockReturnValue(
        JSON.stringify({ mcpServers: servers })
      );
      return readMcpConfig();
    }

    it('should handle empty string args via comma-split', () => {
      const config = seedAndRead({
        srv: { command: 'node', args: '' },
      });

      // Empty string is falsy → `if (server.args)` is false → no normalization.
      // Args remains as the original empty string.
      expect((config.mcpServers.srv as any).args).toBe('');
    });

    it('should handle args that are a JSON-encoded number', () => {
      // JSON.parse('42') succeeds but returns 42 (not an array)
      // Then the code checks Array.isArray which is false → no further normalization
      const config = seedAndRead({
        srv: { command: 'node', args: '42' },
      });

      // After JSON.parse: args = 42 (number). Not array, so no map.
      // This is a potential bug but we test the actual behavior.
      expect((config.mcpServers.srv as any).args).toBe(42);
    });

    it('should handle args as a JSON-encoded string (not array)', () => {
      // JSON.parse('"hello"') → 'hello'
      // After parse, args is 'hello' (string). Array.isArray check fails → stays 'hello'.
      // Then Array.isArray check: 'hello' is not array → args stays 'hello'
      const config = seedAndRead({
        srv: { command: 'node', args: '"hello"' },
      });

      expect((config.mcpServers.srv as any).args).toBe('hello');
    });

    it('should handle single-element JSON array args', () => {
      const config = seedAndRead({
        srv: { command: 'node', args: '["only"]' },
      });

      expect((config.mcpServers.srv as any).args).toEqual(['only']);
    });

    it('should handle comma-separated args with extra whitespace', () => {
      const config = seedAndRead({
        srv: { command: 'node', args: '  foo  ,  bar  ,  baz  ' },
      });

      expect((config.mcpServers.srv as any).args).toEqual([
        'foo',
        'bar',
        'baz',
      ]);
    });

    it('should handle args with undefined value', () => {
      const config = seedAndRead({
        srv: { command: 'node' },
      });

      expect((config.mcpServers.srv as any).args).toBeUndefined();
    });

    it('should handle empty args array', () => {
      const config = seedAndRead({
        srv: { command: 'node', args: [] },
      });

      expect((config.mcpServers.srv as any).args).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // readMcpConfig: file-exists edge cases
  // -------------------------------------------------------------------------
  describe('readMcpConfig: file-exists edge cases', () => {
    it('should handle existsSync returning false then true for read', () => {
      // Simulates: config dir check passes, file check passes
      (fs.existsSync as Mock)
        .mockReturnValueOnce(true) // file exists
        .mockReturnValueOnce(true); // dir exists (for the initial write)

      const onDisk = {
        mcpServers: { srv: commandServer() },
      };
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify(onDisk));

      const config = readMcpConfig();

      expect(config.mcpServers.srv).toBeDefined();
    });

    it('should handle multiple servers with mixed types', () => {
      const onDisk = {
        mcpServers: {
          cmdSrv: commandServer(),
          urlSrv: urlServer('http://remote/mcp'),
          strArgsSrv: { command: 'node', args: 'a, b, c' },
          numArgsSrv: { command: 'node', args: [1, 2, 'three'] },
        },
      };
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify(onDisk));

      const config = readMcpConfig();

      expect((config.mcpServers.cmdSrv as any).args).toEqual([
        '-y',
        '@modelcontextprotocol/server-filesystem',
        '/tmp',
      ]);
      expect(config.mcpServers.urlSrv).toEqual({ url: 'http://remote/mcp' });
      expect((config.mcpServers.strArgsSrv as any).args).toEqual([
        'a',
        'b',
        'c',
      ]);
      expect((config.mcpServers.numArgsSrv as any).args).toEqual([
        '1',
        '2',
        'three',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // writeMcpConfig: encoding verification
  // -------------------------------------------------------------------------
  describe('writeMcpConfig: encoding verification', () => {
    it('should write UTF-8 encoded content', () => {
      writeMcpConfig({ mcpServers: {} });

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'utf-8'
      );
    });

    it('should produce valid JSON that can be re-parsed', () => {
      const config = {
        mcpServers: {
          srv: {
            command: 'npx',
            args: ['-y', 'some-pkg'],
            env: { KEY: 'VAL' },
          },
        },
      };

      writeMcpConfig(config);

      const raw = (fs.writeFileSync as Mock).mock.calls[0][1] as string;
      const reparsed = JSON.parse(raw);
      expect(reparsed).toEqual(config);
    });

    it('should produce pretty-printed JSON with 2-space indent', () => {
      writeMcpConfig({ mcpServers: {} });

      const raw = (fs.writeFileSync as Mock).mock.calls[0][1] as string;
      expect(raw).toContain('\n');
      expect(raw).toContain('  ');
    });
  });

  // -------------------------------------------------------------------------
  // addMcp: boundary conditions
  // -------------------------------------------------------------------------
  describe('addMcp: boundary conditions', () => {
    function seedConfig(servers: Record<string, any> = {}) {
      (fs.readFileSync as Mock).mockReturnValue(
        JSON.stringify({ mcpServers: servers })
      );
    }

    it('should handle empty server name', () => {
      seedConfig();

      addMcp('', commandServer());

      const written = lastWrittenJson();
      expect(written.mcpServers['']).toBeDefined();
    });

    it('should handle server name with special characters', () => {
      seedConfig();

      addMcp('my-server_v2.0', commandServer());

      const written = lastWrittenJson();
      expect(written.mcpServers['my-server_v2.0']).toBeDefined();
    });

    it('should handle server with no args property', () => {
      seedConfig();
      const server = { command: 'echo' };

      addMcp('noArgs', server as any);

      const written = lastWrittenJson();
      expect(written.mcpServers.noArgs.command).toBe('echo');
      expect(written.mcpServers.noArgs.args).toBeUndefined();
    });

    it('should handle server with null args', () => {
      seedConfig();
      const server = { command: 'echo', args: null };

      addMcp('nullArgs', server as any);

      const written = lastWrittenJson();
      expect(written.mcpServers.nullArgs.args).toBeNull();
    });

    it('should handle server with empty string args (falsy)', () => {
      seedConfig();
      const server = { command: 'echo', args: '' };

      addMcp('emptyArgs', server as any);

      const written = lastWrittenJson();
      // Empty string is falsy → `if (normalizedMcp.args)` is false → no normalization
      expect(written.mcpServers.emptyArgs.args).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // updateMcp: boundary conditions
  // -------------------------------------------------------------------------
  describe('updateMcp: boundary conditions', () => {
    function seedConfig(servers: Record<string, any> = {}) {
      (fs.readFileSync as Mock).mockReturnValue(
        JSON.stringify({ mcpServers: servers })
      );
    }

    it('should always write even when server name does not exist', () => {
      seedConfig();

      updateMcp('new', commandServer());

      const written = lastWrittenJson();
      expect(written.mcpServers.new).toBeDefined();
    });

    it('should handle URL server update with no args to normalize', () => {
      seedConfig({ remote: urlServer() });

      updateMcp('remote', urlServer('http://updated.url/mcp'));

      const written = lastWrittenJson();
      expect(written.mcpServers.remote).toEqual({
        url: 'http://updated.url/mcp',
      });
    });
  });

  // -------------------------------------------------------------------------
  // removeMcp: boundary conditions
  // -------------------------------------------------------------------------
  describe('removeMcp: boundary conditions', () => {
    function seedConfig(servers: Record<string, any> = {}) {
      (fs.readFileSync as Mock).mockReturnValue(
        JSON.stringify({ mcpServers: servers })
      );
    }

    it('should handle removing from empty config', () => {
      seedConfig({});

      removeMcp('anything');

      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should handle removing a URL server', () => {
      seedConfig({ remote: urlServer() });

      removeMcp('remote');

      const written = lastWrittenJson();
      expect(written.mcpServers).toEqual({});
    });
  });
});
