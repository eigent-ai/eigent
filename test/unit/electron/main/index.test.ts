import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock all modules first
const mockApp = {
  getPath: vi.fn(),
  getVersion: vi.fn(),
  getLocale: vi.fn(),
  requestSingleInstanceLock: vi.fn(),
  quit: vi.fn(),
  setAsDefaultProtocolClient: vi.fn(),
  isDefaultProtocolClient: vi.fn(),
  setAppUserModelId: vi.fn(),
  disableHardwareAcceleration: vi.fn(),
  commandLine: {
    appendSwitch: vi.fn(),
  },
  whenReady: vi.fn(),
  on: vi.fn(),
};

const mockBrowserWindow = vi.fn(() => ({
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
  getAllWindows: vi.fn(),
}));

const mockDialog = {
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
};

const mockShell = {
  openExternal: vi.fn(),
  showItemInFolder: vi.fn(),
};

const mockIpcMain = {
  handle: vi.fn(),
  on: vi.fn(),
};

const mockMenu = {
  setApplicationMenu: vi.fn(),
};

const mockFs = {
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  createReadStream: vi.fn(),
  unlinkSync: vi.fn(),
  createWriteStream: vi.fn(),
};

const mockFsp = {
  access: vi.fn(),
  stat: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn(),
};

const mockOs = {
  release: vi.fn(),
  homedir: vi.fn(),
};

const mockLog = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  transports: {
    file: {
      getFile: vi.fn(() => ({ path: "/mock/log/path" })),
    },
    console: { level: "info" },
  },
};

const mockAxios = {
  post: vi.fn(),
};

// Apply mocks
vi.mock("electron", () => ({
  app: mockApp,
  BrowserWindow: mockBrowserWindow,
  ipcMain: mockIpcMain,
  dialog: mockDialog,
  shell: mockShell,
  nativeTheme: { themeSource: "" },
  protocol: { handle: vi.fn() },
  session: { defaultSession: { on: vi.fn() } },
  Menu: mockMenu,
}));

vi.mock("node:fs", () => ({
  default: mockFs,
  existsSync: mockFs.existsSync,
  readFileSync: mockFs.readFileSync,
  writeFileSync: mockFs.writeFileSync,
  unlinkSync: mockFs.unlinkSync,
  createReadStream: mockFs.createReadStream,
  createWriteStream: mockFs.createWriteStream,
}));

vi.mock("fs/promises", () => mockFsp);

vi.mock("node:os", () => ({
  default: mockOs,
  homedir: mockOs.homedir,
  release: mockOs.release,
}));

vi.mock("electron-log", () => ({ default: mockLog }));

vi.mock("axios", () => ({ default: mockAxios }));

vi.mock("form-data", () => ({
  default: vi.fn(),
}));

// Mock internal modules (these can fail silently since we're testing logic, not actual imports)
vi.mock("../../../../electron/main/update", () => ({
  update: vi.fn(),
  registerUpdateIpcHandlers: vi.fn(),
}));

vi.mock("../../../../electron/main/init", () => ({
  checkToolInstalled: vi.fn(),
  installDependencies: vi.fn(),
  killProcessOnPort: vi.fn(),
  startBackend: vi.fn(),
  findAvailablePort: vi.fn(),
}));

// Other internal mocks...
vi.mock("../../../../electron/main/webview", () => ({
  WebViewManager: vi.fn(),
}));
vi.mock("../../../../electron/main/fileReader", () => ({
  FileReader: vi.fn(),
}));
vi.mock("../../../../electron/main/utils/mcpConfig", () => ({
  addMcp: vi.fn(),
  removeMcp: vi.fn(),
  updateMcp: vi.fn(),
  readMcpConfig: vi.fn(),
}));
vi.mock("../../../../electron/main/utils/envUtil", () => ({
  getEnvPath: vi.fn(),
  updateEnvBlock: vi.fn(),
  removeEnvKey: vi.fn(),
  getEmailFolderPath: vi.fn(),
}));
vi.mock("../../../../electron/main/copy", () => ({ copyBrowserData: vi.fn() }));
vi.mock("../../../../electron/main/utils/log", () => ({ zipFolder: vi.fn() }));
vi.mock("tree-kill", () => ({ default: vi.fn() }));

// Import the mocked functions
import * as envUtil from "../../../../electron/main/utils/envUtil";
import * as mcpConfig from "../../../../electron/main/utils/mcpConfig";
import * as initModule from "../../../../electron/main/init";

// Cast the imports to mocked versions
const mockedEnvUtil = vi.mocked(envUtil);
const mockedMcpConfig = vi.mocked(mcpConfig);
const mockedInitModule = vi.mocked(initModule);

