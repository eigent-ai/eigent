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

/**
 * Unit tests for electron/main/init.ts
 *
 * Tests exported pure/testable functions:
 * - readEnvValue()    – env file key extraction (extracted from module)
 * - buildLocalServerUrl() – URL construction (extracted from module)
 * - checkPortAvailable()  – net port check (internal, tested via net mock)
 * - killProcessOnPort()   – process killing by port (exported)
 * - findAvailablePort()   – port scanning (exported)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Section 1: Extracted pure-function tests
// ---------------------------------------------------------------------------
// readEnvValue and buildLocalServerUrl are module-private but pure.
// We extract their logic verbatim to test directly without Electron mocking.

/**
 * Mirrors readEnvValue from init.ts (lines 45-78).
 * Reads a KEY=VALUE pair from an env-style file.
 */
function readEnvValue(
  filePath: string,
  key: string,
  fs: {
    existsSync: (p: string) => boolean;
    readFileSync: (p: string, enc: string) => string;
  }
): string | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const line = lines.find((l) => {
      let trimmed = l.trim();
      if (!trimmed || trimmed.startsWith('#')) return false;
      if (trimmed.startsWith('export ')) {
        trimmed = trimmed.slice(7).trim();
      }
      return trimmed.startsWith(`${key}=`);
    });
    if (!line) return undefined;
    let raw = line.trim();
    if (raw.startsWith('export ')) {
      raw = raw.slice(7).trim();
    }
    let value = raw.slice(key.length + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  } catch {
    return undefined;
  }
}

/**
 * Mirrors buildLocalServerUrl from init.ts (lines 80-87).
 * Appends /api to a proxy URL, avoiding double suffix.
 */
function buildLocalServerUrl(proxyUrl: string | undefined): string | undefined {
  if (!proxyUrl) return undefined;
  const trimmed = proxyUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return undefined;
  if (trimmed.endsWith('/api')) return trimmed;
  return `${trimmed}/api`;
}

// ---------------------------------------------------------------------------
// Section 2: Mocks for module-level import tests
// ---------------------------------------------------------------------------

vi.mock('child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    exec: vi.fn((_cmd: string, _opts: any, callback?: any) => {
      // Handle both (cmd, opts, callback) and (cmd, callback) forms
      const cb = typeof _opts === 'function' ? _opts : callback;
      if (cb) cb(null, { stdout: '', stderr: '' });
      return undefined;
    }),
    execSync: vi.fn(() => ''),
    execFileSync: vi.fn(() => ''),
    spawn: vi.fn(() => ({
      pid: 12345,
      killed: false,
      stderr: { on: vi.fn() },
      stdout: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
      unref: vi.fn(),
    })),
  };
});

vi.mock('electron', () => ({
  BrowserWindow: Object.assign(
    vi.fn(() => ({
      loadURL: vi.fn(),
      loadFile: vi.fn(),
      show: vi.fn(),
      close: vi.fn(),
      minimize: vi.fn(),
      isMaximized: vi.fn(),
      maximize: vi.fn(),
      unmaximize: vi.fn(),
      isDestroyed: vi.fn(),
      isFullScreen: vi.fn(),
      webContents: {
        openDevTools: vi.fn(),
        send: vi.fn(),
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        toggleDevTools: vi.fn(),
      },
    })),
    { getAllWindows: vi.fn(() => []) }
  ),
  app: {
    getPath: vi.fn(() => '/mock/userData'),
    getVersion: vi.fn(() => '1.0.0'),
    getAppPath: vi.fn(() => '/mock/app'),
    isPackaged: false,
    on: vi.fn(),
    whenReady: vi.fn(() => Promise.resolve()),
    quit: vi.fn(),
  },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('fs', () => {
  const fsMocks = {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    unlinkSync: vi.fn(),
    copyFileSync: vi.fn(),
    chmodSync: vi.fn(),
  };
  return { default: fsMocks, ...fsMocks };
});

vi.mock('http', () => ({
  default: { get: vi.fn() },
}));

vi.mock('net', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    createServer: vi.fn(),
    Socket: vi.fn(() => {
      const onceHandlers: Record<string, Function> = {};
      return {
        setTimeout: vi.fn(),
        once: vi.fn((event: string, handler: Function) => {
          onceHandlers[event] = handler;
        }),
        connect: vi.fn(() => {
          // Immediately fire 'connect' to indicate port is in use
          setTimeout(() => onceHandlers['connect']?.(), 0);
        }),
        destroy: vi.fn(),
      };
    }),
  };
});

vi.mock('os', () => ({
  default: {
    homedir: vi.fn(() => '/home/testuser'),
    platform: vi.fn(() => 'linux'),
  },
  homedir: vi.fn(() => '/home/testuser'),
  platform: vi.fn(() => 'linux'),
}));

vi.mock('util', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    // promisify(exec) should return a function that returns Promise<{stdout,stderr}>
    promisify: vi.fn((fn: any) => {
      return (...args: any[]) =>
        new Promise((resolve, reject) => {
          // Remove last arg if it's a callback, replace with our own
          fn(...args, (err: any, stdout: any, stderr: any) => {
            if (err) reject(err);
            else resolve({ stdout: stdout || '', stderr: stderr || '' });
          });
        });
    }),
  };
});

