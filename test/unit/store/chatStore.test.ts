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
 * ChatStore Unit Tests - Core Functionality
 *
 * Tests basic chatStore operations:
 * - Task creation and removal
 * - Status management
 * - Token tracking
 * - Message handling
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock dependencies - moved to top before other imports
vi.mock('@/api/http', async () => {
  const { fetchEventSource } = await import('@microsoft/fetch-event-source');
  const getBaseURL = vi.fn(() => Promise.resolve('http://localhost:8000'));

  return {
    fetchGet: vi.fn(),
    fetchPost: vi.fn(),
    fetchPut: vi.fn(),
    getBaseURL,
    proxyFetchPost: vi.fn(() => Promise.resolve({ id: 'mock-history-id' })),
    proxyFetchPut: vi.fn(),
    proxyFetchGet: vi.fn(() =>
      Promise.resolve({
        value: '',
        api_url: '',
        items: [],
        warning_code: null,
      })
    ),
    uploadFile: vi.fn(),
    fetchDelete: vi.fn(),
    waitForBackendReady: vi.fn(() => Promise.resolve(true)),
    sseTransport: vi.fn(async (options: any) => {
      const baseURL = await getBaseURL();
      const fullUrl =
        options.url.startsWith('http://') || options.url.startsWith('https://')
          ? options.url
          : `${baseURL}${options.url}`;
      const body =
        typeof options.body === 'string'
          ? options.body
          : options.body
            ? JSON.stringify(options.body)
            : undefined;

      await fetchEventSource(fullUrl, {
        method: options.method || 'POST',
        openWhenHidden: options.openWhenHidden ?? true,
        signal: options.signal,
        headers: options.extraHeaders ?? {},
        body,
        onmessage: options.onmessage,
        onopen: options.onopen,
        onerror: options.onerror,
        onclose: options.onclose,
      });
    }),
  };
});

vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: vi.fn(),
}));

vi.mock('../../../src/store/authStore', () => ({
  useAuthStore: {
    token: null,
    username: null,
    email: null,
    user_id: null,
    appearance: 'light',
    language: 'system',
    isFirstLaunch: true,
    modelType: 'cloud' as const,
    cloud_model_type: 'gpt-5.4' as const,
    initState: 'carousel' as const,
    share_token: null,
    workerListData: {},
  },
  getAuthStore: vi.fn(() => ({
    token: null,
    username: null,
    email: null,
    user_id: null,
    appearance: 'light',
    language: 'system',
    isFirstLaunch: true,
    modelType: 'cloud' as const,
    cloud_model_type: 'gpt-5.4' as const,
    initState: 'carousel' as const,
    share_token: null,
    workerListData: {},
  })),
  useWorkerList: vi.fn(() => []),
  getWorkerList: vi.fn(() => []),
}));

vi.mock('../../../src/store/projectStore', () => ({
  useProjectStore: {
    getState: vi.fn(() => ({
      activeProjectId: null,
      getHistoryId: () => null,
      getProjectById: (projectId: string) => ({
        id: projectId,
        mode: 'single-agent',
      }),
    })),
  },
}));

import {
  fetchPost,
  fetchPut,
  proxyFetchGet,
  waitForBackendReady,
} from '@/api/http';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { generateUniqueId } from '../../../src/lib';
import {
  collectTaskUploadFiles,
  extractEndPayloadText,
  extractFinalOutputFileList,
  mergeFileInfoLists,
  normalizeTaskArtifactFileList,
  resolveConfirmedUserMessageContent,
  resolveEndMessageText,
  resolveRunOutputFileList,
  useChatStore,
} from '../../../src/store/chatStore';
import { useProjectStore } from '../../../src/store/projectStore';
import { ChatTaskStatus } from '../../../src/types/constants';

// Mock electron IPC
(global as any).ipcRenderer = {
  invoke: vi.fn((channel, ..._args) => {
    if (channel === 'get-system-language') return Promise.resolve('en');
    if (channel === 'get-browser-port') return Promise.resolve(9222);
    if (channel === 'get-env-path') return Promise.resolve('/path/to/env');
    if (channel === 'mcp-list') return Promise.resolve({});
    return Promise.resolve();
  }),
};