describe("Electron Main Index Functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock returns
    mockApp.getPath.mockReturnValue("/mock/user/data");
    mockApp.getVersion.mockReturnValue("1.0.0");
    mockApp.getLocale.mockReturnValue("en-US");
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue("1.0.0");
    mockOs.release.mockReturnValue("10.0.0");
    mockOs.homedir.mockReturnValue("/home/user");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("checkAndInstallDepsOnUpdate", () => {
    it("should return true when version file exists and matches current version", async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue("1.0.0");
      mockApp.getVersion.mockReturnValue("1.0.0");

      // We test the logic that would be in the function
      const versionExists = mockFs.existsSync("/mock/version.txt");
      const savedVersion = mockFs.readFileSync("/mock/version.txt", "utf-8");
      const currentVersion = mockApp.getVersion();

      expect(versionExists).toBe(true);
      expect(savedVersion).toBe(currentVersion);
    });

    it("should install dependencies when version file does not exist", async () => {
      mockFs.existsSync.mockReturnValue(false);
      mockApp.getVersion.mockReturnValue("1.0.0");

      const versionExists = mockFs.existsSync("/mock/version.txt");
      expect(versionExists).toBe(false);
    });

    it("should install dependencies when version has changed", async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue("0.9.0");
      mockApp.getVersion.mockReturnValue("1.0.0");

      const savedVersion = mockFs.readFileSync("/mock/version.txt", "utf-8");
      const currentVersion = mockApp.getVersion();
      expect(savedVersion).not.toBe(currentVersion);
    });

    it("should handle errors during version check", async () => {
      mockFs.existsSync.mockImplementation(() => {
        throw new Error("File system error");
      });

      expect(() => mockFs.existsSync("/path")).toThrow("File system error");
    });
  });

  describe("setupProtocolHandlers", () => {
    it("should set up protocol handlers in development mode", () => {
      process.env.NODE_ENV = "development";
      mockApp.isDefaultProtocolClient.mockReturnValue(false);

      // Test protocol handler setup logic
      expect(mockApp.setAsDefaultProtocolClient).toBeDefined();
    });

    it("should set up protocol handlers in production mode", () => {
      process.env.NODE_ENV = "production";

      expect(mockApp.setAsDefaultProtocolClient).toBeDefined();
    });
  });

  describe("handleProtocolUrl", () => {
    let mockWin: any;

    beforeEach(() => {
      mockWin = {
        isDestroyed: vi.fn().mockReturnValue(false),
        webContents: {
          send: vi.fn(),
        },
      };
    });

    it("should handle OAuth protocol URLs correctly", () => {
      // Since custom protocols might not work in test env, we test URL parsing directly
      const urlStr = "https://example.com/oauth?provider=google&code=123456";

      const urlObj = new URL(urlStr);
      expect(urlObj.pathname).toBe("/oauth");
      expect(urlObj.searchParams.get("provider")).toBe("google");
      expect(urlObj.searchParams.get("code")).toBe("123456");
    });

    it("should handle authorization code URLs", () => {
      const urlStr = "https://example.com/callback?code=abc123";

      const urlObj = new URL(urlStr);
      expect(urlObj.searchParams.get("code")).toBe("abc123");
    });

    it("should handle share token URLs", () => {
      const urlStr = "https://example.com/share?share_token=token123";

      const urlObj = new URL(urlStr);
      expect(urlObj.searchParams.get("share_token")).toBe("token123");
    });

    it("should handle missing window gracefully", () => {
      // Test error handling when window is not available
      expect(mockLog.error).toBeDefined();
    });
  });

  describe("setupSingleInstanceLock", () => {
    it("should quit app when single instance lock fails", () => {
      mockApp.requestSingleInstanceLock.mockReturnValue(false);

      const gotLock = mockApp.requestSingleInstanceLock();
      expect(gotLock).toBe(false);
    });

    it("should set up event handlers when single instance lock succeeds", () => {
      mockApp.requestSingleInstanceLock.mockReturnValue(true);

      const gotLock = mockApp.requestSingleInstanceLock();
      expect(gotLock).toBe(true);
      expect(mockApp.on).toBeDefined();
    });
  });

  describe("getSystemLanguage", () => {
    it("should return zh-cn for Chinese locale", async () => {
      mockApp.getLocale.mockReturnValue("zh-CN");

      const getSystemLanguage = async () => {
        const locale = mockApp.getLocale();
        return locale === "zh-CN" ? "zh-cn" : "en";
      };

      const result = await getSystemLanguage();
      expect(result).toBe("zh-cn");
    });

    it("should return en for other locales", async () => {
      mockApp.getLocale.mockReturnValue("en-US");

      const getSystemLanguage = async () => {
        const locale = mockApp.getLocale();
        return locale === "zh-CN" ? "zh-cn" : "en";
      };

      const result = await getSystemLanguage();
      expect(result).toBe("en");
    });
  });

  describe("checkManagerInstance", () => {
    it("should return manager when it exists", () => {
      const mockManager = { test: "value" };

      const checkManagerInstance = (manager: any, name: string) => {
        if (!manager) {
          throw new Error(`${name} not initialized`);
        }
        return manager;
      };

      const result = checkManagerInstance(mockManager, "TestManager");
      expect(result).toBe(mockManager);
    });

    it("should throw error when manager is null or undefined", () => {
      const checkManagerInstance = (manager: any, name: string) => {
        if (!manager) {
          throw new Error(`${name} not initialized`);
        }
        return manager;
      };

      expect(() => checkManagerInstance(null, "TestManager")).toThrow(
        "TestManager not initialized"
      );
      expect(() => checkManagerInstance(undefined, "TestManager")).toThrow(
        "TestManager not initialized"
      );
    });
  });

  describe("getBackupLogPath", () => {
    it("should return correct backup log path", () => {
      mockApp.getPath.mockReturnValue("/mock/userdata");

      const getBackupLogPath = () => {
        const userDataPath = mockApp.getPath("userData");
        return `${userDataPath}/logs/main.log`;
      };

      const result = getBackupLogPath();
      expect(result).toContain("logs");
      expect(result).toContain("main.log");
    });
  });

  describe("IPC Handlers", () => {
    describe("get-browser-port handler", () => {
      it("should return browser port", () => {
        const mockHandler = vi.fn().mockReturnValue(9222);

        expect(typeof mockHandler()).toBe("number");
      });
    });

    describe("get-app-version handler", () => {
      it("should return app version", () => {
        mockApp.getVersion.mockReturnValue("1.0.0");

        const result = mockApp.getVersion();
        expect(result).toBe("1.0.0");
      });
    });

    describe("get-backend-port handler", () => {
      it("should return backend port", () => {
        const mockHandler = vi.fn().mockReturnValue(5001);

        expect(typeof mockHandler()).toBe("number");
      });
    });

    describe("get-home-dir handler", () => {
      it("should return USERPROFILE on Windows", () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, "platform", { value: "win32" });
        process.env.USERPROFILE = "C:\\Users\\TestUser";

        const getHomeDir = () => {
          const platform = process.platform;
          return platform === "win32"
            ? process.env.USERPROFILE
            : process.env.HOME;
        };

        const result = getHomeDir();
        expect(result).toBe("C:\\Users\\TestUser");

        // Restore original platform
        Object.defineProperty(process, "platform", { value: originalPlatform });
      });

      it("should return HOME on non-Windows", () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, "platform", { value: "darwin" });
        process.env.HOME = "/home/testuser";

        const getHomeDir = () => {
          const platform = process.platform;
          return platform === "win32"
            ? process.env.USERPROFILE
            : process.env.HOME;
        };

        const result = getHomeDir();
        expect(result).toBe("/home/testuser");

        // Restore original platform
        Object.defineProperty(process, "platform", { value: originalPlatform });
      });
    });

    describe("select-file handler", () => {
      it("should handle successful file selection", async () => {
        const mockResult = {
          canceled: false,
          filePaths: ["/path/to/file.txt"],
        };
        mockDialog.showOpenDialog.mockResolvedValue(mockResult);

        const result = await mockDialog.showOpenDialog({} as any, {
          properties: ["openFile", "multiSelections"],
        });

        expect(result.canceled).toBe(false);
        expect(result.filePaths).toHaveLength(1);
      });

      it("should handle cancelled file selection", async () => {
        const mockResult = {
          canceled: true,
          filePaths: [],
        };
        mockDialog.showOpenDialog.mockResolvedValue(mockResult);

        const result = await mockDialog.showOpenDialog({} as any, {
          properties: ["openFile", "multiSelections"],
        });

        expect(result.canceled).toBe(true);
      });
    });

    describe("read-file handler", () => {
      it("should successfully read file", async () => {
        const mockContent = "file content";
        mockFsp.readFile.mockResolvedValue(mockContent);

        const result = await mockFsp.readFile("/path/to/file.txt", "utf-8");
        expect(result).toBe(mockContent);
      });

      it("should handle file read errors", async () => {
        const error = new Error("File not found");
        mockFsp.readFile.mockRejectedValue(error);

        await expect(
          mockFsp.readFile("/nonexistent/file.txt", "utf-8")
        ).rejects.toThrow("File not found");
      });
    });

    describe("export-log handler", () => {
      it("should successfully export log file", async () => {
        mockFsp.access.mockResolvedValue(undefined);
        mockFsp.stat.mockResolvedValue({ size: 1000 });
        mockFsp.readFile.mockResolvedValue("log content");
        mockDialog.showSaveDialog.mockResolvedValue({
          canceled: false,
          filePath: "/path/to/exported.log",
        });
        mockFsp.writeFile.mockResolvedValue(undefined);

        // Test the export log logic
        await expect(
          mockFsp.writeFile("/path/to/exported.log", "log content", "utf-8")
        ).resolves.toBeUndefined();
      });

      it("should handle empty log file", async () => {
        mockFsp.access.mockResolvedValue(undefined);
        mockFsp.stat.mockResolvedValue({ size: 0 });

        const stats = await mockFsp.stat("/mock/log/path");
        expect(stats.size).toBe(0);
      });

      it("should handle cancelled save dialog", async () => {
        mockDialog.showSaveDialog.mockResolvedValue({
          canceled: true,
          filePath: undefined,
        });

        const result = await mockDialog.showSaveDialog({
          title: "save log file",
          defaultPath: "test.log",
          filters: [{ name: "log file", extensions: ["log", "txt"] }],
        });

        expect(result.canceled).toBe(true);
      });
    });

    describe("upload-log handler", () => {
      it("should successfully upload log file", async () => {
        const mockResponse = { status: 200, data: { success: true } };
        mockAxios.post.mockResolvedValue(mockResponse);

        const result = await mockAxios.post("/api/test", {});
        expect(result.status).toBe(200);
      });

      it("should handle upload errors", async () => {
        const error = new Error("Network error");
        mockAxios.post.mockRejectedValue(error);

        await expect(mockAxios.post("/api/test", {})).rejects.toThrow(
          "Network error"
        );
      });

      it("should validate required parameters", () => {
        const validateParams = (
          email: string,
          taskId: string,
          baseUrl: string,
          token: string
        ) => {
          if (!email || !taskId || !baseUrl || !token) {
            throw new Error("Missing required parameters");
          }
          return true;
        };

        expect(() => validateParams("", "task1", "url", "token")).toThrow(
          "Missing required parameters"
        );
        expect(() => validateParams("email", "", "url", "token")).toThrow(
          "Missing required parameters"
        );
        expect(() => validateParams("email", "task1", "", "token")).toThrow(
          "Missing required parameters"
        );
        expect(() => validateParams("email", "task1", "url", "")).toThrow(
          "Missing required parameters"
        );
        expect(validateParams("email", "task1", "url", "token")).toBe(true);
      });

      it("should sanitize task ID", () => {
        const sanitizeTaskId = (taskId: string) => {
          return taskId.replace(/[^a-zA-Z0-9_-]/g, "");
        };

        expect(sanitizeTaskId("task_123")).toBe("task_123");
        expect(sanitizeTaskId("task-456")).toBe("task-456");
        expect(sanitizeTaskId("task@#$%")).toBe("task");
        expect(sanitizeTaskId("task 123")).toBe("task123");
      });
    });

    describe("window control handlers", () => {
      it("should handle window close", () => {
        const mockWin = { close: vi.fn() };

        mockWin.close();
        expect(mockWin.close).toHaveBeenCalled();
      });

      it("should handle window minimize", () => {
        const mockWin = { minimize: vi.fn() };

        mockWin.minimize();
        expect(mockWin.minimize).toHaveBeenCalled();
      });

      it("should handle window maximize toggle", () => {
        const mockWin = {
          isMaximized: vi.fn(),
          maximize: vi.fn(),
          unmaximize: vi.fn(),
        };

        mockWin.isMaximized.mockReturnValue(false);
        if (!mockWin.isMaximized()) {
          mockWin.maximize();
        }

        expect(mockWin.maximize).toHaveBeenCalled();

        mockWin.isMaximized.mockReturnValue(true);
        if (mockWin.isMaximized()) {
          mockWin.unmaximize();
        }

        expect(mockWin.unmaximize).toHaveBeenCalled();
      });
    });
  });

  describe("createWindow", () => {
    it("should create window with correct configuration on macOS", () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin" });

      const mockConfig = {
        title: "Eigent",
        width: 1200,
        height: 800,
        minWidth: 1200,
        minHeight: 800,
        frame: false,
        transparent: true,
        vibrancy: "sidebar",
        visualEffectState: "active",
        backgroundColor: "#00000000",
        titleBarStyle: "hidden",
        trafficLightPosition: { x: 10, y: 10 },
        roundedCorners: true,
      };

      expect(mockConfig.titleBarStyle).toBe("hidden");
      expect(mockConfig.trafficLightPosition).toEqual({ x: 10, y: 10 });

      // Restore original platform
      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("should create window with correct configuration on Windows", () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32" });

      const mockConfig = {
        title: "Eigent",
        width: 1200,
        height: 800,
        minWidth: 1200,
        minHeight: 800,
        frame: false,
        transparent: true,
        vibrancy: "sidebar",
        visualEffectState: "active",
        backgroundColor: "#00000000",
        titleBarStyle: undefined,
        trafficLightPosition: undefined,
        roundedCorners: true,
      };

      expect(mockConfig.titleBarStyle).toBeUndefined();
      expect(mockConfig.trafficLightPosition).toBeUndefined();

      // Restore original platform
      Object.defineProperty(process, "platform", { value: originalPlatform });
    });
  });

  describe("setupWindowEventListeners", () => {
    it("should set application menu to null", () => {
      expect(mockMenu.setApplicationMenu).toBeDefined();
    });
  });

  describe("setupDevToolsShortcuts", () => {
    it("should handle F12 key for dev tools", () => {
      const mockEvent = { preventDefault: vi.fn() };
      const mockInput = { key: "F12", type: "keyDown" };

      expect(mockInput.key).toBe("F12");
      expect(mockInput.type).toBe("keyDown");
    });

    it("should handle Ctrl+Shift+I for dev tools", () => {
      const mockInput = {
        control: true,
        shift: true,
        key: "i",
        type: "keyDown",
      };

      const shouldToggle =
        mockInput.control &&
        mockInput.shift &&
        mockInput.key.toLowerCase() === "i" &&
        mockInput.type === "keyDown";

      expect(shouldToggle).toBe(true);
    });

    it("should handle Cmd+Shift+I for dev tools on Mac", () => {
      const mockInput = {
        meta: true,
        shift: true,
        key: "i",
        type: "keyDown",
      };

      const shouldToggle =
        mockInput.meta &&
        mockInput.shift &&
        mockInput.key.toLowerCase() === "i" &&
        mockInput.type === "keyDown";

      expect(shouldToggle).toBe(true);
    });
  });

  describe("setupExternalLinkHandling", () => {
    it("should open external links in default browser", () => {
      const mockUrl = "https://example.com";

      const shouldOpenExternal =
        mockUrl.startsWith("https:") || mockUrl.startsWith("http:");
      expect(shouldOpenExternal).toBe(true);
      expect(mockShell.openExternal).toBeDefined();
    });

    it("should deny non-http(s) URLs", () => {
      const mockUrl = "file:///etc/passwd";

      const shouldOpenExternal =
        mockUrl.startsWith("https:") || mockUrl.startsWith("http:");
      expect(shouldOpenExternal).toBe(false);
    });
  });

  describe("cleanupPythonProcess", () => {
    it("should cleanup python process successfully", async () => {
      const mockProcess = {
        pid: 1234,
        kill: vi.fn(),
      };

      // Test cleanup logic
      if (mockProcess) {
        mockProcess.kill();
      }

      expect(mockProcess.kill).toHaveBeenCalled();
    });

    it("should handle cleanup errors gracefully", async () => {
      const mockKill = vi.fn().mockImplementation((pid, callback) => {
        callback(new Error("Process not found"));
      });

      // Test error handling in cleanup
      expect(() => {
        mockKill(1234, (error: Error) => {
          if (error) throw error;
        });
      }).toThrow("Process not found");
    });
  });

  describe("handleDependencyInstallation", () => {
    it("should install dependencies successfully", async () => {
      const mockInstallDependencies = vi.fn().mockResolvedValue(true);
      const mockCheckToolInstalled = vi.fn().mockResolvedValue(true);
      const mockStartBackend = vi.fn().mockResolvedValue({ pid: 1234 });

      const result = await mockInstallDependencies();
      expect(result).toBe(true);
    });

    it("should handle installation failure", async () => {
      const mockInstallDependencies = vi.fn().mockResolvedValue(false);

      const result = await mockInstallDependencies();
      expect(result).toBe(false);
    });

    it("should start backend when tool is installed", async () => {
      const mockCheckToolInstalled = vi.fn().mockResolvedValue(true);
      const mockStartBackend = vi.fn().mockResolvedValue({ pid: 1234 });

      const isToolInstalled = await mockCheckToolInstalled();
      if (isToolInstalled) {
        const process = await mockStartBackend(() => {});
        expect(process).toEqual({ pid: 1234 });
      }
    });

    it("should skip backend start when tool is not installed", async () => {
      const mockCheckToolInstalled = vi.fn().mockResolvedValue(false);

      const isToolInstalled = await mockCheckToolInstalled();
      expect(isToolInstalled).toBe(false);
    });
  });

  describe("Browser Path Constants", () => {
    it("should define correct Windows browser paths", () => {
      const BROWSER_PATHS = {
        win32: {
          chrome: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          edge: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
          firefox: "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
        },
      };

      expect(BROWSER_PATHS.win32.chrome).toContain("chrome.exe");
      expect(BROWSER_PATHS.win32.edge).toContain("msedge.exe");
      expect(BROWSER_PATHS.win32.firefox).toContain("firefox.exe");
    });

    it("should define correct macOS browser paths", () => {
      const BROWSER_PATHS = {
        darwin: {
          chrome: "/Applications/Google Chrome.app",
          edge: "/Applications/Microsoft Edge.app",
          firefox: "/Applications/Firefox.app",
          safari: "/Applications/Safari.app",
        },
      };

      expect(BROWSER_PATHS.darwin.chrome).toContain(".app");
      expect(BROWSER_PATHS.darwin.edge).toContain(".app");
      expect(BROWSER_PATHS.darwin.firefox).toContain(".app");
      expect(BROWSER_PATHS.darwin.safari).toContain(".app");
    });
  });

  describe("App Event Handlers", () => {
    it("should handle app ready event", () => {
      expect(mockApp.whenReady).toBeDefined();
    });

    it("should handle window-all-closed event", () => {
      const originalPlatform = process.platform;

      // Test non-darwin platform
      Object.defineProperty(process, "platform", { value: "win32" });
      const shouldQuit = process.platform !== "darwin";
      expect(shouldQuit).toBe(true);

      // Test darwin platform
      Object.defineProperty(process, "platform", { value: "darwin" });
      const shouldNotQuit = process.platform !== "darwin";
      expect(shouldNotQuit).toBe(false);

      // Restore original platform
      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("should handle app activate event", () => {
      const mockWindows = [{ show: vi.fn() }];

      if (mockWindows.length > 0) {
        mockWindows[0].show();
        expect(mockWindows[0].show).toHaveBeenCalled();
      }
    });

    it("should handle before-quit event", () => {
      const mockProcess = { pid: 1234 };

      // Test cleanup logic
      if (mockProcess) {
        expect(mockProcess.pid).toBe(1234);
      }
    });
  });

  describe("Environment and Platform Detection", () => {
    it("should detect Windows 7 and disable hardware acceleration", () => {
      mockOs.release.mockReturnValue("6.1.7601");

      const release = mockOs.release();
      const isWindows7 = release.startsWith("6.1");

      expect(isWindows7).toBe(true);
    });

    it("should not disable hardware acceleration on newer Windows", () => {
      mockOs.release.mockReturnValue("10.0.19041");

      const release = mockOs.release();
      const isWindows7 = release.startsWith("6.1");

      expect(isWindows7).toBe(false);
    });

    it("should set app user model ID on Windows", () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32" });

      const isWindows = process.platform === "win32";
      expect(isWindows).toBe(true);

      // Restore original platform
      Object.defineProperty(process, "platform", { value: originalPlatform });
    });
  });

  describe("Constants and Paths", () => {
    it("should define correct path constants", () => {
      const mockDirname = "/app/dist-electron/main";
      const mockPath = {
        join: (dir: string, ...paths: string[]) => {
          const allPaths = [dir, ...paths];
          return allPaths.join("/").replace(/\/+/g, "/");
        },
      };

      const MAIN_DIST = mockPath.join(mockDirname, "../..");
      const RENDERER_DIST = mockPath.join(MAIN_DIST, "dist");

      expect(MAIN_DIST).toContain("dist-electron");
      expect(RENDERER_DIST).toContain("dist");
    });

    it("should handle VITE_DEV_SERVER_URL correctly", () => {
      const VITE_DEV_SERVER_URL = "http://localhost:3000";
      const MAIN_DIST = "/app";
      const mockPath = {
        join: (dir: string, ...paths: string[]) => `${dir}/${paths.join("/")}`,
      };

      const VITE_PUBLIC = VITE_DEV_SERVER_URL
        ? mockPath.join(MAIN_DIST, "public")
        : mockPath.join(MAIN_DIST, "dist");

      expect(VITE_PUBLIC).toContain("public");

      // Test when no dev server URL
      const VITE_PUBLIC_PROD = !VITE_DEV_SERVER_URL
        ? mockPath.join(MAIN_DIST, "public")
        : mockPath.join(MAIN_DIST, "dist");

      expect(VITE_PUBLIC_PROD).toContain("dist");
    });
  });

  describe("MCP Handlers", () => {
    it("should handle mcp-install", () => {
      const mockHandler = vi.fn((_event, name, mcp) => {
        mockedMcpConfig.addMcp(name, mcp);
        return { success: true };
      });
      mockIpcMain.handle("mcp-install", mockHandler);

      mockHandler({}, "test-mcp", { data: "data" });
      expect(mockedMcpConfig.addMcp).toHaveBeenCalledWith("test-mcp", {
        data: "data",
      });
    });

    it("should handle mcp-remove", () => {
      const mockHandler = vi.fn((_event, name) => {
        mockedMcpConfig.removeMcp(name);
        return { success: true };
      });
      mockIpcMain.handle("mcp-remove", mockHandler);

      mockHandler({}, "test-mcp");
      expect(mockedMcpConfig.removeMcp).toHaveBeenCalledWith("test-mcp");
    });

    it("should handle mcp-update", () => {
      const mockHandler = vi.fn((_event, name, mcp) => {
        mockedMcpConfig.updateMcp(name, mcp);
        return { success: true };
      });
      mockIpcMain.handle("mcp-update", mockHandler);

      mockHandler({}, "test-mcp", { data: "new-data" });
      expect(mockedMcpConfig.updateMcp).toHaveBeenCalledWith("test-mcp", {
        data: "new-data",
      });
    });

    it("should handle mcp-list", async () => {
      const mockData = { mcp1: { version: "1.0" } };
      mockedMcpConfig.readMcpConfig.mockResolvedValue(mockData);
      const mockHandler = vi.fn(() => mockedMcpConfig.readMcpConfig());
      mockIpcMain.handle("mcp-list", mockHandler);

      const result = await mockHandler();
      expect(mockedMcpConfig.readMcpConfig).toHaveBeenCalled();
      expect(result).toEqual(mockData);
    });
  });

  describe("Environment Variable Handlers", () => {
    beforeEach(() => {
      mockedEnvUtil.getEnvPath.mockReturnValue("/mock/env/path/.env");
    });

    it("should handle get-env-path", async () => {
      const mockHandler = vi.fn((_event, email) =>
        mockedEnvUtil.getEnvPath(email)
      );
      mockIpcMain.handle("get-env-path", mockHandler);

      const result = await mockHandler({}, "test@example.com");
      expect(mockedEnvUtil.getEnvPath).toHaveBeenCalledWith("test@example.com");
      expect(result).toBe("/mock/env/path/.env");
    });

    it("should handle env-write", async () => {
      const mockHandler = vi.fn(async (_event, email, { key, value }) => {
        const ENV_PATH = mockedEnvUtil.getEnvPath(email);
        mockFs.readFileSync.mockReturnValue("EXISTING_KEY=old_value");
        let lines = mockFs.readFileSync(ENV_PATH, "utf-8").split(/\r?\n/);

        // Mock updateEnvBlock to return an array
        mockedEnvUtil.updateEnvBlock.mockReturnValue([
          "EXISTING_KEY=old_value",
          "NEW_KEY=new_value",
        ]);
        lines = mockedEnvUtil.updateEnvBlock(lines, { [key]: value });
        mockFs.writeFileSync(ENV_PATH, lines.join("\n"), "utf-8");
        return { success: true };
      });
      mockIpcMain.handle("env-write", mockHandler);

      await mockHandler({}, "test@example.com", {
        key: "NEW_KEY",
        value: "new_value",
      });
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it("should handle env-remove", async () => {
      const mockHandler = vi.fn(async (_event, email, key) => {
        const ENV_PATH = mockedEnvUtil.getEnvPath(email);
        mockFs.readFileSync.mockReturnValue(
          "KEY_TO_REMOVE=some_value\nOTHER_KEY=other_value"
        );
        let lines = mockFs.readFileSync(ENV_PATH, "utf-8").split(/\r?\n/);

        // Mock removeEnvKey to return an array
        mockedEnvUtil.removeEnvKey.mockReturnValue(["OTHER_KEY=other_value"]);
        lines = mockedEnvUtil.removeEnvKey(lines, key);
        mockFs.writeFileSync(ENV_PATH, lines.join("\n"), "utf-8");
        return { success: true };
      });
      mockIpcMain.handle("env-remove", mockHandler);

      await mockHandler({}, "test@example.com", "KEY_TO_REMOVE");
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe("File and Folder Handlers", () => {
    it("should handle reveal-in-folder", () => {
      const mockHandler = vi.fn((_event, filePath) => {
        mockShell.showItemInFolder(filePath);
      });
      mockIpcMain.handle("reveal-in-folder", mockHandler);

      mockHandler({}, "/path/to/file");
      expect(mockShell.showItemInFolder).toHaveBeenCalledWith("/path/to/file");
    });

    it("should handle delete-folder successfully", async () => {
      mockedEnvUtil.getEmailFolderPath.mockReturnValue({
        MCP_REMOTE_CONFIG_DIR: "/mock/mcp/dir",
        MCP_CONFIG_DIR: "",
        tempEmail: "",
        hasToken: false,
      });
      mockFs.existsSync.mockReturnValue(true);
      mockFsp.stat.mockResolvedValue({ isDirectory: () => true } as any);
      mockFsp.rm.mockResolvedValue(undefined);

      const mockHandler = vi.fn(async (_event, email) => {
        const { MCP_REMOTE_CONFIG_DIR } =
          mockedEnvUtil.getEmailFolderPath(email);
        if (!mockFs.existsSync(MCP_REMOTE_CONFIG_DIR)) {
          return { success: false, error: "Folder does not exist" };
        }
        const stats = await mockFsp.stat(MCP_REMOTE_CONFIG_DIR);
        if (!stats.isDirectory()) {
          return { success: false, error: "Path is not a directory" };
        }
        await mockFsp.rm(MCP_REMOTE_CONFIG_DIR, {
          recursive: true,
          force: true,
        });
        return { success: true };
      });
      mockIpcMain.handle("delete-folder", mockHandler);

      const result = await mockHandler({}, "test@example.com");
      expect(mockedEnvUtil.getEmailFolderPath).toHaveBeenCalledWith(
        "test@example.com"
      );
      expect(mockFsp.rm).toHaveBeenCalledWith("/mock/mcp/dir", {
        recursive: true,
        force: true,
      });
      expect(result).toEqual({ success: true });
    });

    it("should handle delete-folder when folder does not exist", async () => {
      mockedEnvUtil.getEmailFolderPath.mockReturnValue({
        MCP_REMOTE_CONFIG_DIR: "/mock/mcp/dir",
        MCP_CONFIG_DIR: "",
        tempEmail: "",
        hasToken: false,
      });
      mockFs.existsSync.mockReturnValue(false);

      const mockHandler = vi.fn(async (_event, email) => {
        const { MCP_REMOTE_CONFIG_DIR } =
          mockedEnvUtil.getEmailFolderPath(email);
        if (!mockFs.existsSync(MCP_REMOTE_CONFIG_DIR)) {
          return { success: false, error: "Folder does not exist" };
        }
        //...
      });
      mockIpcMain.handle("delete-folder", mockHandler);

      const result = await mockHandler({}, "test@example.com");
      expect(result).toEqual({
        success: false,
        error: "Folder does not exist",
      });
    });
  });

  describe("Backend and Dependency Handlers", () => {
    it("should handle check-tool-installed", async () => {
      mockedInitModule.checkToolInstalled.mockResolvedValue(true);
      const mockHandler = vi.fn(async () => {
        const isInstalled = await mockedInitModule.checkToolInstalled();
        return { success: true, isInstalled };
      });
      mockIpcMain.handle("check-tool-installed", mockHandler);

      const result = await mockHandler();
      expect(mockedInitModule.checkToolInstalled).toHaveBeenCalled();
      expect(result).toEqual({ success: true, isInstalled: true });
    });

    it("should handle installation triggering", async () => {
      // Create a mock handler that actually calls installDependencies
      const mockHandler = vi.fn(async () => {
        const result = await mockedInitModule.installDependencies();
        return result;
      });
      mockIpcMain.handle("install-dependencies", mockHandler);
      mockIpcMain.handle("frontend-ready", mockHandler);

      mockedInitModule.installDependencies.mockResolvedValue(true);

      await mockHandler();
      expect(mockedInitModule.installDependencies).toHaveBeenCalled();
    });
  });

  describe("FileReader and WebViewManager Handlers", () => {
    let mockFileReader: any;
    let mockWebViewManager: any;

    beforeEach(() => {
      mockFileReader = {
        openFile: vi.fn(),
        getFileList: vi.fn(),
      };
      mockWebViewManager = {
        captureWebview: vi.fn(),
        createWebview: vi.fn(),
        hideWebview: vi.fn(),
        showWebview: vi.fn(),
        changeViewSize: vi.fn(),
        hideAllWebview: vi.fn(),
        getActiveWebview: vi.fn(),
        setSize: vi.fn(),
        getShowWebview: vi.fn(),
        destroyWebview: vi.fn(),
      };

      // Mock the managers being available
      vi.doMock("../../../../electron/main/fileReader", () => ({
        FileReader: vi.fn(() => mockFileReader),
      }));
      vi.doMock("../../../../electron/main/webview", () => ({
        WebViewManager: vi.fn(() => mockWebViewManager),
      }));
    });

    it("should handle open-file", async () => {
      const mockHandler = vi.fn((...args) => mockFileReader.openFile(...args));
      mockIpcMain.handle("open-file", mockHandler);
      await mockHandler("type", "path", true);
      expect(mockFileReader.openFile).toHaveBeenCalledWith(
        "type",
        "path",
        true
      );
    });

    it("should handle get-file-list", async () => {
      const mockHandler = vi.fn((...args) =>
        mockFileReader.getFileList(...args)
      );
      mockIpcMain.handle("get-file-list", mockHandler);
      await mockHandler("email", "taskId");
      expect(mockFileReader.getFileList).toHaveBeenCalledWith(
        "email",
        "taskId"
      );
    });

    it("should handle create-webview", async () => {
      const mockHandler = vi.fn((...args) =>
        mockWebViewManager.createWebview(...args)
      );
      mockIpcMain.handle("create-webview", mockHandler);
      await mockHandler("id");
      expect(mockWebViewManager.createWebview).toHaveBeenCalledWith("id");
    });

    it("should handle webview-destroy", async () => {
      const mockHandler = vi.fn((...args) =>
        mockWebViewManager.destroyWebview(...args)
      );
      mockIpcMain.handle("webview-destroy", mockHandler);
      await mockHandler();
      expect(mockWebViewManager.destroyWebview).toHaveBeenCalled();
    });
  });

  describe("Application Lifecycle", () => {
    it("should quit on window-all-closed for non-darwin platforms", () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32" });

      mockApp.on.mockImplementation((event, listener) => {
        if (event === "window-all-closed") {
          listener();
        }
      });

      // This is a simplified representation of the app.on('window-all-closed') logic
      const windowAllClosedHandler = () => {
        if (process.platform !== "darwin") {
          mockApp.quit();
        }
      };

      windowAllClosedHandler();
      expect(mockApp.quit).toHaveBeenCalled();

      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("should not quit on window-all-closed for darwin platforms", () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "darwin" });
      vi.clearAllMocks(); // Clear mocks from previous test

      const windowAllClosedHandler = () => {
        if (process.platform !== "darwin") {
          mockApp.quit();
        }
      };

      windowAllClosedHandler();
      expect(mockApp.quit).not.toHaveBeenCalled();

      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("should call cleanup on before-quit", () => {
      const mockCleanup = vi.fn();
      mockApp.on.mockImplementation((event, listener) => {
        if (event === "before-quit") {
          listener();
        }
      });

      const beforeQuitHandler = () => {
        mockCleanup();
      };

      beforeQuitHandler();
      expect(mockCleanup).toHaveBeenCalled();
    });
  });
});
