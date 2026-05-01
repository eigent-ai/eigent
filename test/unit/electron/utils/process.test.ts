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
// Hoisted mock functions – must be defined before vi.mock() factories so they
// are available inside the factory closures at hoist-time.
// ---------------------------------------------------------------------------

const {
  mockAppGetAppPath,
  mockAppGetVersion,
  mockExistsSync,
  mockMkdirSync,
  mockReaddirSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockRmSync,
  mockCpSync,
  mockSymlinkSync,
  mockUnlinkSync,
  mockLstatSync,
  mockAccessSync,
  mockChmodSync,
  mockHomedir,
  mockExecFileSync,
  mockExecSync,
  mockSpawn,
} = vi.hoisted(() => ({
  mockAppGetAppPath: vi.fn<() => string>(),
  mockAppGetVersion: vi.fn<() => string>(),
  mockExistsSync: vi.fn<(p: string) => boolean>(),
  mockMkdirSync: vi.fn(),
  mockReaddirSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockRmSync: vi.fn(),
  mockCpSync: vi.fn(),
  mockSymlinkSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockLstatSync: vi.fn(),
  mockAccessSync: vi.fn(),
  mockChmodSync: vi.fn(),
  mockHomedir: vi.fn<() => string>(),
  mockExecFileSync: vi.fn(),
  mockExecSync: vi.fn(),
  mockSpawn: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Mutable state used by electron mock getters
const electronMockState = {
  isPackaged: false,
};

vi.mock('electron', () => ({
  app: {
    getAppPath: mockAppGetAppPath,
    get isPackaged() {
      return electronMockState.isPackaged;
    },
    getVersion: mockAppGetVersion,
  },
}));

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('fs', () => {
  const fs = {
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    readdirSync: mockReaddirSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
    rmSync: mockRmSync,
    cpSync: mockCpSync,
    symlinkSync: mockSymlinkSync,
    unlinkSync: mockUnlinkSync,
    lstatSync: mockLstatSync,
    accessSync: mockAccessSync,
    chmodSync: mockChmodSync,
    constants: { X_OK: 1 },
  };
  return { default: fs, ...fs };
});

vi.mock('os', () => ({
  default: { homedir: mockHomedir },
  homedir: mockHomedir,
}));

vi.mock('child_process', () => ({
  default: {
    execFileSync: mockExecFileSync,
    execSync: mockExecSync,
    spawn: mockSpawn,
  },
  execFileSync: mockExecFileSync,
  execSync: mockExecSync,
  spawn: mockSpawn,
}));

// Default spawn return value: a mock child process
const mockChildProcess = {
  unref: vi.fn(),
  on: vi.fn(),
  stdout: { on: vi.fn() },
  stderr: { on: vi.fn() },
};

// ---------------------------------------------------------------------------
// Import the system under test AFTER mocks are in place.
// ---------------------------------------------------------------------------

import {
  checkVenvExistsForPreCheck,
  cleanupOldVenvs,
  findNodejsWheelBinPath,
  findNodejsWheelNpmPath,
  getBackendPath,
  getBinaryName,
  getBinaryPath,
  getCachePath,
  getPrebuiltBinaryPath,
  getPrebuiltPythonDir,
  getPrebuiltTerminalVenvPath,
  getPrebuiltVenvPath,
  getResourcePath,
  getTerminalVenvPath,
  getUvEnv,
  getVenvPath,
  getVenvPythonPath,
  getVenvsBaseDir,
  isBinaryExists,
  TERMINAL_BASE_PACKAGES,
} from '../../../../electron/main/utils/process';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MOCK_HOME = '/home/testuser';
const MOCK_APP_PATH = '/opt/eigent-app';
const MOCK_RESOURCES_PATH = '/opt/eigent-app/resources';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simulate a non-packaged (development) Electron app. */
function setupDevMode() {
  electronMockState.isPackaged = false;
  mockAppGetAppPath.mockReturnValue(MOCK_APP_PATH);
  mockAppGetVersion.mockReturnValue('1.0.0');
  mockHomedir.mockReturnValue(MOCK_HOME);
}

/** Simulate a packaged (production) Electron app. */
function setupPackagedMode() {
  electronMockState.isPackaged = true;
  mockAppGetAppPath.mockReturnValue(MOCK_APP_PATH);
  mockAppGetVersion.mockReturnValue('1.0.0');
  mockHomedir.mockReturnValue(MOCK_HOME);
}

// ===========================================================================
// Test Suites
// ===========================================================================

describe('process.ts utility functions', () => {
  let originalPlatform: string;
  let originalResourcesPath: string | undefined;

  beforeAll(() => {
    originalPlatform = process.platform;
    originalResourcesPath = (process as any).resourcesPath;
    Object.defineProperty(process, 'resourcesPath', {
      value: MOCK_RESOURCES_PATH,
      writable: true,
      configurable: true,
    });
  });

  afterAll(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    });
    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      writable: true,
      configurable: true,
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    setupDevMode();
    // Default: nothing exists on disk
    mockExistsSync.mockReturnValue(false);
    // Default spawn returns a mock child process
    mockSpawn.mockReturnValue(mockChildProcess);
  });

  // -------------------------------------------------------------------------
  // getResourcePath
  // -------------------------------------------------------------------------
  describe('getResourcePath()', () => {
    it('should join app path with resources', () => {
      mockAppGetAppPath.mockReturnValue('/my/app');
      const result = getResourcePath();
      expect(result).toContain('resources');
      expect(result).toContain('/my/app');
    });
  });

  // -------------------------------------------------------------------------
  // getBackendPath
  // -------------------------------------------------------------------------
  describe('getBackendPath()', () => {
    it('should return resources/backend in packaged mode', () => {
      setupPackagedMode();
      const result = getBackendPath();
      expect(result).toContain('backend');
    });

    it('should use process.resourcesPath when packaged', () => {
      setupPackagedMode();
      const result = getBackendPath();
      expect(result).toContain(MOCK_RESOURCES_PATH);
      expect(result).toContain('backend');
    });

    it('should return appPath/backend in development mode', () => {
      setupDevMode();
      const result = getBackendPath();
      expect(result).toContain(MOCK_APP_PATH);
      expect(result).toContain('backend');
    });

    it('should use process.resourcesPath when packaged', () => {
      setupPackagedMode();
      const result = getBackendPath();
      expect(result).toMatch(/resources.*backend/);
    });

    it('should use app.getAppPath() when not packaged', () => {
      setupDevMode();
      mockAppGetAppPath.mockReturnValue('/dev/path');
      const result = getBackendPath();
      expect(result).toBe('/dev/path/backend');
    });
  });

  // -------------------------------------------------------------------------
  // getBinaryName
  // -------------------------------------------------------------------------
  describe('getBinaryName()', () => {
    it('should append .exe on win32', async () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const result = await getBinaryName('uv');
      expect(result).toBe('uv.exe');
    });

    it('should return name unchanged on darwin', async () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      const result = await getBinaryName('uv');
      expect(result).toBe('uv');
    });

    it('should return name unchanged on linux', async () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const result = await getBinaryName('uv');
      expect(result).toBe('uv');
    });
  });

  // -------------------------------------------------------------------------
  // getPrebuiltBinaryPath
  // -------------------------------------------------------------------------
  describe('getPrebuiltBinaryPath()', () => {
    it('should return null in development mode', () => {
      setupDevMode();
      expect(getPrebuiltBinaryPath()).toBeNull();
      expect(getPrebuiltBinaryPath('uv')).toBeNull();
    });

    it('should return null when prebuilt bin dir does not exist', () => {
      setupPackagedMode();
      mockExistsSync.mockReturnValue(false);
      expect(getPrebuiltBinaryPath()).toBeNull();
    });

    it('should return prebuilt bin dir path when no name given and dir exists', () => {
      setupPackagedMode();
      mockExistsSync.mockReturnValue(true);
      const result = getPrebuiltBinaryPath();
      expect(result).not.toBeNull();
      expect(result!).toContain('prebuilt');
      expect(result!).toContain('bin');
    });

    it('should return named binary path when binary exists on linux', () => {
      setupPackagedMode();
      Object.defineProperty(process, 'platform', { value: 'linux' });
      // First call: bin dir exists; second call: binary exists
      mockExistsSync.mockReturnValue(true);
      const result = getPrebuiltBinaryPath('uv');
      expect(result).not.toBeNull();
      expect(result!).toContain('uv');
      expect(result!).not.toContain('.exe');
    });

    it('should append .exe to binary name on win32', () => {
      setupPackagedMode();
      Object.defineProperty(process, 'platform', { value: 'win32' });
      mockExistsSync.mockReturnValue(true);
      const result = getPrebuiltBinaryPath('uv');
      expect(result).not.toBeNull();
      expect(result!).toContain('uv.exe');
    });

    it('should return null when named binary does not exist', () => {
      setupPackagedMode();
      // bin dir exists but specific binary does not
      mockExistsSync
        .mockReturnValueOnce(true) // bin dir check
        .mockReturnValueOnce(false); // specific binary check
      expect(getPrebuiltBinaryPath('uv')).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getBinaryPath
  // -------------------------------------------------------------------------
  describe('getBinaryPath()', () => {
    it('should return prebuilt binary in packaged mode when available', async () => {
      setupPackagedMode();
      Object.defineProperty(process, 'platform', { value: 'linux' });
      mockExistsSync.mockReturnValue(true);
      const result = await getBinaryPath('uv');
      expect(result).toContain('prebuilt');
    });

    it('should create .eigent/bin directory if missing in dev mode', async () => {
      setupDevMode();
      Object.defineProperty(process, 'platform', { value: 'linux' });
      mockExistsSync.mockReturnValue(false);
      const result = await getBinaryPath('uv');
      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('.eigent/bin'),
        { recursive: true }
      );
      expect(result).toContain('.eigent');
      expect(result).toContain('bin');
    });

    it('should return .eigent/bin dir when no name given', async () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(true);
      const result = await getBinaryPath();
      expect(result).toContain('.eigent/bin');
    });

    it('should use system PATH uv in dev mode when available', async () => {
      setupDevMode();
      Object.defineProperty(process, 'platform', { value: 'linux' });
      mockExecFileSync.mockReturnValue('/usr/local/bin/uv\n');
      mockExistsSync.mockReturnValue(true);
      const result = await getBinaryPath('uv');
      expect(result).toBe('/usr/local/bin/uv');
    });

    it('should fall back to .eigent/bin when system uv not found', async () => {
      setupDevMode();
      Object.defineProperty(process, 'platform', { value: 'linux' });
      mockExecFileSync.mockImplementation(() => {
        throw new Error('not found');
      });
      // .eigent/bin does not exist → mkdir, then binary check
      mockExistsSync.mockReturnValue(false);
      const result = await getBinaryPath('uv');
      expect(result).toContain('.eigent/bin/uv');
    });

    it('should use where.exe on win32 for system uv lookup', async () => {
      setupDevMode();
      Object.defineProperty(process, 'platform', { value: 'win32' });
      mockExecFileSync.mockReturnValue('C:\\uv\\uv.exe\r\n');
      mockExistsSync.mockReturnValue(true);
      const result = await getBinaryPath('uv');
      expect(result).toBe('C:\\uv\\uv.exe');
      expect(mockExecFileSync).toHaveBeenCalledWith(
        'where.exe',
        ['uv'],
        expect.any(Object)
      );
    });

    it('should append .exe to binary name on win32', async () => {
      setupDevMode();
      Object.defineProperty(process, 'platform', { value: 'win32' });
      mockExistsSync.mockReturnValue(true);
      const result = await getBinaryPath('uv');
      expect(result).toContain('uv.exe');
    });

    it('should not try system PATH for non-uv binaries in dev', async () => {
      setupDevMode();
      Object.defineProperty(process, 'platform', { value: 'linux' });
      mockExistsSync.mockReturnValue(true);
      await getBinaryPath('python');
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getCachePath
  // -------------------------------------------------------------------------
  describe('getCachePath()', () => {
    it('should return prebuilt cache path in packaged mode when available', () => {
      setupPackagedMode();
      // First call: prebuilt cache exists; second call: cache dir exists (in fallthrough won't reach)
      mockExistsSync.mockReturnValue(true);
      const result = getCachePath('models');
      expect(result).toContain('prebuilt');
      expect(result).toContain('cache');
      expect(result).toContain('models');
    });

    it('should fall back to ~/.eigent/cache when no prebuilt cache', () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(false);
      const result = getCachePath('models');
      expect(result).toContain('.eigent/cache/models');
    });

    it('should create cache directory if missing', () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(false);
      getCachePath('test-folder');
      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('.eigent/cache/test-folder'),
        { recursive: true }
      );
    });

    it('should not create directory when it already exists', () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(true);
      getCachePath('existing');
      expect(mockMkdirSync).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getVenvPythonPath
  // -------------------------------------------------------------------------
  describe('getVenvPythonPath()', () => {
    it('should return bin/python on non-windows', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      const result = getVenvPythonPath('/path/to/venv');
      expect(result).toContain('/path/to/venv');
      expect(result).toContain('bin/python');
      expect(result).not.toContain('Scripts');
    });

    it('should return Scripts/python.exe on win32', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const result = getVenvPythonPath('/path/to/venv');
      expect(result).toContain('Scripts/python.exe');
    });
  });

  // -------------------------------------------------------------------------
  // getPrebuiltPythonDir
  // -------------------------------------------------------------------------
  describe('getPrebuiltPythonDir()', () => {
    it('should return null in development mode', () => {
      setupDevMode();
      expect(getPrebuiltPythonDir()).toBeNull();
    });

    it('should return prebuilt uv_python dir when it exists in packaged mode', () => {
      setupPackagedMode();
      mockExistsSync.mockReturnValue(true);
      const result = getPrebuiltPythonDir();
      expect(result).not.toBeNull();
      expect(result!).toContain('prebuilt');
      expect(result!).toContain('uv_python');
    });

    it('should return null when prebuilt uv_python dir does not exist', () => {
      setupPackagedMode();
      mockExistsSync.mockReturnValue(false);
      expect(getPrebuiltPythonDir()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // getPrebuiltTerminalVenvPath
  // -------------------------------------------------------------------------
  describe('getPrebuiltTerminalVenvPath()', () => {
    it('should return null in development mode', () => {
      setupDevMode();
      expect(getPrebuiltTerminalVenvPath()).toBeNull();
    });

    it('should return null when terminal_venv directory does not exist', () => {
      setupPackagedMode();
      mockExistsSync.mockReturnValue(false);
      expect(getPrebuiltTerminalVenvPath()).toBeNull();
    });

    it('should return null when pyvenv.cfg is missing', () => {
      setupPackagedMode();
      // terminal_venv dir exists, but pyvenv.cfg does not
      mockExistsSync
        .mockReturnValueOnce(true) // terminal_venv dir
        .mockReturnValueOnce(false); // pyvenv.cfg
      expect(getPrebuiltTerminalVenvPath()).toBeNull();
    });

    it('should return null when .packages_installed marker is missing', () => {
      setupPackagedMode();
      Object.defineProperty(process, 'platform', { value: 'linux' });
      // terminal_venv dir exists, pyvenv.cfg exists, .packages_installed missing
      mockExistsSync
        .mockReturnValueOnce(true) // terminal_venv dir
        .mockReturnValueOnce(true) // pyvenv.cfg
        .mockReturnValueOnce(false); // .packages_installed
      expect(getPrebuiltTerminalVenvPath()).toBeNull();
    });

    it('should return terminal_venv path when all markers exist and python is valid', () => {
      setupPackagedMode();
      Object.defineProperty(process, 'platform', { value: 'linux' });
      mockAppGetVersion.mockReturnValue('1.0.0');
      // All existence checks return true
      mockExistsSync.mockReturnValue(true);
      // Multiple readFileSync calls: fixed marker, pyvenv.cfg content (multiple reads),
      // and shebang fix reads
      mockReadFileSync.mockImplementation((p: string) => {
        if (typeof p === 'string' && p.includes('.terminal_venv_fixed')) {
          return '1.0.0'; // fixed marker matches version → no fix needed
        }
        // pyvenv.cfg content
        if (typeof p === 'string' && p.includes('pyvenv.cfg')) {
          return 'home = /usr/bin\n';
        }
        return '';
      });
      const result = getPrebuiltTerminalVenvPath();
      expect(result).not.toBeNull();
      expect(result!).toContain('terminal_venv');
    });
  });

  // -------------------------------------------------------------------------
  // getPrebuiltVenvPath
  // -------------------------------------------------------------------------
  describe('getPrebuiltVenvPath()', () => {
    it('should return null in development mode', () => {
      setupDevMode();
      expect(getPrebuiltVenvPath()).toBeNull();
    });

    it('should return null when prebuilt venv dir does not exist', () => {
      setupPackagedMode();
      mockExistsSync.mockReturnValue(false);
      expect(getPrebuiltVenvPath()).toBeNull();
    });

    it('should return null when pyvenv.cfg is missing', () => {
      setupPackagedMode();
      mockExistsSync
        .mockReturnValueOnce(true) // prebuiltVenvPath
        .mockReturnValueOnce(false); // pyvenv.cfg
      expect(getPrebuiltVenvPath()).toBeNull();
    });

    it('should return venv path when venv and pyvenv.cfg exist and python exe is valid', () => {
      setupPackagedMode();
      Object.defineProperty(process, 'platform', { value: 'linux' });
      mockAppGetVersion.mockReturnValue('1.0.0');
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('1.0.0'); // fixed marker matches version
      const result = getPrebuiltVenvPath();
      expect(result).not.toBeNull();
      expect(result!).toContain('prebuilt');
      expect(result!).toContain('venv');
    });
  });

  // -------------------------------------------------------------------------
  // getTerminalVenvPath
  // -------------------------------------------------------------------------
  describe('getTerminalVenvPath()', () => {
    it('should return prebuilt terminal venv in packaged mode when available', () => {
      setupPackagedMode();
      Object.defineProperty(process, 'platform', { value: 'linux' });
      mockAppGetVersion.mockReturnValue('1.0.0');
      // getPrebuiltTerminalVenvPath checks many things; mock all true
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('1.0.0'); // fixed marker matches version
      const result = getTerminalVenvPath('1.0.0');
      expect(result).toContain('terminal_venv');
    });

    it('should fall back to user venv dir in dev mode and create missing dirs', () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(false);
      const result = getTerminalVenvPath('1.0.0');
      expect(result).toContain('.eigent/venvs/terminal_base-1.0.0');
      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('.eigent/venvs'),
        { recursive: true }
      );
    });

    it('should not create venvs directory when it already exists', () => {
      setupDevMode();
      // existsSync returns true → venvs dir already exists
      mockExistsSync.mockReturnValue(true);
      getTerminalVenvPath('1.0.0');
      expect(mockMkdirSync).not.toHaveBeenCalled();
    });

    it('should create venvs base directory if missing', () => {
      setupDevMode();
      // existsSync returns false for venvs base dir
      mockExistsSync.mockReturnValue(false);
      getTerminalVenvPath('1.0.0');
      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('.eigent/venvs'),
        { recursive: true }
      );
    });

    it('should not create venvs directory when it already exists', () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(true);
      getTerminalVenvPath('1.0.0');
      expect(mockMkdirSync).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getVenvPath
  // -------------------------------------------------------------------------
  describe('getVenvPath()', () => {
    it('should return backend venv path and create dirs in dev mode', () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(false);
      const result = getVenvPath('2.0.0');
      expect(result).toContain('.eigent/venvs/backend-2.0.0');
      expect(mockMkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('.eigent/venvs'),
        { recursive: true }
      );
    });

    it('should not create venvs directory when it already exists in dev mode', () => {
      setupDevMode();
      // existsSync returns true → venvs dir already exists → no mkdir
      mockExistsSync.mockReturnValue(true);
      getVenvPath('1.0.0');
      expect(mockMkdirSync).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getVenvsBaseDir
  // -------------------------------------------------------------------------
  describe('getVenvsBaseDir()', () => {
    it('should return ~/.eigent/venvs', () => {
      mockHomedir.mockReturnValue('/home/testuser');
      expect(getVenvsBaseDir()).toContain('/home/testuser/.eigent/venvs');
    });

    it('should respect homedir changes', () => {
      mockHomedir.mockReturnValue('/custom/home');
      expect(getVenvsBaseDir()).toContain('/custom/home/.eigent/venvs');
    });
  });

  // -------------------------------------------------------------------------
  // checkVenvExistsForPreCheck
  // -------------------------------------------------------------------------
  describe('checkVenvExistsForPreCheck()', () => {
    it('should check user venv in dev mode', () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(false);
      const result = checkVenvExistsForPreCheck('1.0.0');
      expect(result.exists).toBe(false);
      expect(result.path).toContain('backend-1.0.0');
    });

    it('should return exists=true when pyvenv.cfg is present in dev mode', () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(true);
      const result = checkVenvExistsForPreCheck('1.0.0');
      expect(result.exists).toBe(true);
      expect(result.path).toContain('backend-1.0.0');
    });

    it('should check prebuilt venv first in packaged mode', () => {
      setupPackagedMode();
      // Both prebuilt venv and pyvenv.cfg exist
      mockExistsSync.mockReturnValue(true);
      const result = checkVenvExistsForPreCheck('1.0.0');
      expect(result.exists).toBe(true);
    });

    it('should fall back to user venv in packaged mode when no prebuilt', () => {
      setupPackagedMode();
      // prebuiltVenvPath exists → true, prebuiltPyvenvCfg → false (skip prebuilt)
      // user pyvenvCfg → true
      mockExistsSync
        .mockReturnValueOnce(true) // prebuiltVenvPath
        .mockReturnValueOnce(false) // prebuiltPyvenvCfg
        .mockReturnValueOnce(true); // user pyvenvCfg
      const result = checkVenvExistsForPreCheck('1.0.0');
      expect(result.exists).toBe(true);
    });

    it('should return exists=false when no venv found in packaged mode', () => {
      setupPackagedMode();
      // prebuiltVenvPath → false, user pyvenvCfg → false
      mockExistsSync
        .mockReturnValueOnce(false) // prebuiltVenvPath
        .mockReturnValueOnce(false); // user pyvenvCfg
      const result = checkVenvExistsForPreCheck('1.0.0');
      expect(result.exists).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // isBinaryExists
  // -------------------------------------------------------------------------
  describe('isBinaryExists()', () => {
    it('should return true when binary file exists', async () => {
      setupDevMode();
      Object.defineProperty(process, 'platform', { value: 'linux' });
      mockExistsSync.mockReturnValue(true);
      const result = await isBinaryExists('uv');
      expect(result).toBe(true);
    });

    it('should return false when binary file does not exist', async () => {
      setupDevMode();
      Object.defineProperty(process, 'platform', { value: 'linux' });
      mockExistsSync.mockReturnValue(false);
      const result = await isBinaryExists('uv');
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // getUvEnv
  // -------------------------------------------------------------------------
  describe('getUvEnv()', () => {
    it('should include required UV environment variables', () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(false);
      const env = getUvEnv('1.0.0');
      expect(env).toHaveProperty('UV_PYTHON_INSTALL_DIR');
      expect(env).toHaveProperty('UV_TOOL_DIR');
      expect(env).toHaveProperty('UV_PROJECT_ENVIRONMENT');
      expect(env).toHaveProperty('UV_HTTP_TIMEOUT');
    });

    it('should set UV_HTTP_TIMEOUT to 300', () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(false);
      const env = getUvEnv('1.0.0');
      expect(env.UV_HTTP_TIMEOUT).toBe('300');
    });

    it('should use prebuilt Python dir in packaged mode', () => {
      setupPackagedMode();
      mockExistsSync.mockReturnValue(true);
      const env = getUvEnv('1.0.0');
      expect(env.UV_PYTHON_INSTALL_DIR).toContain('uv_python');
    });

    it('should use cache path for Python install dir in dev mode', () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(false);
      const env = getUvEnv('1.0.0');
      expect(env.UV_PYTHON_INSTALL_DIR).toContain('.eigent/cache/uv_python');
    });

    it('should set UV_PROJECT_ENVIRONMENT to venv path for version', () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(true);
      const env = getUvEnv('2.5.0');
      expect(env.UV_PROJECT_ENVIRONMENT).toContain('backend-2.5.0');
    });
  });

  // -------------------------------------------------------------------------
  // cleanupOldVenvs
  // -------------------------------------------------------------------------
  describe('cleanupOldVenvs()', () => {
    it('should do nothing when venvs directory does not exist', async () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(false);
      await cleanupOldVenvs('1.0.0');
      expect(mockRmSync).not.toHaveBeenCalled();
    });

    it('should remove old backend venvs not matching current version', async () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'backend-0.9.0', isDirectory: () => true },
        { name: 'backend-1.0.0', isDirectory: () => true },
        { name: 'backend-1.1.0', isDirectory: () => true },
        { name: 'some-file.txt', isDirectory: () => false },
      ]);
      await cleanupOldVenvs('1.0.0');
      expect(mockRmSync).toHaveBeenCalledTimes(2);
    });

    it('should remove old terminal_base venvs not matching current version', async () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'terminal_base-0.8.0', isDirectory: () => true },
        { name: 'terminal_base-1.0.0', isDirectory: () => true },
      ]);
      await cleanupOldVenvs('1.0.0');
      expect(mockRmSync).toHaveBeenCalledTimes(1);
    });

    it('should not remove venvs matching current version', async () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'backend-1.0.0', isDirectory: () => true },
        { name: 'terminal_base-1.0.0', isDirectory: () => true },
      ]);
      await cleanupOldVenvs('1.0.0');
      expect(mockRmSync).not.toHaveBeenCalled();
    });

    it('should skip non-directory entries', async () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'some-file.txt', isDirectory: () => false },
        { name: '.gitkeep', isDirectory: () => false },
      ]);
      await cleanupOldVenvs('1.0.0');
      expect(mockRmSync).not.toHaveBeenCalled();
    });

    it('should handle mixed backend and terminal_base venvs', async () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'backend-0.9.0', isDirectory: () => true },
        { name: 'backend-1.0.0', isDirectory: () => true },
        { name: 'terminal_base-0.9.0', isDirectory: () => true },
        { name: 'terminal_base-1.0.0', isDirectory: () => true },
        { name: 'other-dir', isDirectory: () => true },
      ]);
      await cleanupOldVenvs('1.0.0');
      // backend-0.9.0 and terminal_base-0.9.0 should be removed
      expect(mockRmSync).toHaveBeenCalledTimes(2);
    });

    it('should handle readdirSync errors gracefully', async () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });
      // Should not throw
      await expect(cleanupOldVenvs('1.0.0')).resolves.toBeUndefined();
    });

    it('should handle rmSync errors gracefully for individual entries', async () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        { name: 'backend-0.9.0', isDirectory: () => true },
      ]);
      mockRmSync.mockImplementation(() => {
        throw new Error('Cannot remove');
      });
      // Should not throw
      await expect(cleanupOldVenvs('1.0.0')).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // findNodejsWheelBinPath
  // -------------------------------------------------------------------------
  describe('findNodejsWheelBinPath()', () => {
    it('should return null when venv lib directory does not exist', () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(false);
      expect(findNodejsWheelBinPath('/path/to/venv')).toBeNull();
    });

    it('should return null when no python directories found in lib', () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([]);
      expect(findNodejsWheelBinPath('/path/to/venv')).toBeNull();
    });

    it('should return null when no python directories matching prefix', () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['node_modules', 'other']);
      expect(findNodejsWheelBinPath('/path/to/venv')).toBeNull();
    });

    it('should return bin path when nodejs_wheel/bin/node exists on linux', () => {
      setupDevMode();
      Object.defineProperty(process, 'platform', { value: 'linux' });
      mockExistsSync
        .mockReturnValueOnce(true) // lib dir
        .mockReturnValueOnce(true); // node binary
      mockReaddirSync.mockReturnValue(['python3.11']);
      const result = findNodejsWheelBinPath('/path/to/venv');
      expect(result).toContain('nodejs_wheel/bin');
    });

    it('should look for node.exe on win32', () => {
      setupDevMode();
      Object.defineProperty(process, 'platform', { value: 'win32' });
      mockExistsSync
        .mockReturnValueOnce(true) // lib dir
        .mockReturnValueOnce(true); // node.exe binary
      mockReaddirSync.mockReturnValue(['python3.11']);
      const result = findNodejsWheelBinPath('/path/to/venv');
      expect(result).toContain('nodejs_wheel/bin');
    });

    it('should search multiple python directories', () => {
      setupDevMode();
      Object.defineProperty(process, 'platform', { value: 'linux' });
      // First python dir has no node, second one does
      mockExistsSync
        .mockReturnValueOnce(true) // lib dir
        .mockReturnValueOnce(false) // first python dir - no node
        .mockReturnValueOnce(true); // second python dir - node exists
      mockReaddirSync.mockReturnValue(['python3.10', 'python3.11']);
      const result = findNodejsWheelBinPath('/path/to/venv');
      expect(result).toContain('nodejs_wheel/bin');
    });
  });

  // -------------------------------------------------------------------------
  // findNodejsWheelNpmPath
  // -------------------------------------------------------------------------
  describe('findNodejsWheelNpmPath()', () => {
    it('should return wrapper dir when npm wrappers exist', () => {
      setupDevMode();
      Object.defineProperty(process, 'platform', { value: 'linux' });
      // Mock ensureNpmWrappersForBrowserToolkit's internal checks:
      // venv python exists, then npm/npx wrappers exist
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(''); // wrapper version mismatch → needs update
      const result = findNodejsWheelNpmPath('/path/to/venv');
      // With all mocks returning true, should get wrapper dir or fallback
      expect(result).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // TERMINAL_BASE_PACKAGES
  // -------------------------------------------------------------------------
  describe('TERMINAL_BASE_PACKAGES', () => {
    it('should be a non-empty array of strings', () => {
      expect(Array.isArray(TERMINAL_BASE_PACKAGES)).toBe(true);
      expect(TERMINAL_BASE_PACKAGES.length).toBeGreaterThan(0);
    });

    it('should include common data packages', () => {
      expect(TERMINAL_BASE_PACKAGES).toContain('pandas');
      expect(TERMINAL_BASE_PACKAGES).toContain('numpy');
      expect(TERMINAL_BASE_PACKAGES).toContain('matplotlib');
      expect(TERMINAL_BASE_PACKAGES).toContain('requests');
    });
  });

  // -------------------------------------------------------------------------
  // Path construction integration scenarios
  // -------------------------------------------------------------------------
  describe('path construction integration', () => {
    it('getVenvPythonPath + getVenvPath should produce valid python path', () => {
      setupDevMode();
      Object.defineProperty(process, 'platform', { value: 'linux' });
      mockExistsSync.mockReturnValue(true);
      const venv = getVenvPath('1.2.3');
      const python = getVenvPythonPath(venv);
      expect(python).toContain('.eigent/venvs/backend-1.2.3/bin/python');
    });

    it('getVenvPythonPath on win32 produces Scripts path', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const python = getVenvPythonPath(
        'C:\\Users\\test\\.eigent\\venvs\\backend-1.0.0'
      );
      // path.join uses forward slashes in jsdom/node even on win32
      expect(python).toContain('Scripts');
      expect(python).toContain('python.exe');
    });

    it('getBinaryPath + isBinaryExists should be consistent', async () => {
      setupDevMode();
      Object.defineProperty(process, 'platform', { value: 'linux' });
      mockExistsSync.mockReturnValue(true);
      const binaryPath = await getBinaryPath('uv');
      const exists = await isBinaryExists('uv');
      // The last existsSync call should be for the binary path
      expect(exists).toBe(true);
      expect(binaryPath).toContain('uv');
    });

    it('getBackendPath and getVenvPath should use different base dirs', () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(true);
      const backend = getBackendPath();
      const venv = getVenvPath('1.0.0');
      // Backend is under app path; venv is under home dir
      expect(backend).toContain(MOCK_APP_PATH);
      expect(venv).toContain(MOCK_HOME);
    });

    it('all path functions should return absolute paths', () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(true);
      // getBackendPath uses path.join with absolute app path
      expect(getBackendPath()).toContain('/');
      expect(getVenvsBaseDir()).toContain('/');
    });

    it('cache and venv paths should be under different .eigent subdirs', () => {
      setupDevMode();
      mockExistsSync.mockReturnValue(false);
      const cache = getCachePath('uv_python');
      const venvs = getVenvsBaseDir();
      expect(cache).toContain('.eigent/cache');
      expect(venvs).toContain('.eigent/venvs');
    });
  });
});