describe('ChatStore - Core Functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Confirmed user prompt resolution', () => {
    it('uses the optimistic user message when it exists', () => {
      expect(
        resolveConfirmedUserMessageContent({
          lastMessageContent: 'current typed prompt',
          messageContent: 'first prompt',
          question: 'backend current prompt',
          isFollowUpConfirm: true,
        })
      ).toBe('current typed prompt');
    });

    it('uses the SSE question for follow-up confirms before stale startTask content', () => {
      expect(
        resolveConfirmedUserMessageContent({
          messageContent: 'first prompt',
          question: 'follow-up prompt',
          isFollowUpConfirm: true,
        })
      ).toBe('follow-up prompt');
    });

    it('keeps first-run confirms on the captured startTask content before question', () => {
      expect(
        resolveConfirmedUserMessageContent({
          messageContent: 'first prompt',
          question: 'backend confirmed prompt',
          isFollowUpConfirm: false,
        })
      ).toBe('first prompt');
    });
  });

  describe('Cached task hydration', () => {
    it('does not resurrect a stale human-reply wait', () => {
      const { result } = renderHook(() => useChatStore());
      const taskId = result.current.getState().create();
      const cachedTask = {
        ...result.current.getState().tasks[taskId],
        activeAsk: 'Agents.single_agent',
        askList: [
          {
            id: 'queued-ask',
            role: 'agent',
            content: 'Old question',
            step: 'ask',
          },
        ],
        isPending: true,
      } as any;

      act(() => {
        result.current.getState().hydrateTask(taskId, cachedTask);
      });

      const hydrated = result.current.getState().tasks[taskId];
      expect(hydrated.activeAsk).toBe('');
      expect(hydrated.askList).toEqual([]);
      expect(hydrated.isPending).toBe(false);
    });
  });

  describe('END message resolution', () => {
    it('keeps non-empty END payload ahead of prior agent summaries', () => {
      expect(
        resolveEndMessageText('Final task output', [
          { step: 'agent_summary_end', summary: 'Older summary' },
        ] as any)
      ).toBe('Final task output');
    });

    it('extracts result-shaped END payloads', () => {
      expect(
        extractEndPayloadText({
          result: 'Final result from replay payload',
          tokens: 10,
        })
      ).toBe('Final result from replay payload');
    });

    it('falls back to completed subtask reports when END payload is empty', () => {
      expect(
        resolveEndMessageText('', [], {
          taskAssigning: [
            {
              tasks: [
                { report: 'Created INC0494320' },
                { report: 'Generated ticket report with 27 rows' },
              ],
            },
          ],
        } as any)
      ).toContain('Generated ticket report with 27 rows');
    });
  });

  describe('Final output file extraction', () => {
    it('normalizes the local artifact change index into previewable files', () => {
      const files = normalizeTaskArtifactFileList([
        {
          filename: 'final_report.md',
          path: '/Users/test/project/reports/final_report.md',
          relativePath: 'reports/final_report.md',
          changeType: 'changed',
          size: 1234,
          modifiedAt: 4567,
        },
        {
          filename: 'chart.png',
          path: '/Users/test/outputs/chart.png',
          relativePath: 'chart.png',
          changeType: 'generated',
        },
      ]);

      expect(files).toMatchObject([
        {
          name: 'final_report.md',
          type: 'md',
          relativePath: 'reports/final_report.md',
          artifactChange: 'changed',
          size: 1234,
          modifiedAt: 4567,
          isRemote: false,
        },
        {
          name: 'chart.png',
          type: 'png',
          artifactChange: 'generated',
          isRemote: false,
        },
      ]);
    });

    it('drops malformed and duplicate artifact index rows', () => {
      expect(
        normalizeTaskArtifactFileList([
          { filename: 'a.csv', path: '/tmp/a.csv', relativePath: 'a.csv' },
          { filename: 'a.csv', path: '/tmp/other.csv', relativePath: 'a.csv' },
          { filename: 'missing.txt' },
        ])
      ).toHaveLength(1);
    });

    it('keeps an existing preview path while adding artifact change metadata', () => {
      const [file] = mergeFileInfoLists(
        [
          {
            name: 'report.md',
            path: 'http://localhost/files/stream?path=report.md',
            type: 'md',
            isRemote: true,
          },
        ],
        [
          {
            name: 'report.md',
            path: '/Users/test/project/report.md',
            type: 'md',
            relativePath: 'report.md',
            artifactChange: 'changed',
            size: 2048,
            modifiedAt: 123456,
          },
        ]
      );

      expect(file).toMatchObject({
        path: 'http://localhost/files/stream?path=report.md',
        relativePath: 'report.md',
        artifactChange: 'changed',
        size: 2048,
        modifiedAt: 123456,
        isRemote: true,
      });
    });

    it('extracts sandbox paths without treating the scheme suffix as a drive', () => {
      const files = extractFinalOutputFileList(
        'Created [CSV](sandbox:/Users/test/eigent/space_123/report.csv).'
      );

      expect(files).toMatchObject([
        {
          name: 'report.csv',
          path: '/Users/test/eigent/space_123/report.csv',
          type: 'csv',
          isRemote: false,
        },
      ]);
    });

    it('keeps supported absolute POSIX and Windows paths', () => {
      const files = extractFinalOutputFileList(
        'Outputs: /Users/test/report.md and C:\\Users\\test\\report.xlsx'
      );

      expect(files.map((file) => file.path)).toEqual([
        '/Users/test/report.md',
        'C:/Users/test/report.xlsx',
      ]);
    });

    it('does not turn unknown schemes or embedded drive-like text into paths', () => {
      const files = extractFinalOutputFileList(
        [
          'unknown:/Users/test/report.csv',
          'wordC:/Users/test/report.md',
          'https://example.com/report.csv',
          'file:///Users/test/report.md',
        ].join(' ')
      );

      expect(files).toEqual([]);
    });

    it('still builds project stream URLs for project-scoped outputs', () => {
      const [file] = extractFinalOutputFileList(
        'sandbox:/tmp/project_42/results/report.csv',
        '42',
        'dev@example.com',
        'http://localhost:5001/'
      );

      expect(file).toMatchObject({
        path: 'http://localhost:5001/files/stream?path=results%2Freport.csv&project_id=42&email=dev%40example.com',
        relativePath: 'results/report.csv',
        isRemote: true,
      });
    });

    it('replaces a legacy x-prefixed path when replaying old output cards', () => {
      const extractedFiles = extractFinalOutputFileList(
        'sandbox:/Users/test/eigent/space_123/report.csv'
      );
      const mergedFiles = mergeFileInfoLists(
        [
          {
            name: 'report.csv',
            path: 'x:/Users/test/eigent/space_123/report.csv',
            type: 'csv',
            isRemote: false,
          },
        ],
        extractedFiles
      );

      expect(mergedFiles).toMatchObject([
        {
          name: 'report.csv',
          path: '/Users/test/eigent/space_123/report.csv',
          type: 'csv',
          isRemote: false,
        },
      ]);
    });

    it('does not replace an unrelated X drive path with the same file name', () => {
      const mergedFiles = mergeFileInfoLists(
        [
          {
            name: 'report.csv',
            path: 'X:/exports/report.csv',
            type: 'csv',
            isRemote: false,
          },
        ],
        [
          {
            name: 'report.csv',
            path: '/Users/test/report.csv',
            type: 'csv',
            isRemote: false,
          },
        ]
      );

      expect(mergedFiles[0].path).toBe('X:/exports/report.csv');
    });

    it('trusts an empty canonical artifact list over paths merely mentioned in the answer', () => {
      const files = resolveRunOutputFileList({
        writeEventFiles: [],
        artifactFiles: [],
        canonicalArtifactsAvailable: true,
        finalAnswerFiles: [
          {
            name: 'old-report.csv',
            path: '/Users/test/workspace/old-report.csv',
            type: 'csv',
          },
        ],
      });

      expect(files).toEqual([]);
    });

    it('keeps final-answer path extraction as a fallback without a canonical artifact index', () => {
      const finalAnswerFiles = [
        {
          name: 'remote-report.csv',
          path: 'https://example.test/remote-report.csv',
          type: 'csv',
          isRemote: true,
        },
      ];

      expect(
        resolveRunOutputFileList({
          writeEventFiles: [],
          artifactFiles: [],
          canonicalArtifactsAvailable: false,
          finalAnswerFiles,
        })
      ).toEqual(finalAnswerFiles);
    });
  });

  describe('Task Upload Files', () => {
    it('collects camel logs and unique explicit user attachments', () => {
      const uploadFiles = collectTaskUploadFiles(
        [
          {
            path: '/tmp/logs/ba4462e1/agent.log',
            name: 'agent.log',
            relativePath: 'ba4462e1',
            source: 'camel_log',
          },
          {
            path: '/tmp/project',
            name: 'project',
            isFolder: true,
            source: 'project_output',
          },
        ],
        [
          {
            id: 'msg-1',
            role: 'user',
            content: 'question',
            attaches: [
              {
                fileName: 'brief.pdf',
                filePath: '/Users/test/Documents/brief.pdf',
              },
              {
                fileName: 'report.md',
                filePath: '/tmp/project/report.md',
              },
            ],
          },
        ] as any,
        [
          {
            fileName: 'followup.csv',
            filePath: '/Users/test/Documents/followup.csv',
          },
        ]
      );

      expect(uploadFiles).toEqual([
        {
          path: '/tmp/logs/ba4462e1/agent.log',
          name: 'agent.log',
          uploadName: 'agent.log',
          logicalPath: 'ba4462e1/agent.log',
          source: 'camel_log',
        },
        {
          path: '/Users/test/Documents/brief.pdf',
          name: 'brief.pdf',
          uploadName: 'brief.pdf',
          logicalPath: 'brief.pdf',
          source: 'user_upload',
        },
        {
          path: '/tmp/project/report.md',
          name: 'report.md',
          uploadName: 'report.md',
          logicalPath: 'report.md',
          source: 'user_upload',
        },
        {
          path: '/Users/test/Documents/followup.csv',
          name: 'followup.csv',
          uploadName: 'followup.csv',
          logicalPath: 'followup.csv',
          source: 'user_upload',
        },
      ]);
    });

    it('skips remote attachment URLs and falls back to filename from path', () => {
      const uploadFiles = collectTaskUploadFiles(
        [],
        [
          {
            id: 'msg-2',
            role: 'user',
            content: 'question',
            attaches: [
              {
                fileName: '',
                filePath: 'C:\\Users\\test\\Desktop\\notes.txt',
              },
              {
                fileName: 'remote.pdf',
                filePath: 'https://example.com/remote.pdf',
              },
            ],
          },
        ] as any,
        []
      );

      expect(uploadFiles).toEqual([
        {
          path: 'C:\\Users\\test\\Desktop\\notes.txt',
          name: 'notes.txt',
          uploadName: 'notes.txt',
          logicalPath: 'notes.txt',
          source: 'user_upload',
        },
      ]);
    });

    it('leaves generated Artifact uploads to the durable Brain outbox', () => {
      const uploadFiles = collectTaskUploadFiles([], [], [], [
        {
          path: '/Users/test/.eigent/user_1/space_x/index.html',
          name: 'index.html',
          type: 'html',
        },
        {
          path: 'https://example.com/files/remote.html',
          name: 'remote.html',
          type: 'html',
        },
      ] as any);

      expect(uploadFiles).toEqual([]);
    });

    it('keeps camel log logical paths nested while uploading a basename', () => {
      const uploadFiles = collectTaskUploadFiles(
        [
          {
            path: '/Users/test/.eigent/user_1/project_p/task_t/camel_logs/agent/conv.json',
            name: 'conv.json',
            relativePath: 'agent',
            source: 'camel_log',
          },
        ],
        [],
        []
      );

      expect(uploadFiles).toEqual([
        {
          path: '/Users/test/.eigent/user_1/project_p/task_t/camel_logs/agent/conv.json',
          name: 'conv.json',
          uploadName: 'conv.json',
          logicalPath: 'agent/conv.json',
          source: 'camel_log',
        },
      ]);
    });

    it('never uploads files merely discovered in a selected folder or final answer', () => {
      const uploadFiles = collectTaskUploadFiles(
        [],
        [
          {
            id: 'agent-result',
            role: 'agent',
            content: 'I read the existing files.',
            fileList: [
              {
                path: '/Users/test/selected-folder/private.xlsx',
                name: 'private.xlsx',
                type: 'xlsx',
              },
            ],
          },
        ] as any,
        [],
        []
      );

      expect(uploadFiles).toEqual([]);
    });
  });

  describe('Task Creation', () => {
    it('should create a task with unique ID', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        const taskId1 = result.current.getState().create();
        const taskId2 = result.current.getState().create();

        expect(taskId1).toBeDefined();
        expect(taskId2).toBeDefined();
        expect(taskId1).not.toBe(taskId2);
        expect(result.current.getState().tasks[taskId1]).toBeDefined();
        expect(result.current.getState().tasks[taskId2]).toBeDefined();
      });
    });

    it('should create a task with custom ID', () => {
      const { result } = renderHook(() => useChatStore());
      const customId = 'custom-task-123';

      act(() => {
        const taskId = result.current.getState().create(customId);

        expect(taskId).toBe(customId);
        expect(result.current.getState().tasks[customId]).toBeDefined();
      });
    });

    it('should initialize task with correct default state', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        const taskId = result.current.getState().create();
        const task = result.current.getState().tasks[taskId];

        expect(task.status).toBe('pending');
        expect(task.messages).toEqual([]);
        expect(task.tokens).toBe(0);
        expect(task.isPending).toBe(false);
        expect(task.hasWaitComfirm).toBe(false);
        expect(task.progressValue).toBe(0);
        expect(task.taskInfo).toEqual([]);
        expect(task.taskRunning).toEqual([]);
        expect(task.taskAssigning).toEqual([]);
      });
    });

    it('should set task as active when created', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        const taskId = result.current.getState().create();

        expect(result.current.getState().activeTaskId).toBe(taskId);
      });
    });
  });

  describe('Task Removal', () => {
    it('should remove a task by ID', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        const taskId = result.current.getState().create();
        expect(result.current.getState().tasks[taskId]).toBeDefined();

        result.current.getState().removeTask(taskId);

        expect(result.current.getState().tasks[taskId]).toBeUndefined();
      });
    });

    it('should handle removing non-existent task gracefully', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        // Should not throw
        result.current.getState().removeTask('non-existent-id');
      });
    });

    it('should clear all tasks and create new one', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        const _taskId1 = result.current.getState().create();
        const _taskId2 = result.current.getState().create();

        expect(Object.keys(result.current.getState().tasks)).toHaveLength(2);

        result.current.getState().clearTasks();

        const remainingTasks = Object.keys(result.current.getState().tasks);
        expect(remainingTasks).toHaveLength(1);
        expect(result.current.getState().activeTaskId).toBeDefined();
      });
    });
  });

  describe('Status Management', () => {
    it('should update task status correctly', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        const taskId = result.current.getState().create();

        result.current.getState().setStatus(taskId, 'running');
        expect(result.current.getState().tasks[taskId].status).toBe('running');

        result.current.getState().setStatus(taskId, 'finished');
        expect(result.current.getState().tasks[taskId].status).toBe('finished');

        result.current.getState().setStatus(taskId, 'pause');
        expect(result.current.getState().tasks[taskId].status).toBe('pause');
      });
    });

    it('should set pending state independently of status', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        const taskId = result.current.getState().create();

        result.current.getState().setIsPending(taskId, true);
        expect(result.current.getState().tasks[taskId].isPending).toBe(true);
        expect(result.current.getState().tasks[taskId].status).toBe('pending');

        result.current.getState().setStatus(taskId, 'running');
        expect(result.current.getState().tasks[taskId].isPending).toBe(true);
        expect(result.current.getState().tasks[taskId].status).toBe('running');
      });
    });
  });

  describe('Token Management', () => {
    it('should accumulate tokens correctly', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        const taskId = result.current.getState().create();

        result.current.getState().addTokens(taskId, 100);
        expect(result.current.getState().getTokens(taskId)).toBe(100);

        result.current.getState().addTokens(taskId, 50);
        expect(result.current.getState().getTokens(taskId)).toBe(150);

        result.current.getState().addTokens(taskId, 250);
        expect(result.current.getState().getTokens(taskId)).toBe(400);
      });
    });

    it('should handle negative token additions', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        const taskId = result.current.getState().create();

        result.current.getState().addTokens(taskId, 100);
        result.current.getState().addTokens(taskId, -50);

        expect(result.current.getState().getTokens(taskId)).toBe(50);
      });
    });

    it('should return 0 tokens for non-existent task', () => {
      const { result } = renderHook(() => useChatStore());

      expect(result.current.getState().getTokens('non-existent')).toBe(0);
    });

    it('should preserve tokens when creating new task with initial tokens', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        const taskId1 = result.current.getState().create();
        result.current.getState().addTokens(taskId1, 500);

        // Simulate new task in same project with accumulated tokens
        const taskId2 = result.current.getState().create();
        result.current.getState().addTokens(taskId2, 500); // Cumulative

        expect(result.current.getState().getTokens(taskId2)).toBe(500);
      });
    });
  });

  describe('Message Management', () => {
    it('should add messages to task', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        const taskId = result.current.getState().create();

        result.current.getState().addMessages(taskId, {
          id: generateUniqueId(),
          role: 'user',
          content: 'Hello, world!',
        });

        expect(result.current.getState().tasks[taskId].messages).toHaveLength(
          1
        );
        expect(
          result.current.getState().tasks[taskId].messages[0].content
        ).toBe('Hello, world!');
      });
    });

    it('should maintain message order', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        const taskId = result.current.getState().create();

        result.current.getState().addMessages(taskId, {
          id: '1',
          role: 'user',
          content: 'First',
        });
        result.current.getState().addMessages(taskId, {
          id: '2',
          role: 'agent',
          content: 'Second',
        });
        result.current.getState().addMessages(taskId, {
          id: '3',
          role: 'user',
          content: 'Third',
        });

        const messages = result.current.getState().tasks[taskId].messages;
        expect(messages).toHaveLength(3);
        expect(messages[0].content).toBe('First');
        expect(messages[1].content).toBe('Second');
        expect(messages[2].content).toBe('Third');
      });
    });

    it('should get last user message', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        const taskId = result.current.getState().create();
        result.current.getState().setActiveTaskId(taskId);

        result.current.getState().addMessages(taskId, {
          id: '1',
          role: 'user',
          content: 'First user message',
        });
        result.current.getState().addMessages(taskId, {
          id: '2',
          role: 'agent',
          content: 'Agent response',
        });
        result.current.getState().addMessages(taskId, {
          id: '3',
          role: 'user',
          content: 'Second user message',
        });

        const lastUserMessage = result.current.getState().getLastUserMessage();
        expect(lastUserMessage?.content).toBe('Second user message');
      });
    });

    it('should return null when no user messages exist', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        const taskId = result.current.getState().create();
        result.current.getState().setActiveTaskId(taskId);

        result.current.getState().addMessages(taskId, {
          id: '1',
          role: 'agent',
          content: 'Agent message',
        });

        const lastUserMessage = result.current.getState().getLastUserMessage();
        expect(lastUserMessage).toBeNull();
      });
    });

    it('should set messages replacing existing ones', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        const taskId = result.current.getState().create();

        result.current.getState().addMessages(taskId, {
          id: '1',
          role: 'user',
          content: 'Original',
        });

        const newMessages = [
          { id: '2', role: 'user' as const, content: 'New 1' },
          { id: '3', role: 'agent' as const, content: 'New 2' },
        ];

        result.current.getState().setMessages(taskId, newMessages);

        expect(result.current.getState().tasks[taskId].messages).toHaveLength(
          2
        );
        expect(
          result.current.getState().tasks[taskId].messages[0].content
        ).toBe('New 1');
      });
    });
  });

  describe('Task Time Tracking', () => {
    it('should track task time', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        const taskId = result.current.getState().create();
        const startTime = Date.now();

        result.current.getState().setTaskTime(taskId, startTime);

        expect(result.current.getState().tasks[taskId].taskTime).toBe(
          startTime
        );
      });
    });

    it('should track elapsed time', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        const taskId = result.current.getState().create();

        result.current.getState().setElapsed(taskId, 5000);

        expect(result.current.getState().tasks[taskId].elapsed).toBe(5000);
      });
    });

    it('should format task time correctly', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        const taskId = result.current.getState().create();

        // Test elapsed time formatting
        result.current.getState().setTaskTime(taskId, 0);
        result.current.getState().setElapsed(taskId, 3665000); // 1h 1m 5s

        const formatted = result.current
          .getState()
          .getFormattedTaskTime(taskId);
        expect(formatted).toBe('01:01:05');
      });
    });
  });

  describe('Progress Tracking', () => {
    it('should update progress value', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        const taskId = result.current.getState().create();

        result.current.getState().setProgressValue(taskId, 50);
        expect(result.current.getState().tasks[taskId].progressValue).toBe(50);

        result.current.getState().setProgressValue(taskId, 100);
        expect(result.current.getState().tasks[taskId].progressValue).toBe(100);
      });
    });

    it('should compute progress based on completed tasks', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        const taskId = result.current.getState().create();

        // Set up task structure
        result.current.getState().setTaskRunning(taskId, [
          { id: '1', content: 'Task 1', status: 'completed' },
          { id: '2', content: 'Task 2', status: 'completed' },
          { id: '3', content: 'Task 3', status: 'running' },
          { id: '4', content: 'Task 4', status: 'waiting' },
        ] as any);

        result.current.getState().computedProgressValue(taskId);

        // 2 out of 4 = 50%
        expect(result.current.getState().tasks[taskId].progressValue).toBe(50);
      });
    });

    it('writes computed progress to the requested run instead of the active run', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        const historicalTaskId = result.current.getState().create('historical');
        const activeTaskId = result.current.getState().create('active');

        result.current.getState().setTaskRunning(historicalTaskId, [
          { id: '1', content: 'Done', status: 'completed' },
          { id: '2', content: 'Waiting', status: 'waiting' },
        ] as any);
        result.current.getState().computedProgressValue(historicalTaskId);

        expect(
          result.current.getState().tasks[historicalTaskId].progressValue
        ).toBe(50);
        expect(
          result.current.getState().tasks[activeTaskId].progressValue
        ).toBe(0);
      });
    });
  });

  describe('Update Counter', () => {
    it('should increment update count', () => {
      const { result } = renderHook(() => useChatStore());

      const initialCount = result.current.getState().updateCount;

      act(() => {
        result.current.getState().setUpdateCount();
      });

      expect(result.current.getState().updateCount).toBe(initialCount + 1);

      act(() => {
        result.current.getState().setUpdateCount();
      });

      expect(result.current.getState().updateCount).toBe(initialCount + 2);
    });
  });

  describe('Task startup', () => {
    it('renders the pending user turn before backend readiness resolves', async () => {
      let resolveBackendReady!: (ready: boolean) => void;
      vi.mocked(waitForBackendReady).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveBackendReady = resolve;
        })
      );

      const { result } = renderHook(() => useChatStore());
      const getProjectStoreState = vi.mocked(useProjectStore.getState);
      const previousProjectStoreImplementation =
        getProjectStoreState.getMockImplementation();
      const appendInitChatStore = vi.fn(() => {
        const optimisticTaskId = result.current
          .getState()
          .create('optimistic-task');
        result.current.getState().setActiveTaskId(optimisticTaskId);
        return {
          taskId: optimisticTaskId,
          chatStore: result.current,
        };
      });
      getProjectStoreState.mockReturnValue({
        activeProjectId: 'project-1',
        appendInitChatStore,
        getProjectById: () => ({
          id: 'project-1',
          mode: 'single',
          spaceId: 'space-1',
        }),
        getHistoryId: () => null,
      } as any);

      let startPromise!: Promise<void>;
      act(() => {
        const initialTaskId = result.current.getState().create('initial-task');
        startPromise = result.current
          .getState()
          .startTask(
            initialTaskId,
            undefined,
            undefined,
            undefined,
            'Resume this project',
            [],
            undefined,
            'project-1',
            'single' as any
          );
      });

      expect(appendInitChatStore).toHaveBeenCalledTimes(1);
      expect(result.current.getState().tasks['optimistic-task']).toMatchObject({
        isPending: true,
        status: ChatTaskStatus.PENDING,
        messages: [
          expect.objectContaining({
            role: 'user',
            content: 'Resume this project',
          }),
        ],
      });

      resolveBackendReady(false);
      await act(async () => {
        await startPromise;
      });

      expect(result.current.getState().tasks['optimistic-task']).toMatchObject({
        isPending: false,
        status: ChatTaskStatus.FINISHED,
      });
      if (previousProjectStoreImplementation) {
        getProjectStoreState.mockImplementation(
          previousProjectStoreImplementation
        );
      }
    });

    it('clears optimistic pending state after a typed admission rejection', async () => {
      vi.mocked(proxyFetchGet).mockResolvedValue({
        value: 'test-cloud-key',
        api_url: 'https://models.example.test',
        items: [],
        warning_code: null,
      });
      vi.mocked(fetchEventSource).mockImplementation(async (_url, options) => {
        const response = new Response(
          JSON.stringify({
            detail: {
              code: 'continuation_clarification_required',
              message:
                'The saved Project frontier has no unfinished next action.',
              project_state_version: 1,
            },
          }),
          {
            status: 409,
            headers: { 'content-type': 'application/json' },
          }
        );
        try {
          await options.onopen?.(response);
        } catch (error) {
          options.onerror?.(error);
        }
      });

      const { result } = renderHook(() => useChatStore());
      const getProjectStoreState = vi.mocked(useProjectStore.getState);
      const previousProjectStoreImplementation =
        getProjectStoreState.getMockImplementation();
      const appendInitChatStore = vi.fn(() => {
        const optimisticTaskId = result.current
          .getState()
          .create('rejected-task');
        result.current.getState().setActiveTaskId(optimisticTaskId);
        return {
          taskId: optimisticTaskId,
          chatStore: result.current,
        };
      });
      getProjectStoreState.mockReturnValue({
        activeProjectId: 'project-1',
        appendInitChatStore,
        getProjectById: () => ({
          id: 'project-1',
          mode: 'single',
          spaceId: 'space-1',
        }),
        getHistoryId: () => null,
        getAllChatStores: () => [],
        getProjectModel: () => null,
        setProjectModel: vi.fn(),
        setProjectSpace: vi.fn(),
        setHistoryId: vi.fn(),
        getProjectThinkingEffortOverride: () => undefined,
      } as any);

      await act(async () => {
        const initialTaskId = result.current.getState().create('initial-task');
        await result.current
          .getState()
          .startTask(
            initialTaskId,
            undefined,
            undefined,
            undefined,
            'continue',
            [],
            undefined,
            'project-1',
            'single' as any
          );
        await Promise.resolve();
      });

      expect(result.current.getState().tasks['rejected-task']).toMatchObject({
        isPending: false,
        status: ChatTaskStatus.FINISHED,
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'agent',
            content:
              'Input required: The saved Project frontier has no unfinished next action.',
          }),
        ]),
      });
      if (previousProjectStoreImplementation) {
        getProjectStoreState.mockImplementation(
          previousProjectStoreImplementation
        );
      }
    });
  });

  describe('Cross-store task safety', () => {
    it('does not create phantom tasks through task-scoped setters', () => {
      const { result } = renderHook(() => useChatStore());

      act(() => {
        result.current.getState().setSelectedFile('missing-task', {
          name: 'missing.md',
          path: '/missing.md',
          type: 'md',
        });
        result.current
          .getState()
          .setActiveWorkspace('missing-task', 'workflow');
        result.current.getState().setActiveAgent('missing-task', 'agent-1');
      });

      expect(result.current.getState().tasks['missing-task']).toBeUndefined();
    });
  });

  describe('Plan confirmation', () => {
    it('rolls back confirmed plan UI when backend start request fails', async () => {
      vi.mocked(fetchPut).mockRejectedValueOnce(new Error('network down'));
      const { result } = renderHook(() => useChatStore());

      let taskId: string;
      await act(async () => {
        taskId = result.current.getState().create();
        result.current.getState().setActiveTaskId(taskId);
        result.current.getState().setTaskInfo(taskId, [
          {
            id: 'task.1',
            content: 'Do the work',
            status: 'empty',
          } as any,
        ]);
        result.current.getState().addMessages(taskId, {
          id: generateUniqueId(),
          role: 'agent',
          content: '',
          step: 'to_sub_tasks',
          isConfirm: false,
        });
      });

      await act(async () => {
        await result.current.getState().handleConfirmTask('project-1', taskId!);
      });

      const task = result.current.getState().tasks[taskId!];
      const planMessage = task.messages.find(
        (message) => message.step === 'to_sub_tasks'
      );
      expect(planMessage?.isConfirm).toBe(false);
      expect(task.status).toBe(ChatTaskStatus.PENDING);
      expect(task.taskTime).toBe(0);
      expect(fetchPost).not.toHaveBeenCalledWith('/task/project-1/start', {});
    });
  });

  /**
   * Issue #1212: Duplicate task execution after network reconnection / system wake-up.
   * When the task is already FINISHED, SSE onerror must not retry (throw to stop retry).
   */
  describe('SSE onerror - no retry when task already finished (issue #1212)', () => {
    it('should stop retry when task is already FINISHED (avoids duplicate execution)', async () => {
      const mockFetchEventSource = vi.mocked(fetchEventSource);
      vi.mocked(proxyFetchGet).mockResolvedValueOnce([]);
      mockFetchEventSource.mockImplementation((_url, opts) => {
        // Simulate connection error; when onerror runs, store checks task status
        // and throws to stop retry (issue #1212 fix)
        try {
          opts.onerror?.(new Error('Failed to fetch'));
        } catch {
          // Expected: onerror throws to stop fetch-event-source from retrying
        }
        return Promise.resolve();
      });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { result } = renderHook(() => useChatStore());

      let taskId: string;
      await act(async () => {
        taskId = result.current.getState().create();
        result.current.getState().setActiveTaskId(taskId!);
        result.current.getState().setStatus(taskId!, ChatTaskStatus.FINISHED);
        result.current.getState().addMessages(taskId!, {
          id: generateUniqueId(),
          role: 'user',
          content: 'Test message',
        });
        result.current.getState().setHasMessages(taskId!, true);
      });

      await act(async () => {
        await result.current
          .getState()
          .startTask(taskId!, 'replay', undefined, 0);
      });

      expect(mockFetchEventSource).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('already finished, stopping retry')
      );

      logSpy.mockRestore();
    });
  });

  describe('SSE request usage events', () => {
    // clearAllMocks doesn't reset implementations; avoid leaking into later tests.
    afterEach(() => {
      vi.mocked(fetchEventSource).mockReset();
    });

    it('should accumulate tokens from request_usage event in non-stream mode', async () => {
      vi.mocked(proxyFetchGet).mockImplementation((url: string) =>
        url?.includes?.('snapshots')
          ? Promise.resolve([])
          : Promise.resolve({
              value: '',
              api_url: '',
              items: [],
              warning_code: null,
            })
      );

      const mockFetchEventSource = vi.mocked(fetchEventSource);
      mockFetchEventSource.mockImplementation(async (_url, opts) => {
        opts.onmessage?.({
          data: JSON.stringify({
            step: 'request_usage',
            data: { tokens: 11 },
          }),
        } as any);
        opts.onmessage?.({
          data: JSON.stringify({
            step: 'deactivate_agent',
            data: { tokens: 0 },
          }),
        } as any);
        return Promise.resolve();
      });

      const { result } = renderHook(() => useChatStore());
      let taskId!: string;
      await act(async () => {
        taskId = result.current.getState().create();
        result.current.getState().setActiveTaskId(taskId);
        result.current.getState().setHasMessages(taskId, true);
        result.current.getState().addMessages(taskId, {
          id: generateUniqueId(),
          role: 'user',
          content: 'Test message',
        });
      });

      await act(async () => {
        await result.current
          .getState()
          .startTask(taskId, 'replay', undefined, 0.2);
      });

      expect(result.current.getState().tasks[taskId].tokens).toBe(11);
    });
  });

  describe('Replay', () => {
    const replayProjectState = () => ({
      activeProjectId: 'proj-replay',
      getHistoryId: () => null,
      getProjectById: () => ({
        id: 'proj-replay',
        mode: 'single',
      }),
    });

    beforeEach(() => {
      vi.mocked(useProjectStore.getState).mockImplementation(
        replayProjectState as any
      );
      vi.mocked(proxyFetchGet).mockImplementation((url: string) =>
        url?.includes?.('snapshots')
          ? Promise.resolve([])
          : Promise.resolve({
              value: '',
              api_url: '',
              items: [],
              warning_code: null,
            })
      );
    });

    it('replay() creates task and starts SSE', async () => {
      vi.mocked(fetchEventSource).mockImplementation(() => Promise.resolve());
      const { result } = renderHook(() => useChatStore());

      await act(async () => {
        await result.current.getState().replay('replay-1', 'Q', 0.2);
      });

      expect(result.current.getState().tasks['replay-1']).toBeDefined();
      expect(result.current.getState().activeTaskId).toBe('replay-1');
      expect(fetchEventSource).toHaveBeenCalled();
    });

    it('returns after a durable replay catches up while its live stream stays attached', async () => {
      let emitMessage:
        | ((message: { event?: string; id?: string; data: string }) => unknown)
        | undefined;
      let closeStream: (() => void) | undefined;
      let streamSettled = false;
      vi.mocked(fetchEventSource).mockImplementation((_url, opts) => {
        emitMessage = opts.onmessage as typeof emitMessage;
        return new Promise<void>((resolve) => {
          closeStream = () => {
            streamSettled = true;
            resolve();
          };
        });
      });
      const { result } = renderHook(() => useChatStore());
      const taskId = result.current.getState().create();

      const replayPromise = result.current
        .getState()
        .startTask(
          taskId,
          'replay',
          undefined,
          0,
          undefined,
          undefined,
          undefined,
          'proj-replay',
          undefined,
          {
            replaySource: 'local_durable',
            detachReplayAfterCatchUp: true,
          }
        );
      await vi.waitFor(() => expect(emitMessage).toBeDefined());

      await emitMessage?.({
        event: 'run_event',
        id: '1',
        data: JSON.stringify({
          event_id: 'event-1',
          event_type: 'chat.step',
          legacy_step: 'todo_state',
          payload: { agent_id: 'single-agent', todos: [] },
          project_id: 'proj-replay',
          run_id: taskId,
          sequence: 1,
          run_version: 1,
          created_at: 100,
        }),
      });
      await emitMessage?.({
        event: 'replay_caught_up',
        data: JSON.stringify({ run_id: taskId, after_sequence: 1 }),
      });

      await expect(replayPromise).resolves.toBeUndefined();
      expect(streamSettled).toBe(false);
      expect(result.current.getState().tasks[taskId].status).toBe(
        ChatTaskStatus.RUNNING
      );

      closeStream?.();
    });

    it('does not restart a replay clock during synthetic confirmation', async () => {
      const { result } = renderHook(() => useChatStore());
      const taskId = result.current.getState().create();
      result.current.getState().setTaskTime(taskId, 123_456);

      await result.current
        .getState()
        .handleConfirmTask('proj-replay', taskId, 'replay');

      expect(result.current.getState().tasks[taskId].taskTime).toBe(123_456);
    });

    it('replays a recorded human reply without leaving an active wait', async () => {
      vi.mocked(fetchEventSource).mockImplementation(async (_url, opts) => {
        for (const event of [
          {
            step: 'ask',
            data: {
              agent: 'Agents.single_agent',
              question: 'What kind of script?',
            },
          },
          {
            step: 'human_reply',
            data: {
              agent: 'Agents.single_agent',
              reply: 'A simple script is enough',
            },
          },
          { step: 'end', data: 'Created the script' },
        ]) {
          opts.onmessage?.({ data: JSON.stringify(event) } as any);
        }
        return Promise.resolve();
      });
      const { result } = renderHook(() => useChatStore());
      const taskId = result.current.getState().create();
      result.current.getState().addMessages(taskId, {
        id: generateUniqueId(),
        role: 'user',
        content: 'Create a script',
      });

      await act(async () => {
        await result.current
          .getState()
          .startTask(taskId, 'replay', undefined, 0);
      });

      const task = result.current.getState().tasks[taskId];
      expect(task.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: 'agent',
            step: 'ask',
            content: 'What kind of script?',
          }),
          expect.objectContaining({
            role: 'user',
            content: 'A simple script is enough',
          }),
        ])
      );
      expect(task.activeAsk).toBe('');
      expect(task.askList).toEqual([]);
      expect(task.status).toBe(ChatTaskStatus.FINISHED);
    });

    it('clears legacy replay ASK state when the task ends', async () => {
      vi.mocked(fetchEventSource).mockImplementation(async (_url, opts) => {
        opts.onmessage?.({
          data: JSON.stringify({
            step: 'ask',
            data: {
              agent: 'Agents.single_agent',
              question: 'Historical question',
            },
          }),
        } as any);
        opts.onmessage?.({
          data: JSON.stringify({ step: 'end', data: 'Finished' }),
        } as any);
        return Promise.resolve();
      });
      const { result } = renderHook(() => useChatStore());
      const taskId = result.current.getState().create();

      await act(async () => {
        await result.current
          .getState()
          .startTask(taskId, 'replay', undefined, 0);
      });

      const task = result.current.getState().tasks[taskId];
      expect(task.activeAsk).toBe('');
      expect(task.askList).toEqual([]);
      expect(task.status).toBe(ChatTaskStatus.FINISHED);
    });

    it('replay SSE: AbortError does not throw', async () => {
      vi.mocked(fetchEventSource).mockImplementation(() =>
        Promise.reject(new DOMException('', 'AbortError'))
      );
      const { result } = renderHook(() => useChatStore());
      let taskId!: string;
      await act(async () => {
        taskId = result.current.getState().create();
        result.current.getState().setHasMessages(taskId, true);
        result.current.getState().addMessages(taskId, {
          id: generateUniqueId(),
          role: 'user',
          content: 'Q',
        });
      });

      await expect(
        result.current.getState().startTask(taskId, 'replay', undefined, 0.2)
      ).resolves.toBeUndefined();
    });

    it('replay SSE: unexpected error is logged and rethrown', async () => {
      const err = new Error('SSE failed');
      vi.mocked(fetchEventSource).mockImplementation(() => Promise.reject(err));
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const { result } = renderHook(() => useChatStore());
      let taskId!: string;
      await act(async () => {
        taskId = result.current.getState().create();
        result.current.getState().setHasMessages(taskId, true);
        result.current.getState().addMessages(taskId, {
          id: generateUniqueId(),
          role: 'user',
          content: 'Q',
        });
      });

      await expect(
        result.current.getState().startTask(taskId, 'replay', undefined, 0.2)
      ).rejects.toThrow('SSE failed');
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('SSE stream failed for task'),
        err
      );
      consoleSpy.mockRestore();
    });
  });
});
