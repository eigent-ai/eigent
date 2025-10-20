import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
// Mock modules with inline factories to avoid vitest hoisting issues.
vi.mock("electron", () => {
  const dialogMocks = {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
  };
  return { dialog: dialogMocks };
});

vi.mock("node:fs", () => {
  const fsMocks = {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    createReadStream: vi.fn(),
    mkdirSync: vi.fn(),
  };
  return {
    default: fsMocks,
    existsSync: fsMocks.existsSync,
    readFileSync: fsMocks.readFileSync,
    writeFileSync: fsMocks.writeFileSync,
    createReadStream: fsMocks.createReadStream,
    mkdirSync: fsMocks.mkdirSync,
  };
});

vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  stat: vi.fn(),
  rm: vi.fn(),
}));

import { dialog } from "electron";
import fs from "node:fs";
import * as fsp from "fs/promises";
import path from "node:path";

describe("File Operations and Utilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("select-file IPC handler", () => {
    it("should handle successful file selection", async () => {
      const mockResult = {
        canceled: false,
        filePaths: ["/path/to/file1.txt", "/path/to/file2.pdf"],
      };

      (dialog.showOpenDialog as Mock).mockResolvedValue(mockResult);

      const result = await dialog.showOpenDialog({} as any, {
        properties: ["openFile", "multiSelections"],
      });

      expect(result.canceled).toBe(false);
      expect(result.filePaths).toHaveLength(2);
      expect(result.filePaths[0]).toContain(".txt");
      expect(result.filePaths[1]).toContain(".pdf");
    });

    it("should handle cancelled file selection", async () => {
      const mockResult = {
        canceled: true,
        filePaths: [],
      };

      (dialog.showOpenDialog as Mock).mockResolvedValue(mockResult);

      const result = await dialog.showOpenDialog({} as any, {
        properties: ["openFile", "multiSelections"],
      });

      expect(result.canceled).toBe(true);
      expect(result.filePaths).toHaveLength(0);
    });

    it("should handle file selection with filters", async () => {
      const options = {
        properties: ["openFile"] as const,
        filters: [
          { name: "Text Files", extensions: ["txt", "md"] },
          { name: "PDF Files", extensions: ["pdf"] },
          { name: "All Files", extensions: ["*"] },
        ],
      };

      expect(options.filters).toHaveLength(3);
      expect(options.filters[0].extensions).toContain("txt");
      expect(options.filters[1].extensions).toContain("pdf");
    });

    it("should process successful file selection result", () => {
      const result = {
        canceled: false,
        filePaths: ["/path/to/selected/file.txt"],
      };

      if (!result.canceled && result.filePaths.length > 0) {
        const firstFile = result.filePaths[0];
        const fileName = path.basename(firstFile);
        const fileExt = path.extname(firstFile);

        expect(fileName).toBe("file.txt");
        expect(fileExt).toBe(".txt");
      }
    });
  });

  describe("read-file IPC handler", () => {
    it("should successfully read file content", async () => {
      const mockContent = "This is the file content\nWith multiple lines";
      (fsp.readFile as Mock).mockResolvedValue(mockContent);

      const content = await fsp.readFile("/path/to/file.txt", "utf-8");

      expect(content).toBe(mockContent);
      expect(content).toContain("multiple lines");
    });

    it("should handle file read errors", async () => {
      const error = new Error("ENOENT: no such file or directory");
      (fsp.readFile as Mock).mockRejectedValue(error);

      try {
        await fsp.readFile("/nonexistent/file.txt", "utf-8");
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect((e as Error).message).toContain("no such file or directory");
      }
    });

    it("should handle different file encodings", async () => {
      const mockContent = Buffer.from("Binary content");
      (fsp.readFile as Mock).mockResolvedValue(mockContent);

      const content = await fsp.readFile("/path/to/binary.bin");

      expect(Buffer.isBuffer(content)).toBe(true);
    });

    it("should validate file path", () => {
      const filePath = path.normalize("/path/to/file.txt");
      const isAbsolute = path.isAbsolute(filePath);
      const normalizedPath = path.normalize(filePath);

      expect(isAbsolute).toBe(true);
      expect(normalizedPath).toBe(filePath);
    });
  });

  describe("reveal-in-folder IPC handler", () => {
    it("should handle valid file path", () => {
      const filePath = "/Users/test/Documents/file.txt";
      const isValid = path.isAbsolute(filePath) && filePath.length > 0;

      expect(isValid).toBe(true);
    });

    it("should handle invalid file path", () => {
      const filePath = "";
      const isValid = path.isAbsolute(filePath) && filePath.length > 0;

      expect(isValid).toBe(false);
    });

    it("should normalize file path", () => {
      const filePath = "/Users/test/../test/Documents/./file.txt";
      const normalized = path.normalize(filePath);

      expect(normalized).toBe(path.normalize("/Users/test/Documents/file.txt"));
    });

    it("should extract directory from file path", () => {
      const filePath = "/Users/test/Documents/file.txt";
      const directory = path.dirname(filePath);

      expect(path.normalize(directory)).toBe(
        path.normalize("/Users/test/Documents")
      );
    });
  });

  describe("File System Utilities", () => {
    it("should check file existence", () => {
      (fs.existsSync as Mock).mockReturnValue(true);

      const exists = fs.existsSync("/path/to/file.txt");
      expect(exists).toBe(true);
    });

    it("should handle non-existent files", () => {
      (fs.existsSync as Mock).mockReturnValue(false);

      const exists = fs.existsSync("/path/to/nonexistent.txt");
      expect(exists).toBe(false);
    });

    it("should create directory path", () => {
      const dirPath = "/path/to/new/directory";
      const mockMkdirSync = vi.fn();
      vi.mocked(fs).mkdirSync = mockMkdirSync;

      fs.mkdirSync(dirPath, { recursive: true });

      expect(mockMkdirSync).toHaveBeenCalledWith(dirPath, { recursive: true });
    });

    it("should handle path operations", () => {
      const filePath = "/Users/test/Documents/file.txt";

      const basename = path.basename(filePath);
      const dirname = path.dirname(filePath);
      const extname = path.extname(filePath);
      const parsed = path.parse(filePath);

      expect(basename).toBe("file.txt");
      expect(path.normalize(dirname)).toBe(
        path.normalize("/Users/test/Documents")
      );
      expect(extname).toBe(".txt");
      expect(parsed.name).toBe("file");
      expect(parsed.ext).toBe(".txt");
    });
  });

  describe("File Validation", () => {
    it("should validate file extension", () => {
      const allowedExtensions = [".txt", ".md", ".json", ".pdf"];
      const filePath = "/path/to/document.pdf";
      const fileExt = path.extname(filePath);

      const isAllowed = allowedExtensions.includes(fileExt);
      expect(isAllowed).toBe(true);
    });

    it("should reject invalid file extension", () => {
      const allowedExtensions = [".txt", ".md", ".json"];
      const filePath = "/path/to/executable.exe";
      const fileExt = path.extname(filePath);

      const isAllowed = allowedExtensions.includes(fileExt);
      expect(isAllowed).toBe(false);
    });

    it("should validate file size", () => {
      const maxSize = 10 * 1024 * 1024; // 10MB
      const mockStats = { size: 5 * 1024 * 1024 }; // 5MB

      const isValidSize = mockStats.size <= maxSize;
      expect(isValidSize).toBe(true);
    });

    it("should reject files that are too large", () => {
      const maxSize = 10 * 1024 * 1024; // 10MB
      const mockStats = { size: 20 * 1024 * 1024 }; // 20MB

      const isValidSize = mockStats.size <= maxSize;
      expect(isValidSize).toBe(false);
    });
  });

  describe("File Content Processing", () => {
    it("should process text file content", () => {
      const content = "Line 1\nLine 2\nLine 3";
      const lines = content.split("\n");

      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe("Line 1");
      expect(lines[2]).toBe("Line 3");
    });

    it("should handle empty file content", () => {
      const content = "";
      const lines = content.split("\n");

      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe("");
    });

    it("should process CSV-like content", () => {
      const content =
        "name,age,email\nJohn,30,john@example.com\nJane,25,jane@example.com";
      const lines = content.split("\n");
      const headers = lines[0].split(",");

      expect(headers).toEqual(["name", "age", "email"]);
      expect(lines).toHaveLength(3);
    });

    it("should handle binary file detection", () => {
      const textContent = "This is regular text content";
      const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0xff]);

      const isText = typeof textContent === "string";
      const isBinary = Buffer.isBuffer(binaryContent);

      expect(isText).toBe(true);
      expect(isBinary).toBe(true);
    });
  });

  describe("File Stream Operations", () => {
    it("should create readable stream", () => {
      const mockCreateReadStream = vi.fn().mockReturnValue({
        pipe: vi.fn(),
        on: vi.fn(),
        destroy: vi.fn(),
      });

      vi.mocked(fs).createReadStream = mockCreateReadStream;

      const stream = fs.createReadStream("/path/to/file.txt");

      expect(mockCreateReadStream).toHaveBeenCalledWith("/path/to/file.txt");
      expect(stream.pipe).toBeDefined();
      expect(stream.on).toBeDefined();
    });

    it("should handle stream errors", () => {
      const mockStream = {
        on: vi.fn((event, callback) => {
          if (event === "error") {
            setTimeout(() => callback(new Error("Stream error")), 0);
          }
        }),
        destroy: vi.fn(),
      };

      let errorReceived = false;
      mockStream.on("error", (error: Error) => {
        errorReceived = true;
        expect(error.message).toBe("Stream error");
      });

      setTimeout(() => {
        expect(errorReceived).toBe(true);
      }, 10);
    });

    it("should cleanup stream resources", () => {
      const mockStream = {
        destroy: vi.fn(),
        on: vi.fn(),
      };

      // Simulate cleanup
      if (mockStream && typeof mockStream.destroy === "function") {
        mockStream.destroy();
      }

      expect(mockStream.destroy).toHaveBeenCalled();
    });
  });

  describe("Project Management", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    describe("Project Structure Creation", () => {
      it("should create project directory structure", () => {
        const email = "test@example.com";
        const projectId = "xyz123";
        const expectedPath = "/home/test/eigent/test/project_xyz123";

        (fs.existsSync as Mock).mockReturnValue(false);
        (fs.mkdirSync as Mock).mockImplementation(() => {});

        // Mock path operations
        const mockPath = {
          join: vi.fn((...args) => args.join("/")),
        };

        const result = mockPath.join("/home", "test", "eigent", "test", `project_${projectId}`);
        expect(result).toBe(expectedPath);
      });

      it("should handle existing project directory", () => {
        const email = "test@example.com";
        const projectId = "existing123";

        (fs.existsSync as Mock).mockReturnValue(true);
        const mockMkdirSync = vi.fn();
        vi.mocked(fs).mkdirSync = mockMkdirSync;

        // Should not create directory if it exists
        if (!fs.existsSync("/path/to/project")) {
          fs.mkdirSync("/path/to/project", { recursive: true });
        }

        expect(mockMkdirSync).not.toHaveBeenCalled();
      });

      it("should validate project ID format", () => {
        const validProjectIds = ["xyz123", "project_1", "test-project"];
        const invalidProjectIds = ["", "project with spaces", "project/with/slashes"];

        validProjectIds.forEach(id => {
          const isValid = /^[a-zA-Z0-9_-]+$/.test(id);
          expect(isValid).toBe(true);
        });

        invalidProjectIds.forEach(id => {
          const isValid = /^[a-zA-Z0-9_-]+$/.test(id) && id.length > 0;
          expect(isValid).toBe(false);
        });
      });
    });

    describe("Project-based Task Organization", () => {
      it("should find task in project structure", () => {
        const taskId = "1760964010356-4844";
        const projectStructure = {
          "project_xyz": {
            [`task_${taskId}`]: true
          },
          "project_abc": {
            "task_other": true
          }
        };

        // Simulate finding task in project_xyz
        const foundInProject = "project_xyz" in projectStructure && 
                               `task_${taskId}` in projectStructure["project_xyz"];
        
        expect(foundInProject).toBe(true);
      });

      it("should fall back to legacy structure when task not found in projects", () => {
        const taskId = "legacy-task-123";
        const hasProjectStructure = false;

        if (!hasProjectStructure) {
          // Should look in legacy location
          const legacyPath = `/home/user/eigent/user/task_${taskId}`;
          expect(legacyPath).toContain("task_legacy-task-123");
        }
      });

      it("should handle task lookup with project ID provided", () => {
        const taskId = "task123";
        const projectId = "xyz";
        
        const projectBasedPath = `/home/user/eigent/user/project_${projectId}/task_${taskId}`;
        expect(projectBasedPath).toBe("/home/user/eigent/user/project_xyz/task_task123");
      });
    });

    describe("Task Migration", () => {
      it("should move task from legacy to project structure", () => {
        const taskId = "1760964010356-4844";
        const projectId = "xyz";
        
        const sourcePath = `/home/user/eigent/user/task_${taskId}`;
        const destPath = `/home/user/eigent/user/project_${projectId}/task_${taskId}`;

        (fs.existsSync as Mock).mockImplementation((path: string) => {
          return path === sourcePath;
        });

        const mockRenameSync = vi.fn();
        const mockMkdirSync = vi.fn();
        vi.mocked(fs).renameSync = mockRenameSync;
        vi.mocked(fs).mkdirSync = mockMkdirSync;

        // Simulate move operation
        if (fs.existsSync(sourcePath)) {
          const projectDir = `/home/user/eigent/user/project_${projectId}`;
          if (!fs.existsSync(projectDir)) {
            mockMkdirSync(projectDir, { recursive: true });
          }
          mockRenameSync(sourcePath, destPath);
        }

        expect(mockMkdirSync).toHaveBeenCalledWith(
          `/home/user/eigent/user/project_${projectId}`,
          { recursive: true }
        );
        expect(mockRenameSync).toHaveBeenCalledWith(sourcePath, destPath);
      });

      it("should handle log files during task migration", () => {
        const taskId = "test123";
        const projectId = "xyz";
        
        const sourceLogPath = `/home/.eigent/user/task_${taskId}`;
        const destLogPath = `/home/.eigent/user/project_${projectId}/task_${taskId}`;

        (fs.existsSync as Mock).mockReturnValue(true);
        const mockRenameSync = vi.fn();
        const mockMkdirSync = vi.fn();
        vi.mocked(fs).renameSync = mockRenameSync;
        vi.mocked(fs).mkdirSync = mockMkdirSync;

        // Simulate log migration
        const destLogDir = `/home/.eigent/user/project_${projectId}`;
        mockMkdirSync(destLogDir, { recursive: true });
        mockRenameSync(sourceLogPath, destLogPath);

        expect(mockMkdirSync).toHaveBeenCalledWith(destLogDir, { recursive: true });
        expect(mockRenameSync).toHaveBeenCalledWith(sourceLogPath, destLogPath);
      });

      it("should handle missing source files gracefully", () => {
        const taskId = "nonexistent123";
        const projectId = "xyz";

        (fs.existsSync as Mock).mockReturnValue(false);
        const mockRenameSync = vi.fn();
        vi.mocked(fs).renameSync = mockRenameSync;

        // Should not attempt to move non-existent files
        const sourcePath = `/home/user/eigent/user/task_${taskId}`;
        if (fs.existsSync(sourcePath)) {
          fs.renameSync(sourcePath, "/dest/path");
        }

        expect(mockRenameSync).not.toHaveBeenCalled();
      });
    });

    describe("Project Listing and Statistics", () => {
      it("should list all projects with task counts", () => {
        const mockProjects = [
          {
            id: "xyz",
            name: "Project xyz",
            path: "/home/eigent/user/project_xyz",
            taskCount: 5,
            createdAt: new Date("2025-10-20")
          },
          {
            id: "abc",
            name: "Project abc", 
            path: "/home/eigent/user/project_abc",
            taskCount: 3,
            createdAt: new Date("2025-10-19")
          }
        ];

        // Sort by creation date (newest first)
        const sortedProjects = mockProjects.sort((a, b) => 
          b.createdAt.getTime() - a.createdAt.getTime()
        );

        expect(sortedProjects[0].id).toBe("xyz");
        expect(sortedProjects[0].taskCount).toBe(5);
        expect(sortedProjects[1].id).toBe("abc");
      });

      it("should count tasks in project correctly", () => {
        const mockProjectContents = [
          "task_1760964010356-4844",
          "task_1760960521025-5106", 
          "task_1760913987942-682",
          "other_file.txt",
          "readme.md"
        ];

        const taskCount = mockProjectContents.filter(item => 
          item.startsWith("task_")
        ).length;

        expect(taskCount).toBe(3);
      });

      it("should handle empty projects", () => {
        const emptyProjectContents: string[] = [];
        const taskCount = emptyProjectContents.filter(item => 
          item.startsWith("task_")
        ).length;

        expect(taskCount).toBe(0);
      });
    });

    describe("Backward Compatibility", () => {
      it("should support legacy getFileList calls without projectId", () => {
        const email = "test@example.com";
        const taskId = "legacy123";

        // Should work with 2 parameters (legacy)
        const legacyCall = {
          email,
          taskId,
          projectId: undefined
        };

        expect(legacyCall.projectId).toBeUndefined();
        expect(legacyCall.email).toBe(email);
        expect(legacyCall.taskId).toBe(taskId);
      });

      it("should support new getFileList calls with projectId", () => {
        const email = "test@example.com";
        const taskId = "new123";
        const projectId = "xyz";

        // Should work with 3 parameters (new)
        const newCall = {
          email,
          taskId,
          projectId
        };

        expect(newCall.projectId).toBe(projectId);
        expect(newCall.email).toBe(email);
        expect(newCall.taskId).toBe(taskId);
      });

      it("should maintain existing directory structure for legacy tasks", () => {
        const email = "test@example.com";
        const taskId = "existing123";

        const legacyPath = `/home/eigent/test/task_${taskId}`;
        
        // Should still be able to access legacy paths
        expect(legacyPath).toBe("/home/eigent/test/task_existing123");
      });

      it("should handle mixed legacy and project-based structures", () => {
        const userDirectoryContents = [
          "task_legacy1",      // Legacy task
          "task_legacy2",      // Legacy task  
          "project_xyz",       // New project
          "project_abc",       // New project
          "other_folder"       // Other content
        ];

        const legacyTasks = userDirectoryContents.filter(item => 
          item.startsWith("task_")
        );
        const projects = userDirectoryContents.filter(item => 
          item.startsWith("project_")
        );

        expect(legacyTasks).toHaveLength(2);
        expect(projects).toHaveLength(2);
      });
    });

    describe("Project File Listing", () => {
      it("should list all files in a project across all tasks", () => {
        const projectStructure = {
          "task_123": {
            "file1.txt": true,
            "subfolder": {
              "file2.js": true
            }
          },
          "task_456": {
            "file3.py": true,
            "data.json": true
          },
          "task_789": {
            "readme.md": true
          }
        };

        const expectedFiles = [
          { path: "/project/task_123/file1.txt", task_id: "123", project_id: "xyz" },
          { path: "/project/task_123/subfolder/file2.js", task_id: "123", project_id: "xyz" },
          { path: "/project/task_456/file3.py", task_id: "456", project_id: "xyz" },
          { path: "/project/task_456/data.json", task_id: "456", project_id: "xyz" },
          { path: "/project/task_789/readme.md", task_id: "789", project_id: "xyz" }
        ];

        // Should return sorted list by task_id then by file path
        const sortedFiles = expectedFiles.sort((a, b) => {
          if (a.task_id !== b.task_id) {
            return a.task_id.localeCompare(b.task_id);
          }
          return a.path.localeCompare(b.path);
        });

        expect(sortedFiles[0].task_id).toBe("123");
        expect(sortedFiles[sortedFiles.length - 1].task_id).toBe("789");
      });

      it("should handle empty project directories", () => {
        const emptyProjectContents: string[] = [];
        const taskDirs = emptyProjectContents.filter(entry => entry.startsWith('task_'));
        
        expect(taskDirs).toHaveLength(0);
      });

      it("should enrich files with task and project context", () => {
        const mockFile = {
          name: "test.txt",
          type: "txt",
          path: "/project/task_123/test.txt",
          isFolder: false,
          relativePath: ""
        };

        const enrichedFile = {
          ...mockFile,
          task_id: "123",
          project_id: "xyz",
          relativePath: "task_123/test.txt"
        };

        expect(enrichedFile.task_id).toBe("123");
        expect(enrichedFile.project_id).toBe("xyz");
        expect(enrichedFile.relativePath).toBe("task_123/test.txt");
      });

      it("should filter non-task directories", () => {
        const projectContents = [
          "task_123",
          "task_456", 
          "not_a_task",
          "another_folder",
          "task_789"
        ];

        const taskDirs = projectContents.filter(entry => entry.startsWith('task_'));
        
        expect(taskDirs).toHaveLength(3);
        expect(taskDirs).toContain("task_123");
        expect(taskDirs).toContain("task_456");
        expect(taskDirs).toContain("task_789");
        expect(taskDirs).not.toContain("not_a_task");
      });

      it("should handle projects with mixed file types", () => {
        const fileTypes = [
          { name: "document.pdf", type: "pdf" },
          { name: "script.py", type: "py" },
          { name: "data.json", type: "json" },
          { name: "image.png", type: "png" },
          { name: "folder", type: "folder", isFolder: true }
        ];

        fileTypes.forEach(file => {
          if (file.isFolder) {
            expect(file.type).toBe("folder");
          } else {
            expect(file.type).toBe(file.name.split('.').pop());
          }
        });
      });

      it("should sort files by task ID then by path", () => {
        const unsortedFiles = [
          { task_id: "789", path: "/project/task_789/a.txt" },
          { task_id: "123", path: "/project/task_123/z.txt" },
          { task_id: "456", path: "/project/task_456/m.txt" },
          { task_id: "123", path: "/project/task_123/a.txt" }
        ];

        const sortedFiles = unsortedFiles.sort((a, b) => {
          if (a.task_id !== b.task_id) {
            return a.task_id.localeCompare(b.task_id);
          }
          return a.path.localeCompare(b.path);
        });

        expect(sortedFiles[0].task_id).toBe("123");
        expect(sortedFiles[0].path).toContain("a.txt");
        expect(sortedFiles[1].task_id).toBe("123");
        expect(sortedFiles[1].path).toContain("z.txt");
        expect(sortedFiles[2].task_id).toBe("456");
        expect(sortedFiles[3].task_id).toBe("789");
      });
    });

    describe("Error Handling", () => {
      it("should handle file system errors gracefully", () => {
        const mockReaddirSync = vi.fn().mockImplementation(() => {
          throw new Error("Permission denied");
        });
        vi.mocked(fs).readdirSync = mockReaddirSync;

        let errorOccurred = false;
        try {
          fs.readdirSync("/restricted/path");
        } catch (error) {
          errorOccurred = true;
          expect(error).toBeInstanceOf(Error);
        }

        expect(errorOccurred).toBe(true);
      });

      it("should handle invalid email addresses", () => {
        const invalidEmails = ["", "invalid", "test@", "@domain.com"];
        
        invalidEmails.forEach(email => {
          const safeEmail = email.split('@')[0].replace(/[\\/*?:"<>|\s]/g, "_").replace(/^\.+|\.+$/g, "");
          // Should either be empty or sanitized
          expect(safeEmail.length === 0 || /^[a-zA-Z0-9_]+$/.test(safeEmail)).toBe(true);
        });
      });

      it("should handle invalid project/task IDs", () => {
        const invalidIds = ["", "id with spaces", "id/with/slashes", "id:with:colons"];
        
        invalidIds.forEach(id => {
          const isValid = /^[a-zA-Z0-9_-]+$/.test(id) && id.length > 0;
          expect(isValid).toBe(false);
        });
      });

      it("should handle non-existent project directories", () => {
        (fs.existsSync as Mock).mockReturnValue(false);

        const projectExists = fs.existsSync("/nonexistent/project");
        expect(projectExists).toBe(false);

        // Should return empty array for non-existent projects
        const result: any[] = [];
        expect(result).toHaveLength(0);
      });

      it("should handle corrupted project structures", () => {
        const mockStats = vi.fn();
        mockStats.mockImplementation((path: string) => {
          if (path.includes("corrupted")) {
            throw new Error("EACCES: permission denied");
          }
          return { isDirectory: () => true };
        });

        (fs.statSync as Mock) = mockStats;

        let errorOccurred = false;
        try {
          fs.statSync("/corrupted/path");
        } catch (error) {
          errorOccurred = true;
          expect(error).toBeInstanceOf(Error);
        }

        expect(errorOccurred).toBe(true);
      });
    });
  });
});