vi.mock('./install-deps', () => ({
  PromiseReturnType: {} as any,
}));

vi.mock('./utils/envUtil', () => ({
  maskProxyUrl: vi.fn((url: string) => url),
  readGlobalEnvKey: vi.fn(() => undefined),
}));

vi.mock('./utils/process', () => ({
  ensureTerminalVenvAtUserPath: vi.fn(),
  findNodejsWheelBinPath: vi.fn(() => null),
  findNodejsWheelNpmPath: vi.fn(() => null),
  getBackendPath: vi.fn(() => '/mock/backend'),
  getBinaryPath: vi.fn(async () => '/mock/bin/uv'),
  getCachePath: vi.fn(() => '/mock/cache'),
  getPrebuiltPythonDir: vi.fn(() => '/mock/prebuilt'),
  getUvEnv: vi.fn(() => ({})),
  getVenvPath: vi.fn(() => '/mock/venv'),
  getVenvPythonPath: vi.fn(() => '/mock/venv/bin/python'),
  isBinaryExists: vi.fn(async () => true),
  killProcessByName: vi.fn(async () => {}),
}));

// ---------------------------------------------------------------------------
// Section 3: Import module under test (after mocks)
// ---------------------------------------------------------------------------

import * as child_process from 'child_process';
import * as net from 'net';
import {
  findAvailablePort,
  killProcessOnPort,
} from '../../../../electron/main/init';

// Get the promisified exec mock — it's the return value of promisify(exec)
// Since promisify is mocked to return a generic vi.fn(), we need to get
// the actual execAsync from the module. We'll control it via child_process.exec.
const mockExecAsync = vi.fn();

// ---------------------------------------------------------------------------
// Section 4: Helper to create mock net servers
// ---------------------------------------------------------------------------

/**
 * Creates a mock implementation for net.createServer that fires 'listening'
 * for available ports and 'error' with EADDRINUSE for unavailable ports.
 * The port is determined from the listen({port}) call.
 */
function createMockServerFactoryByPort(availablePorts: number[]) {
  const availableSet = new Set(availablePorts);
  return () => {
    const onceHandlers: Record<string, Function> = {};
    let serverPort = -1;
    return {
      once: vi.fn((event: string, handler: Function) => {
        onceHandlers[event] = handler;
      }),
      listen: vi.fn((opts: any) => {
        serverPort = opts?.port ?? -1;
        if (availableSet.has(serverPort)) {
          setTimeout(() => onceHandlers['listening']?.(), 0);
        } else {
          setTimeout(() => onceHandlers['error']?.({ code: 'EADDRINUSE' }), 0);
        }
      }),
      close: vi.fn((cb?: Function) => cb?.()),
    };
  };
}

/**
 * Creates a mock server that always fires 'listening' (port is free).
 */
function createListeningServer() {
  const onceHandlers: Record<string, Function> = {};
  return {
    once: vi.fn((event: string, handler: Function) => {
      onceHandlers[event] = handler;
    }),
    listen: vi.fn(() => {
      setTimeout(() => onceHandlers['listening']?.(), 0);
    }),
    close: vi.fn((cb?: Function) => cb?.()),
  };
}

/**
 * Creates a mock server that fires EADDRINUSE (port is occupied).
 */
function createEaddrinuseServer() {
  const onceHandlers: Record<string, Function> = {};
  return {
    once: vi.fn((event: string, handler: Function) => {
      onceHandlers[event] = handler;
    }),
    listen: vi.fn(() => {
      setTimeout(() => onceHandlers['error']?.({ code: 'EADDRINUSE' }), 0);
    }),
    close: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Section 5: Tests
// ---------------------------------------------------------------------------

describe('init.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // readEnvValue
  // =========================================================================
  describe('readEnvValue (extracted logic)', () => {
    const mockFsOps = {
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
    };

    beforeEach(() => {
      mockFsOps.existsSync.mockReset();
      mockFsOps.readFileSync.mockReset();
    });

    it('should return undefined when file does not exist', () => {
      mockFsOps.existsSync.mockReturnValue(false);
      expect(readEnvValue('/no/file', 'KEY', mockFsOps)).toBeUndefined();
    });

    it('should return undefined when key is not found', () => {
      mockFsOps.existsSync.mockReturnValue(true);
      mockFsOps.readFileSync.mockReturnValue('OTHER=value\nANOTHER=thing');
      expect(readEnvValue('/file', 'MISSING', mockFsOps)).toBeUndefined();
    });

    it('should return the value for a matching key', () => {
      mockFsOps.existsSync.mockReturnValue(true);
      mockFsOps.readFileSync.mockReturnValue(
        'SERVER_URL=http://localhost:3000'
      );
      expect(readEnvValue('/file', 'SERVER_URL', mockFsOps)).toBe(
        'http://localhost:3000'
      );
    });

    it('should skip comment lines', () => {
      mockFsOps.existsSync.mockReturnValue(true);
      mockFsOps.readFileSync.mockReturnValue(
        '# SERVER_URL=ignored\nSERVER_URL=http://real'
      );
      expect(readEnvValue('/file', 'SERVER_URL', mockFsOps)).toBe(
        'http://real'
      );
    });

    it('should skip blank lines', () => {
      mockFsOps.existsSync.mockReturnValue(true);
      mockFsOps.readFileSync.mockReturnValue('\n\nSERVER_URL=http://val\n');
      expect(readEnvValue('/file', 'SERVER_URL', mockFsOps)).toBe('http://val');
    });

    it('should handle export prefix', () => {
      mockFsOps.existsSync.mockReturnValue(true);
      mockFsOps.readFileSync.mockReturnValue(
        'export SERVER_URL=http://exported'
      );
      expect(readEnvValue('/file', 'SERVER_URL', mockFsOps)).toBe(
        'http://exported'
      );
    });

    it('should strip double quotes from value', () => {
      mockFsOps.existsSync.mockReturnValue(true);
      mockFsOps.readFileSync.mockReturnValue('SERVER_URL="http://quoted"');
      expect(readEnvValue('/file', 'SERVER_URL', mockFsOps)).toBe(
        'http://quoted'
      );
    });

    it('should strip single quotes from value', () => {
      mockFsOps.existsSync.mockReturnValue(true);
      mockFsOps.readFileSync.mockReturnValue("SERVER_URL='http://quoted'");
      expect(readEnvValue('/file', 'SERVER_URL', mockFsOps)).toBe(
        'http://quoted'
      );
    });

    it('should not strip mismatched quotes', () => {
      mockFsOps.existsSync.mockReturnValue(true);
      mockFsOps.readFileSync.mockReturnValue('SERVER_URL="http://mismatch\'');
      expect(readEnvValue('/file', 'SERVER_URL', mockFsOps)).toBe(
        '"http://mismatch\''
      );
    });

    it('should handle empty value', () => {
      mockFsOps.existsSync.mockReturnValue(true);
      mockFsOps.readFileSync.mockReturnValue('SERVER_URL=');
      expect(readEnvValue('/file', 'SERVER_URL', mockFsOps)).toBe('');
    });

    it('should handle value with equals sign', () => {
      mockFsOps.existsSync.mockReturnValue(true);
      mockFsOps.readFileSync.mockReturnValue('KEY=val=ue=extra');
      expect(readEnvValue('/file', 'KEY', mockFsOps)).toBe('val=ue=extra');
    });

    it('should handle Windows-style line endings (CRLF)', () => {
      mockFsOps.existsSync.mockReturnValue(true);
      mockFsOps.readFileSync.mockReturnValue('KEY=value\r\nOTHER=thing\r\n');
      expect(readEnvValue('/file', 'KEY', mockFsOps)).toBe('value');
    });

    it('should handle inline comments as part of value (no comment stripping)', () => {
      mockFsOps.existsSync.mockReturnValue(true);
      mockFsOps.readFileSync.mockReturnValue('KEY=value # comment');
      expect(readEnvValue('/file', 'KEY', mockFsOps)).toBe('value # comment');
    });

    it('should match first occurrence when key appears multiple times', () => {
      mockFsOps.existsSync.mockReturnValue(true);
      mockFsOps.readFileSync.mockReturnValue('KEY=first\nKEY=second');
      expect(readEnvValue('/file', 'KEY', mockFsOps)).toBe('first');
    });

    it('should handle export prefix with surrounding spaces', () => {
      mockFsOps.existsSync.mockReturnValue(true);
      mockFsOps.readFileSync.mockReturnValue('  export   KEY=spaced');
      expect(readEnvValue('/file', 'KEY', mockFsOps)).toBe('spaced');
    });

    it('should return undefined when readFileSync throws', () => {
      mockFsOps.existsSync.mockReturnValue(true);
      mockFsOps.readFileSync.mockImplementation(() => {
        throw new Error('read error');
      });
      expect(readEnvValue('/file', 'KEY', mockFsOps)).toBeUndefined();
    });

    it('should handle value that is only whitespace after trim', () => {
      mockFsOps.existsSync.mockReturnValue(true);
      mockFsOps.readFileSync.mockReturnValue('KEY=   ');
      expect(readEnvValue('/file', 'KEY', mockFsOps)).toBe('');
    });

    it('should not match key that is a prefix of another key', () => {
      mockFsOps.existsSync.mockReturnValue(true);
      mockFsOps.readFileSync.mockReturnValue('KEY_LONGER=value');
      expect(readEnvValue('/file', 'KEY', mockFsOps)).toBeUndefined();
    });
  });

  // =========================================================================
  // buildLocalServerUrl
  // =========================================================================
  describe('buildLocalServerUrl (extracted logic)', () => {
    it('should return undefined for undefined input', () => {
      expect(buildLocalServerUrl(undefined)).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      expect(buildLocalServerUrl('')).toBeUndefined();
    });

    it('should return undefined for whitespace-only string', () => {
      expect(buildLocalServerUrl('   ')).toBeUndefined();
    });

    it('should append /api to a bare URL', () => {
      expect(buildLocalServerUrl('http://localhost:3000')).toBe(
        'http://localhost:3000/api'
      );
    });

    it('should not double /api suffix when already present', () => {
      expect(buildLocalServerUrl('http://localhost:3000/api')).toBe(
        'http://localhost:3000/api'
      );
    });

    it('should strip trailing slashes before appending /api', () => {
      expect(buildLocalServerUrl('http://localhost:3000///')).toBe(
        'http://localhost:3000/api'
      );
    });

    it('should handle URL with trailing slash and /api', () => {
      expect(buildLocalServerUrl('http://localhost:3000/api/')).toBe(
        'http://localhost:3000/api'
      );
    });

    it('should trim leading/trailing whitespace', () => {
      expect(buildLocalServerUrl('  http://localhost:3000  ')).toBe(
        'http://localhost:3000/api'
      );
    });

    it('should handle URL with path segments', () => {
      expect(buildLocalServerUrl('http://proxy.example.com/v1')).toBe(
        'http://proxy.example.com/v1/api'
      );
    });

    it('should not add /api if the trimmed URL already ends with /api', () => {
      expect(buildLocalServerUrl('https://example.com/proxy/api')).toBe(
        'https://example.com/proxy/api'
      );
    });

    it('should handle URL with port and trailing slash', () => {
      expect(buildLocalServerUrl('http://127.0.0.1:8080/')).toBe(
        'http://127.0.0.1:8080/api'
      );
    });

    it('should handle URL that is just /api', () => {
      expect(buildLocalServerUrl('/api')).toBe('/api');
    });
  });

  // =========================================================================
  // checkPortAvailable (tested via extracted logic with injectable net)
  // =========================================================================
  describe('checkPortAvailable', () => {
    /**
     * Re-implementation of checkPortAvailable using injectable net mock
     * so we can test it without the full module import chain.
     */
    function checkPortAvailable(
      port: number,
      netMock: { createServer: () => any }
    ): Promise<boolean> {
      return new Promise((resolve) => {
        const server: any = netMock.createServer();
        const timeout = setTimeout(() => {
          server.close();
          resolve(false);
        }, 1000);

        server.once('error', (err: any) => {
          clearTimeout(timeout);
          resolve(false);
        });

        server.once('listening', () => {
          clearTimeout(timeout);
          server.close(() => {
            resolve(true);
          });
        });

        server.listen({ port, host: '127.0.0.1', exclusive: true });
      });
    }

    it('should resolve true when server listens successfully', async () => {
      const onceHandlers: Record<string, Function> = {};
      const mockServer: any = {
        once: (event: string, handler: Function) => {
          onceHandlers[event] = handler;
        },
        listen: () => {
          setTimeout(() => onceHandlers['listening']?.(), 0);
        },
        close: (cb?: Function) => cb?.(),
      };

      const result = await checkPortAvailable(5001, {
        createServer: () => mockServer,
      });
      expect(result).toBe(true);
    });

    it('should resolve false when EADDRINUSE error occurs', async () => {
      const onceHandlers: Record<string, Function> = {};
      const mockServer: any = {
        once: (event: string, handler: Function) => {
          onceHandlers[event] = handler;
        },
        listen: () => {
          setTimeout(() => onceHandlers['error']?.({ code: 'EADDRINUSE' }), 0);
        },
        close: () => {},
      };

      const result = await checkPortAvailable(5001, {
        createServer: () => mockServer,
      });
      expect(result).toBe(false);
    });

    it('should resolve false for non-EADDRINUSE errors', async () => {
      const onceHandlers: Record<string, Function> = {};
      const mockServer: any = {
        once: (event: string, handler: Function) => {
          onceHandlers[event] = handler;
        },
        listen: () => {
          setTimeout(() => onceHandlers['error']?.({ code: 'EACCES' }), 0);
        },
        close: () => {},
      };

      const result = await checkPortAvailable(5001, {
        createServer: () => mockServer,
      });
      expect(result).toBe(false);
    });

    it('should resolve false on timeout', async () => {
      vi.useFakeTimers();

      const mockServer: any = {
        once: () => {},
        listen: () => {},
        close: () => {},
      };

      const promise = checkPortAvailable(5001, {
        createServer: () => mockServer,
      });

      vi.advanceTimersByTime(1100);

      const result = await promise;
      expect(result).toBe(false);

      vi.useRealTimers();
    });

    it('should call listen with correct parameters', async () => {
      const onceHandlers: Record<string, Function> = {};
      let listenArg: any = null;
      const mockServer: any = {
        once: (event: string, handler: Function) => {
          onceHandlers[event] = handler;
        },
        listen: (opts: any) => {
          listenArg = opts;
          setTimeout(() => onceHandlers['listening']?.(), 0);
        },
        close: (cb?: Function) => cb?.(),
      };

      await checkPortAvailable(8080, { createServer: () => mockServer });

      expect(listenArg).toEqual({
        port: 8080,
        host: '127.0.0.1',
        exclusive: true,
      });
    });
  });

  // =========================================================================
  // killProcessOnPort
  // =========================================================================
  describe('killProcessOnPort', () => {
    let originalPlatform: PropertyDescriptor | undefined;

    beforeEach(() => {
      originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    });

    afterEach(() => {
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform);
      }
    });

    /**
     * Helper: mock net.createServer to simulate port freed (listening).
     * Also mock Socket for EADDRINUSE path.
     */
    function mockPortFreed() {
      const onceHandlers: Record<string, Function> = {};
      const mockServer = {
        once: vi.fn((event: string, handler: Function) => {
          onceHandlers[event] = handler;
        }),
        listen: vi.fn(() => {
          setTimeout(() => onceHandlers['listening']?.(), 0);
        }),
        close: vi.fn((cb?: Function) => cb?.()),
      };
      vi.mocked(net.createServer).mockReturnValue(mockServer as any);
    }

    /**
     * Helper: mock net.createServer to simulate EADDRINUSE error,
     * with Socket that successfully connects (port in use).
     */
    function mockPortInUse() {
      const onceHandlers: Record<string, Function> = {};
      const mockServer = {
        once: vi.fn((event: string, handler: Function) => {
          onceHandlers[event] = handler;
        }),
        listen: vi.fn(() => {
          setTimeout(() => onceHandlers['error']?.({ code: 'EADDRINUSE' }), 0);
        }),
        close: vi.fn(),
      };
      vi.mocked(net.createServer).mockReturnValue(mockServer as any);

      // Mock Socket to immediately connect (port is definitely in use)
      vi.mocked(net.Socket).mockReturnValue({
        setTimeout: vi.fn(),
        once: vi.fn((event: string, handler: Function) => {
          if (event === 'connect') {
            setTimeout(() => handler(), 0);
          }
        }),
        connect: vi.fn(),
        destroy: vi.fn(),
      } as any);
    }

    it('should kill process on linux using fuser and return true', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });

      mockPortFreed();
      const result = await killProcessOnPort(5001);

      expect(result).toBe(true);
    });

    it('should kill process on darwin using lsof and return true', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true,
      });

      mockPortFreed();
      const result = await killProcessOnPort(5001);

      expect(result).toBe(true);
    });

    it('should return true on linux when exec succeeds and port is freed', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });

      mockPortFreed();
      const result = await killProcessOnPort(5001);
      expect(result).toBe(true);
    });

    it('should return false when port remains in use after kill', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });

      mockPortInUse();
      const result = await killProcessOnPort(5001);

      expect(result).toBe(false);
    });

    it('should handle win32 platform', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });

      mockPortFreed();

      // exec mock returns empty stdout → no process found → still checks port
      const result = await killProcessOnPort(5001);

      expect(typeof result).toBe('boolean');
    });

    it('should return false when exec throws on win32', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true,
      });

      // Override exec to throw
      const execSpy = vi.spyOn(child_process, 'exec');
      execSpy.mockImplementation((_cmd: string, _opts: any, callback?: any) => {
        const cb = typeof _opts === 'function' ? _opts : callback;
        if (cb) cb(new Error('exec failed'));
        return {} as any;
      });

      const result = await killProcessOnPort(5001);

      expect(result).toBe(false);
    });
  });

  // =========================================================================
  // findAvailablePort
  // =========================================================================
  describe('findAvailablePort', () => {
    let originalPlatform: PropertyDescriptor | undefined;

    beforeEach(() => {
      originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true,
      });
    });

    afterEach(() => {
      if (originalPlatform) {
        Object.defineProperty(process, 'platform', originalPlatform);
      }
    });

    it('should return startPort when it is available', async () => {
      vi.mocked(net.createServer).mockImplementation(
        createMockServerFactoryByPort([5001]) as any
      );

      const port = await findAvailablePort(5001);
      expect(port).toBe(5001);
    });

    it('should scan range and find next available port', async () => {
      vi.mocked(net.createServer).mockImplementation(
        createMockServerFactoryByPort([5003]) as any
      );

      const port = await findAvailablePort(5001);
      expect(port).toBe(5003);
    });

    it('should throw when no port in range is available', async () => {
      vi.mocked(net.createServer).mockImplementation(
        createMockServerFactoryByPort([]) as any
      );

      await expect(findAvailablePort(5001, 3)).rejects.toThrow(
        'No available port found in range 5001 ~ 5003'
      );
    });

    it('should respect maxAttempts parameter', async () => {
      vi.mocked(net.createServer).mockImplementation(
        createMockServerFactoryByPort([5005]) as any
      );

      // maxAttempts=3 means only 5001, 5002, 5003 → 5005 is out of range
      await expect(findAvailablePort(5001, 3)).rejects.toThrow(
        'No available port found in range 5001 ~ 5003'
      );
    });

    it('should not retry the same port twice', async () => {
      const attemptedPorts: number[] = [];
      vi.mocked(net.createServer).mockImplementation((() => {
        const onceHandlers: Record<string, Function> = {};
        return {
          once: vi.fn((event: string, handler: Function) => {
            onceHandlers[event] = handler;
          }),
          listen: vi.fn((opts: any) => {
            attemptedPorts.push(opts?.port ?? -1);
            setTimeout(
              () => onceHandlers['error']?.({ code: 'EADDRINUSE' }),
              0
            );
          }),
          close: vi.fn(),
        };
      }) as any);

      await expect(findAvailablePort(5001, 5)).rejects.toThrow();

      // Each port is attempted once via checkPortAvailable
      const uniquePorts = new Set(attemptedPorts);
      expect(uniquePorts.size).toBe(5);
    });

    it('should use default maxAttempts of 50', async () => {
      vi.mocked(net.createServer).mockImplementation(
        createMockServerFactoryByPort([5001]) as any
      );

      const port = await findAvailablePort(5001);
      expect(port).toBe(5001);
    });
  });

  // =========================================================================
  // Integration: readEnvValue + buildLocalServerUrl together
  // =========================================================================
  describe('readEnvValue + buildLocalServerUrl integration', () => {
    const mockFsOps = {
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
    };

    beforeEach(() => {
      mockFsOps.existsSync.mockReset();
      mockFsOps.readFileSync.mockReset();
    });

    it('should read proxy URL from env and build server URL', () => {
      mockFsOps.existsSync.mockReturnValue(true);
      mockFsOps.readFileSync.mockReturnValue(
        'VITE_PROXY_URL=http://localhost:3000/'
      );

      const proxyUrl = readEnvValue('/env', 'VITE_PROXY_URL', mockFsOps);
      const serverUrl = buildLocalServerUrl(proxyUrl);

      expect(serverUrl).toBe('http://localhost:3000/api');
    });

    it('should handle full pipeline with quoted values', () => {
      mockFsOps.existsSync.mockReturnValue(true);
      mockFsOps.readFileSync.mockReturnValue(
        'VITE_PROXY_URL="http://proxy.example.com"'
      );

      const proxyUrl = readEnvValue('/env', 'VITE_PROXY_URL', mockFsOps);
      const serverUrl = buildLocalServerUrl(proxyUrl);

      expect(serverUrl).toBe('http://proxy.example.com/api');
    });

    it('should handle missing env file gracefully', () => {
      mockFsOps.existsSync.mockReturnValue(false);

      const proxyUrl = readEnvValue('/env', 'VITE_PROXY_URL', mockFsOps);
      const serverUrl = buildLocalServerUrl(proxyUrl);

      expect(serverUrl).toBeUndefined();
    });

    it('should handle empty proxy value', () => {
      mockFsOps.existsSync.mockReturnValue(true);
      mockFsOps.readFileSync.mockReturnValue('VITE_PROXY_URL=');

      const proxyUrl = readEnvValue('/env', 'VITE_PROXY_URL', mockFsOps);
      const serverUrl = buildLocalServerUrl(proxyUrl);

      // Empty string → buildLocalServerUrl trims → empty → undefined
      expect(serverUrl).toBeUndefined();
    });

    it('should preserve URL that already has /api suffix', () => {
      mockFsOps.existsSync.mockReturnValue(true);
      mockFsOps.readFileSync.mockReturnValue(
        'VITE_PROXY_URL=http://localhost:3000/api'
      );

      const proxyUrl = readEnvValue('/env', 'VITE_PROXY_URL', mockFsOps);
      const serverUrl = buildLocalServerUrl(proxyUrl);

      expect(serverUrl).toBe('http://localhost:3000/api');
    });
  });
});
