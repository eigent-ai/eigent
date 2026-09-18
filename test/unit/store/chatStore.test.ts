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

vi.mock('@/service/triggerApi', () => ({
  proxyUpdateTriggerExecution: vi.fn(() => Promise.resolve()),
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
  fetchDelete,
  fetchGet,
  fetchPost,
  fetchPut,
  proxyFetchGet,
  proxyFetchPut,
  waitForBackendReady,
} from '@/api/http';
import { presentChatSemanticEntities } from '@/components/ChatBox/EventTimeline/presentationPolicy';
import { selectRenderableChatNodes } from '@/lib/projector/chat';
import {
  composeTimelineRuns,
  reconcileTimelineRuns,
} from '@/lib/projector/chat/presentation';
import { proxyUpdateTriggerExecution } from '@/service/triggerApi';
import { getAuthStore } from '@/store/authStore';
import {
  getProjectEventStore,
  releaseProjectEventStore,
} from '@/store/projectEventStore';
import { setUsageAccount, useUsageNoticeStore } from '@/store/usageNoticeStore';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { toast } from 'sonner';
import { generateUniqueId } from '../../../src/lib';
import {
  runDomainEventHub,
  runEventIngressRegistry,
  runProjectionStore,
} from '../../../src/lib/runEvents';
import {
  closeIdleSSEConnectionsForTasks,
  closeSSEConnectionsForTasks,
  collectTaskUploadFiles,
  createChatStoreInstance,
  extractEndPayloadText,
  extractFinalOutputFileList,
  getIdleSSETransportTaskId,
  hasActiveSSEConnection,
  hasAnyActiveLegacySSEConnection,
  hasSSETransportForTasks,
  mergeFileInfoLists,
  normalizeTaskArtifactFileList,
  resolveConfirmedUserMessageContent,
  resolveEndMessageText,
  resolveRunOutputFileList,
  settleLegacyTaskFromCanonicalTerminal,
  useChatStore,
} from '../../../src/store/chatStore';
import { useProjectStore } from '../../../src/store/projectStore';
import { ExecutionStatus } from '../../../src/types';
import { AgentStep, ChatTaskStatus } from '../../../src/types/constants';

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

    it('drops empty write receipts from canonical output lists', () => {
      const output = {
        name: 'report.md',
        path: '/workspace/report.md',
        type: 'md',
      };
      expect(
        resolveRunOutputFileList({
          writeEventFiles: [{ name: '', path: '', type: 'File' }],
          artifactFiles: [output],
          canonicalArtifactsAvailable: true,
          finalAnswerFiles: [],
        })
      ).toEqual([output]);
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
    it('settles a live task from a canonical failure when legacy SSE ends without ERROR', () => {
      const { result } = renderHook(() => useChatStore());
      const taskId = result.current.getState().create('failed-run');
      result.current.getState().setStatus(taskId, ChatTaskStatus.RUNNING);
      result.current.getState().setIsPending(taskId, true);
      result.current.getState().setTaskTime(taskId, Date.now() - 1000);

      const event = {
        eventType: 'run.failed',
        payload: { message: 'Background preview did not stop.' },
      } as const;

      expect(
        settleLegacyTaskFromCanonicalTerminal(result.current, taskId, event)
      ).toBe(true);
      expect(
        settleLegacyTaskFromCanonicalTerminal(result.current, taskId, event)
      ).toBe(true);

      const task = result.current.getState().tasks[taskId];
      expect(task).toMatchObject({
        status: ChatTaskStatus.FINISHED,
        durableRunStatus: 'failed',
        isPending: false,
        taskTime: 0,
      });
      expect(task.elapsed).toBeGreaterThanOrEqual(1000);
      expect(
        task.messages.filter((message) =>
          message.content.includes('Background preview did not stop.')
        )
      ).toHaveLength(1);
    });

    it('settles the live ChatTask when the canonical stream reports run.failed', async () => {
      vi.mocked(proxyFetchGet).mockResolvedValue({
        value: 'test-cloud-key',
        api_url: 'https://models.example.test',
        items: [],
        warning_code: null,
      });
      runDomainEventHub.clear();
      runEventIngressRegistry.clear();

      let canonicalOnMessage:
        | ((event: { event?: string; id?: string; data: string }) => unknown)
        | undefined;
      vi.mocked(fetchEventSource).mockImplementation(async (url, options) => {
        const response = new Response('', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
        await options.onopen?.(response);
        if (String(url).includes('/runs/live-run/stream')) {
          canonicalOnMessage = options.onmessage as typeof canonicalOnMessage;
        }
        await new Promise<void>(() => {});
      });

      const { result } = renderHook(() => useChatStore());
      const getProjectStoreState = vi.mocked(useProjectStore.getState);
      const previousProjectStoreImplementation =
        getProjectStoreState.getMockImplementation();
      const appendInitChatStore = vi.fn(() => {
        const liveTaskId = result.current.getState().create('live-run');
        result.current.getState().setActiveTaskId(liveTaskId);
        return { taskId: liveTaskId, chatStore: result.current };
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
        await result.current
          .getState()
          .startTask(
            'initial-task',
            undefined,
            undefined,
            undefined,
            'Create a game',
            [],
            undefined,
            'project-1',
            'single' as any
          );
      });
      await vi.waitFor(() => expect(canonicalOnMessage).toBeDefined());
      result.current.getState().setStatus('live-run', ChatTaskStatus.RUNNING);
      result.current.getState().setTaskTime('live-run', Date.now() - 1000);

      await canonicalOnMessage?.({
        event: 'run_event',
        id: '1',
        data: JSON.stringify({
          event_id: 'run-failed:live-run',
          event_type: 'run.failed',
          legacy_step: null,
          payload: { message: 'Background preview did not stop.' },
          project_id: 'project-1',
          run_id: 'live-run',
          sequence: 1,
          run_version: 1,
          created_at: Date.now() / 1000,
        }),
      });

      expect(result.current.getState().tasks['live-run']).toMatchObject({
        status: ChatTaskStatus.FINISHED,
        durableRunStatus: 'failed',
        isPending: false,
        taskTime: 0,
      });

      runEventIngressRegistry.clear();
      runDomainEventHub.clear();
      if (previousProjectStoreImplementation) {
        getProjectStoreState.mockImplementation(
          previousProjectStoreImplementation
        );
      }
    });

    describe('stream admission attachment ownership', () => {
      const projectStoreState = vi.mocked(useProjectStore.getState);
      let originalProjectStoreImplementation =
        projectStoreState.getMockImplementation();
      let originalStreamImplementation = vi
        .mocked(fetchEventSource)
        .getMockImplementation();
      let originalProxyGetImplementation = vi
        .mocked(proxyFetchGet)
        .getMockImplementation();
      let stores: ReturnType<typeof createChatStoreInstance>[] = [];

      const file = (name: string) => ({
        fileName: name,
        filePath: `/tmp/${name}`,
      });
      const response = () =>
        new Response('', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });

      beforeEach(() => {
        originalProjectStoreImplementation =
          projectStoreState.getMockImplementation();
        originalStreamImplementation = vi
          .mocked(fetchEventSource)
          .getMockImplementation();
        originalProxyGetImplementation = vi
          .mocked(proxyFetchGet)
          .getMockImplementation();
      });

      afterEach(() => {
        for (const store of stores)
          closeSSEConnectionsForTasks(Object.keys(store.getState().tasks));
        stores = [];
        runEventIngressRegistry.clear();
        runDomainEventHub.clear();
        runProjectionStore.clear();
        vi.mocked(waitForBackendReady).mockResolvedValue(true);
        if (originalProjectStoreImplementation)
          projectStoreState.mockImplementation(
            originalProjectStoreImplementation
          );
        vi.mocked(fetchEventSource).mockReset();
        if (originalStreamImplementation)
          vi.mocked(fetchEventSource).mockImplementation(
            originalStreamImplementation
          );
        if (originalProxyGetImplementation)
          vi.mocked(proxyFetchGet).mockImplementation(
            originalProxyGetImplementation
          );
      });

      const beginStartup = ({
        separateOwner = false,
        replay = false,
        resume = false,
      } = {}) => {
        const caller = createChatStoreInstance();
        const owner = separateOwner ? createChatStoreInstance() : caller;
        stores.push(caller, ...(separateOwner ? [owner] : []));
        const runId = owner.getState().create('attachment-run');
        owner.getState().setAttaches(runId, [file('submitted.txt')] as any);
        if (resume) {
          owner.getState().setStatus(runId, ChatTaskStatus.FINISHED);
          owner.getState().setDurableRunStatus(runId, 'interrupted');
          vi.mocked(fetchPost).mockResolvedValueOnce({
            attempt: { attempt_number: 2 },
          });
        }
        if (separateOwner) {
          caller.getState().create('caller-run');
          caller
            .getState()
            .setAttaches('caller-run', [file('caller.txt')] as any);
        }
        let releaseReady!: (ready: boolean) => void;
        if (!replay)
          vi.mocked(waitForBackendReady).mockReturnValueOnce(
            new Promise<boolean>((resolve) => {
              releaseReady = resolve;
            })
          );
        vi.mocked(proxyFetchGet).mockImplementation(async (url: string) =>
          url.includes('/snapshots')
            ? []
            : {
                value: 'test-cloud-key',
                api_url: 'https://models.example.test',
                items: [],
              }
        );
        const streams = new Map<string, any>();
        let finishStream!: () => void;
        vi.mocked(fetchEventSource).mockImplementation(async (url, options) => {
          streams.set(String(url), options);
          await new Promise<void>((resolve) => {
            if (
              String(url).includes('/playback/') ||
              String(url).endsWith('/chat')
            )
              finishStream = resolve;
          });
        });
        projectStoreState.mockReturnValue({
          activeProjectId: 'project-1',
          appendInitChatStore: () => ({ taskId: runId, chatStore: owner }),
          getChatStore: () => owner,
          getProjectById: () => ({
            id: 'project-1',
            mode: 'single',
            spaceId: 'space-1',
          }),
          getHistoryId: () => null,
          getAllChatStores: () => [{ chatId: 'primary', chatStore: owner }],
          setActiveChatStore: vi.fn(),
          getProjectModel: () => null,
          setProjectModel: vi.fn(),
          setProjectSpace: vi.fn(),
          setHistoryId: vi.fn(),
          getProjectThinkingEffortOverride: () => undefined,
        } as any);
        const admission = caller.getState().startTask(
          runId,
          replay ? 'replay' : undefined,
          undefined,
          undefined,
          resume ? undefined : 'Submit this task',
          resume ? undefined : ([file('submitted.txt')] as any),
          undefined,
          'project-1',
          'single' as any,
          replay
            ? undefined
            : {
                preserveTaskId: true,
                awaitAdmission: true,
                ...(resume
                  ? {
                      resumeRequestId: 'resume-existing-draft',
                      skipHistoryCreate: true,
                    }
                  : {}),
              }
        );
        const getStream = async () => {
          await vi.waitFor(() =>
            expect(
              [...streams.keys()].some((url) =>
                replay ? url.includes('/playback/') : url.endsWith('/chat')
              )
            ).toBe(true)
          );
          return [...streams.entries()].find(([url]) =>
            replay ? url.includes('/playback/') : url.endsWith('/chat')
          )![1];
        };
        return {
          caller,
          owner,
          runId,
          admission,
          getStream,
          releaseReady: () => releaseReady(true),
          finishStream: () => finishStream(),
        };
      };

      it('preserves draft files added after task preparation but before readiness and first open', async () => {
        const startup = beginStartup();
        const nextDraft = [file('next-turn.txt')];
        startup.owner.getState().setAttaches(startup.runId, nextDraft as any);
        startup.releaseReady();
        const stream = await startup.getStream();
        await stream.onopen(response());
        await startup.admission;

        expect(startup.owner.getState().tasks[startup.runId].attaches).toEqual(
          nextDraft
        );
        expect(JSON.parse(stream.body).attaches).toEqual([
          '/tmp/submitted.txt',
        ]);
      });

      it('clears only the initial owner when another task becomes active before open', async () => {
        const startup = beginStartup();
        startup.owner.getState().create('other-run');
        startup.owner
          .getState()
          .setAttaches('other-run', [file('other.txt')] as any);
        startup.releaseReady();
        const stream = await startup.getStream();
        await stream.onopen(response());
        await startup.admission;

        expect(startup.owner.getState().tasks[startup.runId].attaches).toEqual(
          []
        );
        expect(startup.owner.getState().tasks['other-run'].attaches).toEqual([
          file('other.txt'),
        ]);
      });

      it('clears unchanged submitted draft files in the target store, not the calling store', async () => {
        const startup = beginStartup({ separateOwner: true });
        startup.releaseReady();
        const stream = await startup.getStream();
        await stream.onopen(response());
        await startup.admission;

        expect(startup.owner.getState().tasks[startup.runId].attaches).toEqual(
          []
        );
        expect(startup.caller.getState().tasks['caller-run'].attaches).toEqual([
          file('caller.txt'),
        ]);
      });

      it('does not clear a later draft when the admitted transport reconnects', async () => {
        const startup = beginStartup();
        startup.releaseReady();
        const stream = await startup.getStream();
        await stream.onopen(response());
        await startup.admission;
        const nextDraft = [file('next-turn.txt')];
        startup.owner.getState().setAttaches(startup.runId, nextDraft as any);

        await stream.onopen(response());

        expect(startup.owner.getState().tasks[startup.runId].attaches).toEqual(
          nextDraft
        );
      });

      it('preserves the existing draft when an interrupted Run resumes', async () => {
        const startup = beginStartup({ resume: true });
        const originalDraft =
          startup.owner.getState().tasks[startup.runId].attaches;
        startup.releaseReady();
        const stream = await startup.getStream();
        await stream.onopen(response());
        await startup.admission;

        expect(fetchPost).toHaveBeenCalledWith('/runs/attachment-run/resume', {
          request_id: 'resume-existing-draft',
          reason: 'explicit_resume',
        });
        expect(startup.owner.getState().tasks[startup.runId].attaches).toBe(
          originalDraft
        );
        expect(startup.owner.getState().tasks[startup.runId].messages).toEqual(
          []
        );
      });

      it('does not clear an unrelated active draft when replay opens', async () => {
        const startup = beginStartup({ replay: true });
        startup.owner.getState().create('live-draft');
        startup.owner
          .getState()
          .setAttaches('live-draft', [file('live.txt')] as any);
        const stream = await startup.getStream();
        await stream.onopen(response());
        startup.finishStream();
        await startup.admission;

        expect(startup.owner.getState().tasks['live-draft'].attaches).toEqual([
          file('live.txt'),
        ]);
        expect(startup.owner.getState().tasks[startup.runId].attaches).toEqual([
          file('submitted.txt'),
        ]);
      });
    });

    describe('canonical terminal observer lifecycle', () => {
      const projectStoreState = vi.mocked(useProjectStore.getState);
      const originalProjectStoreImplementation =
        projectStoreState.getMockImplementation();
      const originalFetchEventSourceImplementation = vi
        .mocked(fetchEventSource)
        .getMockImplementation();
      let stores: ReturnType<typeof createChatStoreInstance>[] = [];

      const canonicalEvent = (
        runId: string,
        eventType: string,
        message = 'Background preview did not stop.'
      ) => ({
        event_id: `${eventType}:${runId}`,
        event_type: eventType,
        legacy_step: null,
        payload: { message },
        project_id: 'project-1',
        run_id: runId,
        sequence: 1,
        run_version: 1,
        created_at: Date.now() / 1000,
      });

      const startObservedLiveTask = async ({
        initialRunId = 'live-run',
        projectedStatus,
        executionId,
        resumeRequestId,
      }: {
        initialRunId?: string;
        projectedStatus?: 'failed' | 'completed' | 'cancelled' | 'interrupted';
        executionId?: string;
        resumeRequestId?: string;
      } = {}) => {
        vi.mocked(proxyFetchGet).mockResolvedValue({
          value: 'test-cloud-key',
          api_url: 'https://models.example.test',
          items: [],
          warning_code: null,
        });
        runDomainEventHub.clear();
        runEventIngressRegistry.clear();
        runProjectionStore.clear();

        const streams = new Map<string, any>();
        vi.mocked(fetchEventSource).mockImplementation(async (url, options) => {
          streams.set(String(url), options);
          const response = new Response('', {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          });
          await options.onopen?.(response);
          await new Promise<void>(() => {});
        });

        const store = createChatStoreInstance();
        stores.push(store);
        const appendInitChatStore = vi.fn(
          (_projectId: string, requestedRunId?: string) => {
            const runId = requestedRunId || initialRunId;
            if (!store.getState().tasks[runId]) {
              store.getState().create(runId);
            }
            store.getState().setActiveTaskId(runId);
            return { taskId: runId, chatStore: store };
          }
        );
        projectStoreState.mockReturnValue({
          activeProjectId: 'project-1',
          appendInitChatStore,
          getChatStore: () => store,
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

        if (projectedStatus) {
          runProjectionStore.upsertRunSummaries('project-1', [
            {
              run_id: initialRunId,
              project_id: 'project-1',
              status: projectedStatus,
              version: 1,
              latest_attempt: { attempt_number: 1, status: projectedStatus },
              updated_at: Date.now(),
            },
          ]);
        }

        await store.getState().startTask(
          resumeRequestId ? initialRunId : 'initial-task',
          undefined,
          undefined,
          undefined,
          'Create a game',
          [],
          executionId,
          'project-1',
          'single' as any,
          resumeRequestId
            ? {
                resumeRequestId,
                preserveTaskId: true,
                skipHistoryCreate: true,
                awaitAdmission: true,
              }
            : undefined
        );
        await vi.waitFor(() =>
          expect([...streams.keys()].some((url) => url.endsWith('/chat'))).toBe(
            true
          )
        );

        const streamContaining = (path: string) =>
          [...streams.entries()].find(([url]) => url.includes(path))?.[1];
        return { store, streamContaining };
      };

      const switchLegacyStreamToFollowUp = async ({
        store,
        streamContaining,
        initialRunId = 'live-run',
        followUpRunId = 'follow-up-run',
      }: {
        store: ReturnType<typeof createChatStoreInstance>;
        streamContaining: (path: string) => any;
        initialRunId?: string;
        followUpRunId?: string;
      }) => {
        const legacyStream = streamContaining('/chat');
        const signal = legacyStream.signal as AbortSignal;

        expect(hasActiveSSEConnection([initialRunId])).toBe(true);
        expect(hasAnyActiveLegacySSEConnection()).toBe(true);

        await legacyStream.onmessage?.({
          data: JSON.stringify({
            step: AgentStep.END,
            data: { content: 'Done' },
          }),
        });

        expect(signal.aborted).toBe(false);
        expect(hasActiveSSEConnection([initialRunId])).toBe(false);
        expect(hasSSETransportForTasks([initialRunId])).toBe(true);
        expect(hasAnyActiveLegacySSEConnection()).toBe(false);

        store.getState().setNextTaskId(followUpRunId);
        await legacyStream.onmessage?.({
          data: JSON.stringify({
            step: AgentStep.NEW_TASK_STATE,
            data: {
              task_id: followUpRunId,
              content: 'Improve the game',
            },
          }),
        });

        expect(hasActiveSSEConnection([initialRunId])).toBe(false);
        expect(hasActiveSSEConnection([followUpRunId])).toBe(true);
        expect(hasAnyActiveLegacySSEConnection()).toBe(true);
        expect(signal.aborted).toBe(false);

        return signal;
      };

      afterEach(() => {
        for (const store of stores) {
          closeSSEConnectionsForTasks(Object.keys(store.getState().tasks));
        }
        stores = [];
        runEventIngressRegistry.clear();
        runDomainEventHub.clear();
        runProjectionStore.clear();
        vi.mocked(fetchEventSource).mockReset();
        if (originalFetchEventSourceImplementation) {
          vi.mocked(fetchEventSource).mockImplementation(
            originalFetchEventSourceImplementation
          );
        }
        if (originalProjectStoreImplementation) {
          projectStoreState.mockImplementation(
            originalProjectStoreImplementation
          );
        }
      });

      describe('durable Trigger delivery integration', () => {
        beforeEach(async () => {
          // Exercise the real outbox and terminal receipt arbitration; only
          // HTTP is mocked, so an early immutable outcome cannot hide here.
          const actual = await vi.importActual<
            typeof import('@/service/triggerApi')
          >('@/service/triggerApi');
          vi.mocked(proxyUpdateTriggerExecution).mockImplementation(
            actual.proxyUpdateTriggerExecution
          );
          vi.mocked(proxyFetchPut).mockResolvedValue({});
        });

        afterEach(() => {
          vi.mocked(proxyUpdateTriggerExecution).mockImplementation(() =>
            Promise.resolve()
          );
        });

        const receipts = (executionId: string) =>
          vi
            .mocked(proxyFetchPut)
            .mock.calls.filter(
              ([path]) => path === `/api/v1/execution/${executionId}`
            )
            .map(([, body]) => body as { status: string; tokens_used: number });

        describe('closed legacy usage recovery', () => {
          // Keep these tests on real chatStore + Journal reader + Trigger
          // outbox. Only the two HTTP boundaries are mocked.
          let originalRead: typeof fetchGet | undefined;
          beforeEach(() => {
            releaseProjectEventStore('project-1');
            originalRead = vi.mocked(fetchGet).getMockImplementation();
          });
          afterEach(() => {
            releaseProjectEventStore('project-1');
            vi.mocked(fetchGet).mockImplementation(
              originalRead || (() => Promise.resolve(undefined))
            );
          });

          const journal = (eventType: string, runId = 'live-run') => {
            const event = (
              sequence: number,
              type: string,
              payload: Record<string, unknown>
            ) => ({
              ...canonicalEvent(runId, type),
              event_id: `${runId}:${sequence}`,
              sequence,
              run_sequence: sequence,
              run_version: sequence,
              payload,
            });
            return [
              event(1, 'run.attempt_started', {
                attempt_number: 1,
                attempt_id: 'attempt-1',
              }),
              event(2, 'model.invocation.completed', {
                invocation_id: 'invocation-1',
                attempt_id: 'attempt-1',
                usage: { prompt_tokens: 80, completion_tokens: 43 },
              }),
              {
                ...event(3, 'legacy.request_usage', {
                  agent_id: 'developer-1',
                  tokens: 123,
                  step_total_tokens: 123,
                }),
                legacy_step: AgentStep.REQUEST_USAGE,
              },
              event(4, eventType, { message: 'Final outcome' }),
            ];
          };
          const page = (events: ReturnType<typeof journal>) => ({
            project_id: 'project-1',
            run_id: events[0].run_id,
            after_sequence: 0,
            next_sequence: events.at(-1)!.sequence,
            has_more: false,
            events,
          });
          const publish = (events: ReturnType<typeof journal>) => {
            for (const event of events)
              runEventIngressRegistry.ingest(
                'project-1',
                event.run_id,
                event,
                'live'
              );
          };

          it.each([
            ['run.failed', ExecutionStatus.Failed, false],
            ['run.cancelled', ExecutionStatus.Cancelled, false],
            ['run.deadline_reached', ExecutionStatus.Failed, false],
            ['run.failed', ExecutionStatus.Failed, true],
            ['run.completed', ExecutionStatus.Completed, true],
          ] as const)(
            'recovers committed usage after %s (legacy closed first=%s)',
            async (eventType, status, alreadyClosed) => {
              const executionId = `journal-${eventType}-${alreadyClosed}`;
              const { store, streamContaining } = await startObservedLiveTask({
                executionId,
              });
              const legacy = streamContaining('/chat');
              const events = journal(eventType);
              let resolvePage!: (value: ReturnType<typeof page>) => void;
              vi.mocked(fetchGet).mockImplementation((path) =>
                path === '/runs/live-run/events'
                  ? new Promise((resolve) => {
                      resolvePage = resolve;
                    })
                  : Promise.resolve(undefined)
              );
              if (alreadyClosed) legacy.onclose();
              publish(events);
              expect(legacy.signal.aborted).toBe(true);
              expect(store.getState().tasks['live-run'].status).toBe(
                ChatTaskStatus.FINISHED
              );
              await vi.waitFor(() =>
                expect(receipts(executionId)).toHaveLength(1)
              );
              // The physical stream cannot deliver more deltas. This formerly
              // lost receipt is recovered from its commit-before-yield journal.
              await legacy.onmessage({
                data: JSON.stringify({
                  step: AgentStep.REQUEST_USAGE,
                  data: { agent_id: 'developer-1', tokens: 123 },
                }),
              });
              expect(store.getState().tasks['live-run'].tokens).toBe(0);
              resolvePage(page(events));
              await vi.waitFor(() =>
                expect(receipts(executionId).at(-1)).toMatchObject({
                  status,
                  tokens_used: 123,
                })
              );
              expect(store.getState().tasks['live-run'].tokens).toBe(123);
              const sent = receipts(executionId);
              expect(sent).toHaveLength(2);
              expect(sent[1]).toEqual({ ...sent[0], tokens_used: 123 });
              publish(events);
              await Promise.resolve();
              expect(receipts(executionId)).toHaveLength(2);
              expect(
                vi
                  .mocked(fetchGet)
                  .mock.calls.filter(([path]) => path.endsWith('/events'))
              ).toHaveLength(1);
            }
          );

          it.each(['close', 'error', 'idle retirement'] as const)(
            'recovers completed usage when legacy %s follows canonical completion without END',
            async (closeMode) => {
              const executionId = `completed-journal-${closeMode}`;
              const { store, streamContaining } = await startObservedLiveTask({
                executionId,
              });
              const legacy = streamContaining('/chat');
              const events = journal('run.completed');
              vi.mocked(fetchGet).mockImplementation((path) =>
                Promise.resolve(
                  path === '/runs/live-run/events' ? page(events) : undefined
                )
              );
              publish(events);
              expect(legacy.signal.aborted).toBe(false);
              expect(
                vi
                  .mocked(fetchGet)
                  .mock.calls.some(([path]) => path.endsWith('/events'))
              ).toBe(false);
              if (closeMode === 'close') legacy.onclose();
              else if (closeMode === 'idle retirement')
                closeIdleSSEConnectionsForTasks(['live-run']);
              else
                expect(() =>
                  legacy.onerror(new Error('connection closed'))
                ).toThrow('connection closed');
              await vi.waitFor(() =>
                expect(receipts(executionId).at(-1)?.tokens_used).toBe(123)
              );
              expect(store.getState().tasks['live-run']).toMatchObject({
                tokens: 123,
                status: ChatTaskStatus.FINISHED,
                durableRunStatus: 'completed',
              });
            }
          );

          it('enriches the receipt even when the UI already received usage before a missing END', async () => {
            const executionId = 'completed-usage-without-end';
            const { store, streamContaining } = await startObservedLiveTask({
              executionId,
            });
            const legacy = streamContaining('/chat');
            const events = journal('run.completed');
            vi.mocked(fetchGet).mockImplementation((path) =>
              Promise.resolve(
                path === '/runs/live-run/events' ? page(events) : undefined
              )
            );
            publish(events);
            await vi.waitFor(() =>
              expect(receipts(executionId).at(-1)?.tokens_used).toBe(0)
            );
            await legacy.onmessage({
              data: JSON.stringify({
                step: AgentStep.REQUEST_USAGE,
                data: { agent_id: 'developer-1', tokens: 123 },
              }),
            });
            expect(store.getState().tasks['live-run'].tokens).toBe(123);
            closeIdleSSEConnectionsForTasks(['live-run']);
            await vi.waitFor(() =>
              expect(receipts(executionId).at(-1)?.tokens_used).toBe(123)
            );
            expect(store.getState().tasks['live-run'].tokens).toBe(123);
          });

          it('uses the actual terminal journal boundary for a snapshot without an event cursor', async () => {
            const executionId = 'snapshot-journal-usage';
            const { store } = await startObservedLiveTask({ executionId });
            const events = journal('run.deadline_reached');
            vi.mocked(fetchGet).mockResolvedValue(page(events));
            runProjectionStore.upsertRunSummaries('project-1', [
              {
                run_id: 'live-run',
                project_id: 'project-1',
                status: 'failed',
                version: 87,
                updated_at: Date.now(),
                latest_attempt: { attempt_number: 1, status: 'failed' },
              },
            ]);
            expect(
              runProjectionStore.getRun('project-1', 'live-run')?.lastSequence
            ).toBe(0);
            await vi.waitFor(() =>
              expect(receipts(executionId).at(-1)?.tokens_used).toBe(123)
            );
            expect(store.getState().tasks['live-run'].tokens).toBe(123);
          });

          it('does not add journal totals to usage already delivered by legacy', async () => {
            const executionId = 'journal-legacy-overlap';
            const { store, streamContaining } = await startObservedLiveTask({
              executionId,
            });
            await streamContaining('/chat').onmessage({
              data: JSON.stringify({
                step: AgentStep.REQUEST_USAGE,
                data: { agent_id: 'developer-1', tokens: 123 },
              }),
            });
            const events = journal('run.failed');
            vi.mocked(fetchGet).mockResolvedValue(page(events));
            publish(events);
            await vi.waitFor(() =>
              expect(receipts(executionId)).toHaveLength(1)
            );
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(store.getState().tasks['live-run'].tokens).toBe(123);
            expect(receipts(executionId)).toEqual([
              expect.objectContaining({
                status: ExecutionStatus.Failed,
                tokens_used: 123,
              }),
            ]);
          });

          it('keeps delayed recovery on its original Run and execution when focus changes', async () => {
            const executionId = 'journal-original-execution';
            const { store } = await startObservedLiveTask({ executionId });
            let resolvePage!: (value: ReturnType<typeof page>) => void;
            vi.mocked(fetchGet).mockImplementation(
              () =>
                new Promise((resolve) => {
                  resolvePage = resolve;
                })
            );
            const events = journal('run.failed');
            publish(events);
            store.getState().create('new-run');
            store.getState().setExecutionId('new-run', 'new-execution');
            store.getState().setActiveTaskId('new-run');
            resolvePage(page(events));
            await vi.waitFor(() =>
              expect(receipts(executionId).at(-1)?.tokens_used).toBe(123)
            );
            expect(store.getState().tasks['new-run'].tokens).toBe(0);
            expect(receipts('new-execution')).toEqual([]);
          });

          it.each([
            'removed',
            'execution replaced',
            'Resume admission',
          ] as const)(
            'ignores late journal reads after the original owner is %s',
            async (boundary) => {
              const executionId = `journal-owner-${boundary}`;
              const { store } = await startObservedLiveTask({ executionId });
              let resolvePage!: (value: ReturnType<typeof page>) => void;
              let journalSignal!: AbortSignal;
              vi.mocked(fetchGet).mockImplementation(
                (_path, _params, _headers, options) => {
                  journalSignal = options!.signal!;
                  return new Promise((resolve) => {
                    resolvePage = resolve;
                  });
                }
              );
              const events = journal('run.failed');
              publish(events);
              await vi.waitFor(() =>
                expect(receipts(executionId)).toHaveLength(1)
              );
              if (boundary === 'removed')
                store.getState().removeTask('live-run');
              else if (boundary === 'execution replaced')
                store
                  .getState()
                  .setExecutionId('live-run', 'replacement-execution');
              else {
                // Even a denied Resume invalidates recovery before readiness
                // yields. The backend still owns whether admission is legal.
                projectStoreState.mockReturnValue({
                  ...projectStoreState(),
                  getAllChatStores: () => [
                    { chatId: 'primary', chatStore: store },
                  ],
                  setActiveChatStore: vi.fn(),
                } as any);
                vi.mocked(fetchPost).mockRejectedValueOnce(
                  new Error('terminal Run cannot Resume')
                );
                await expect(
                  store
                    .getState()
                    .startTask(
                      'live-run',
                      undefined,
                      undefined,
                      undefined,
                      undefined,
                      undefined,
                      undefined,
                      'project-1',
                      'single' as any,
                      {
                        resumeRequestId: 'denied-resume',
                        preserveTaskId: true,
                        skipHistoryCreate: true,
                        awaitAdmission: true,
                      }
                    )
                ).rejects.toThrow('terminal Run cannot Resume');
              }
              resolvePage(page(events));
              await new Promise((resolve) => setTimeout(resolve, 0));
              expect(store.getState().tasks['live-run']?.tokens || 0).toBe(0);
              expect(receipts(executionId)).toHaveLength(1);
              expect(receipts('replacement-execution')).toEqual([]);
              if (boundary !== 'execution replaced')
                expect(journalSignal.aborted).toBe(true);
            }
          );
        });

        it.each([
          ['runtime.interrupted', false],
          ['run.interrupted', false],
          ['runtime.interrupted', true],
        ] as const)(
          'allows Resume after %s to complete the same execution (legacy error first=%s)',
          async (eventType, legacyErrorFirst) => {
            const executionId = `resume-${eventType}-${legacyErrorFirst}`;
            const { store, streamContaining } = await startObservedLiveTask({
              executionId,
            });
            if (legacyErrorFirst) {
              await streamContaining('/chat').onmessage({
                data: JSON.stringify({
                  step: AgentStep.ERROR,
                  data: {
                    message: 'Provider temporarily unavailable',
                    retryable: true,
                  },
                }),
              });
              expect(store.getState().tasks['live-run'].durableRunStatus).toBe(
                'interrupted'
              );
              expect(fetchDelete).not.toHaveBeenCalledWith('/chat/project-1');
            }
            runEventIngressRegistry.ingest(
              'project-1',
              'live-run',
              canonicalEvent('live-run', eventType),
              'live'
            );
            await Promise.resolve();
            expect(receipts(executionId)).toEqual([]);
            expect(store.getState().tasks['live-run']).toMatchObject({
              status: ChatTaskStatus.FINISHED,
              durableRunStatus: 'interrupted',
              executionId,
            });

            projectStoreState.mockReturnValue({
              ...projectStoreState(),
              getAllChatStores: () => [{ chatId: 'primary', chatStore: store }],
              setActiveChatStore: vi.fn(),
            } as any);
            vi.mocked(fetchPost).mockResolvedValueOnce({
              attempt: { attempt_number: 2 },
            });
            await store
              .getState()
              .startTask(
                'live-run',
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                'project-1',
                'single' as any,
                {
                  resumeRequestId: `resume-${executionId}`,
                  preserveTaskId: true,
                  skipHistoryCreate: true,
                  awaitAdmission: true,
                }
              );
            runEventIngressRegistry.ingest(
              'project-1',
              'live-run',
              {
                ...canonicalEvent('live-run', 'run.attempt_started'),
                sequence: 2,
                run_version: 2,
                payload: { attempt_number: 2 },
              },
              'live'
            );
            runEventIngressRegistry.ingest(
              'project-1',
              'live-run',
              {
                ...canonicalEvent('live-run', 'run.completed'),
                sequence: 3,
                run_version: 3,
              },
              'live'
            );
            await streamContaining('/chat').onmessage({
              data: JSON.stringify({
                step: AgentStep.END,
                data: { message: 'Resumed successfully', tokens: 321 },
              }),
            });
            await vi.waitFor(() =>
              expect(receipts(executionId).at(-1)).toMatchObject({
                status: ExecutionStatus.Completed,
                tokens_used: 321,
              })
            );
            expect(
              receipts(executionId).every(
                (receipt) => receipt.status === ExecutionStatus.Completed
              )
            ).toBe(true);
            expect(store.getState().tasks['live-run']).toMatchObject({
              durableRunStatus: 'completed',
              executionId,
            });
          }
        );

        it.each(['run.failed', 'run.cancelled'])(
          'keeps a true %s execution outcome immutable',
          async (eventType) => {
            const executionId = `immutable-${eventType}`;
            const { streamContaining } = await startObservedLiveTask({
              executionId,
            });
            runEventIngressRegistry.ingest(
              'project-1',
              'live-run',
              canonicalEvent('live-run', eventType),
              'live'
            );
            const status =
              eventType === 'run.failed'
                ? ExecutionStatus.Failed
                : ExecutionStatus.Cancelled;
            await vi.waitFor(() =>
              expect(receipts(executionId).at(-1)?.status).toBe(status)
            );
            await streamContaining('/chat').onmessage({
              data: JSON.stringify({
                step: AgentStep.END,
                data: { tokens: 123 },
              }),
            });
            await proxyUpdateTriggerExecution(executionId, {
              status: ExecutionStatus.Completed,
              tokens_used: 123,
            });
            expect(receipts(executionId)).toHaveLength(1);
            expect(receipts(executionId)[0].status).toBe(status);
          }
        );

        it.each([
          [true, 0],
          [false, 0],
          [true, 17],
          [false, 17],
        ] as const)(
          'preserves final usage with independent terminal streams (canonical first=%s, partial tokens=%s)',
          async (canonicalFirst, partialTokens) => {
            const executionId = `terminal-usage-${canonicalFirst}-${partialTokens}`;
            const { store, streamContaining } = await startObservedLiveTask({
              executionId,
            });
            store.getState().addTokens('live-run', partialTokens);
            const complete = () =>
              runEventIngressRegistry.ingest(
                'project-1',
                'live-run',
                canonicalEvent('live-run', 'run.completed'),
                'live'
              );
            if (canonicalFirst) {
              complete();
              await vi.waitFor(() =>
                expect(receipts(executionId).at(-1)).toMatchObject({
                  status: ExecutionStatus.Completed,
                  tokens_used: partialTokens,
                })
              );
            }
            await streamContaining('/chat').onmessage({
              data: JSON.stringify({
                step: AgentStep.END,
                data: { message: 'Done', tokens: 123 },
              }),
            });
            if (!canonicalFirst) complete();
            await vi.waitFor(() =>
              expect(receipts(executionId).at(-1)).toMatchObject({
                status: ExecutionStatus.Completed,
                tokens_used: 123,
              })
            );
            expect(store.getState().tasks['live-run'].tokens).toBe(123);
            const sentCount = receipts(executionId).length;
            await proxyUpdateTriggerExecution(executionId, {
              status: ExecutionStatus.Completed,
              tokens_used: 0,
            });
            expect(receipts(executionId)).toHaveLength(sentCount);
            expect(receipts(executionId).at(-1)?.tokens_used).toBe(123);
          }
        );
      });

      it('reports a canonical-only trigger failure without waiting for the legacy ERROR frame', async () => {
        const { store } = await startObservedLiveTask({
          initialRunId: 'trigger-run',
          executionId: 'execution-canonical-failure',
        });
        await vi.waitFor(() =>
          expect(runDomainEventHub.listenerCount()).toBe(1)
        );

        runEventIngressRegistry.ingest(
          'project-1',
          'trigger-run',
          canonicalEvent(
            'trigger-run',
            'run.failed',
            'Workspace cleanup failed.'
          ),
          'live'
        );

        await vi.waitFor(() =>
          expect(proxyUpdateTriggerExecution).toHaveBeenCalledWith(
            'execution-canonical-failure',
            expect.objectContaining({
              status: ExecutionStatus.Failed,
              error_message: 'Workspace cleanup failed.',
            }),
            { projectId: 'project-1' }
          )
        );
        expect(store.getState().tasks['trigger-run']).toMatchObject({
          status: ChatTaskStatus.FINISHED,
          durableRunStatus: 'failed',
          isPending: false,
        });
      });

      it.each(['run.failed', 'run.cancelled', 'run.interrupted'])(
        'cancels plan auto-confirm when %s settles the Run',
        async (eventType) => {
          const { store, streamContaining } = await startObservedLiveTask();
          vi.useFakeTimers();
          try {
            await streamContaining('/chat').onmessage?.({
              data: JSON.stringify({
                step: AgentStep.TO_SUB_TASKS,
                data: {
                  sub_tasks: [{ id: 'sub1', content: 'Build the page' }],
                },
              }),
            });
            expect(
              store.getState().tasks['live-run'].autoConfirmDeadline
            ).not.toBeNull();
            runEventIngressRegistry.ingest(
              'project-1',
              'live-run',
              canonicalEvent('live-run', eventType),
              'live'
            );
            expect(
              store.getState().tasks['live-run'].autoConfirmDeadline
            ).toBeNull();
            vi.mocked(fetchPost).mockClear();
            await vi.advanceTimersByTimeAsync(30001);
            expect(store.getState().tasks['live-run'].status).toBe(
              ChatTaskStatus.FINISHED
            );
            expect(fetchPost).not.toHaveBeenCalledWith(
              '/task/project-1/start',
              {}
            );
          } finally {
            vi.useRealTimers();
          }
        }
      );

      it.each([
        ['edit', false],
        ['edit', true],
        ['start', false],
        ['start', true],
      ] as const)(
        'does not revive a terminal Run after plan %s resolves (rejected=%s)',
        async (phase, rejected) => {
          const { store, streamContaining } = await startObservedLiveTask();
          await streamContaining('/chat').onmessage?.({
            data: JSON.stringify({
              step: AgentStep.TO_SUB_TASKS,
              data: { sub_tasks: [{ id: 'sub1', content: 'Build the page' }] },
            }),
          });
          let resolveRequest!: () => void;
          let rejectRequest!: (error: Error) => void;
          const pending = new Promise<void>((resolve, reject) => {
            resolveRequest = resolve;
            rejectRequest = reject;
          });
          const request = vi.mocked(phase === 'edit' ? fetchPut : fetchPost);
          request.mockImplementationOnce(() => pending);
          const confirming = store
            .getState()
            .handleConfirmTask('project-1', 'live-run');
          await vi.waitFor(() => expect(request).toHaveBeenCalled());
          runEventIngressRegistry.ingest(
            'project-1',
            'live-run',
            canonicalEvent('live-run', 'run.failed'),
            'live'
          );
          if (rejected) rejectRequest(new Error('late request failure'));
          else resolveRequest();
          await confirming;
          expect(store.getState().tasks['live-run']).toMatchObject({
            status: ChatTaskStatus.FINISHED,
            taskTime: 0,
            autoConfirmDeadline: null,
          });
          if (phase === 'edit')
            expect(fetchPost).not.toHaveBeenCalledWith(
              '/task/project-1/start',
              {}
            );
        }
      );

      it('does not rearm auto-confirm when saving finishes after a terminal event', async () => {
        const { store, streamContaining } = await startObservedLiveTask();
        await streamContaining('/chat').onmessage?.({
          data: JSON.stringify({
            step: AgentStep.TO_SUB_TASKS,
            data: { sub_tasks: [{ id: 'sub1', content: 'Build the page' }] },
          }),
        });
        let resolveSave!: () => void;
        vi.mocked(fetchPut).mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              resolveSave = resolve;
            })
        );
        const saving = store.getState().savePlan('live-run');
        runEventIngressRegistry.ingest(
          'project-1',
          'live-run',
          canonicalEvent('live-run', 'run.failed'),
          'live'
        );
        resolveSave();
        await saving;
        expect(store.getState().tasks['live-run']).toMatchObject({
          status: ChatTaskStatus.FINISHED,
          autoConfirmDeadline: null,
        });
        expect(fetchPost).not.toHaveBeenCalledWith('/task/project-1/start', {});
      });

      it('does not let an old save overwrite plan edits after terminal and Resume', async () => {
        const { store, streamContaining } = await startObservedLiveTask();
        await streamContaining('/chat').onmessage?.({
          data: JSON.stringify({
            step: AgentStep.TO_SUB_TASKS,
            data: { sub_tasks: [{ id: 'sub1', content: 'Build the page' }] },
          }),
        });
        let resolveSave!: () => void;
        vi.mocked(fetchPut).mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              resolveSave = resolve;
            })
        );
        const saving = store.getState().savePlan('live-run');
        runEventIngressRegistry.ingest(
          'project-1',
          'live-run',
          canonicalEvent('live-run', 'run.interrupted'),
          'live'
        );
        store.getState().setStatus('live-run', ChatTaskStatus.PENDING);
        store.getState().setPlanDirty('live-run', true);
        const resumedDeadline = Date.now() + 45_000;
        store.getState().setAutoConfirmDeadline('live-run', resumedDeadline);

        resolveSave();
        await saving;

        expect(store.getState().tasks['live-run']).toMatchObject({
          status: ChatTaskStatus.PENDING,
          planDirty: true,
          autoConfirmDeadline: resumedDeadline,
        });
        expect(fetchPost).not.toHaveBeenCalledWith('/task/project-1/start', {});
      });

      it('does not let an old auto-confirm callback clear the resumed plan state', async () => {
        const { store, streamContaining } = await startObservedLiveTask();
        vi.useFakeTimers();
        try {
          await streamContaining('/chat').onmessage?.({
            data: JSON.stringify({
              step: AgentStep.TO_SUB_TASKS,
              data: { sub_tasks: [{ id: 'sub1', content: 'Build the page' }] },
            }),
          });
          let resolveEdit!: () => void;
          vi.mocked(fetchPut).mockImplementationOnce(
            () =>
              new Promise<void>((resolve) => {
                resolveEdit = resolve;
              })
          );
          vi.advanceTimersByTime(30_000);
          expect(fetchPut).toHaveBeenCalledWith(
            '/task/project-1',
            expect.anything()
          );

          runEventIngressRegistry.ingest(
            'project-1',
            'live-run',
            canonicalEvent('live-run', 'run.interrupted'),
            'live'
          );
          store.getState().setStatus('live-run', ChatTaskStatus.PENDING);
          store.getState().setPlanDirty('live-run', true);
          const resumedDeadline = Date.now() + 45_000;
          store.getState().setAutoConfirmDeadline('live-run', resumedDeadline);

          resolveEdit();
          await vi.advanceTimersByTimeAsync(0);

          expect(store.getState().tasks['live-run']).toMatchObject({
            status: ChatTaskStatus.PENDING,
            planDirty: true,
            autoConfirmDeadline: resumedDeadline,
          });
          expect(fetchPost).not.toHaveBeenCalledWith(
            '/task/project-1/start',
            {}
          );
        } finally {
          vi.useRealTimers();
        }
      });

      it('invalidates a pending plan confirmation across terminal and Resume', async () => {
        const { store, streamContaining } = await startObservedLiveTask();
        await streamContaining('/chat').onmessage?.({
          data: JSON.stringify({
            step: AgentStep.TO_SUB_TASKS,
            data: { sub_tasks: [{ id: 'sub1', content: 'Build the page' }] },
          }),
        });
        let resolveEdit!: () => void;
        vi.mocked(fetchPut).mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              resolveEdit = resolve;
            })
        );
        const confirming = store
          .getState()
          .handleConfirmTask('project-1', 'live-run');
        runEventIngressRegistry.ingest(
          'project-1',
          'live-run',
          canonicalEvent('live-run', 'run.interrupted'),
          'live'
        );
        store.getState().setStatus('live-run', ChatTaskStatus.PENDING);
        resolveEdit();
        await confirming;
        expect(store.getState().tasks['live-run'].status).toBe(
          ChatTaskStatus.PENDING
        );
        expect(fetchPost).not.toHaveBeenCalledWith('/task/project-1/start', {});
      });

      it.each([
        ['completed', ExecutionStatus.Completed],
        ['failed', ExecutionStatus.Failed],
        ['cancelled', ExecutionStatus.Cancelled],
        ['interrupted', undefined],
      ] as const)(
        'settles a reconciled %s snapshot without a terminal event',
        async (status, executionStatus) => {
          const runId = `reconciled-${status}`;
          const executionId = `execution-${runId}`;
          const { store, streamContaining } = await startObservedLiveTask({
            initialRunId: runId,
            executionId,
          });
          const signal = streamContaining('/chat').signal as AbortSignal;
          vi.mocked(fetchGet).mockResolvedValueOnce({
            project_id: 'project-1',
            run_id: runId,
            status,
            version: 2,
            origin: 'local',
            updated_at: Date.now() / 1000,
            latest_attempt: { attempt_number: 1, status },
            total_attempt_elapsed_ms: 1200,
          });

          await streamContaining(`/runs/${runId}/stream`).onmessage?.({
            event: 'runtime_detached',
            data: '{}',
          });

          await vi.waitFor(() =>
            expect(store.getState().tasks[runId]).toMatchObject({
              status: ChatTaskStatus.FINISHED,
              durableRunStatus: status,
              isPending: false,
              elapsed: 1200,
            })
          );
          expect(hasActiveSSEConnection([runId])).toBe(false);
          expect(hasSSETransportForTasks([runId])).toBe(status === 'completed');
          expect(signal.aborted).toBe(status !== 'completed');
          expect(runDomainEventHub.listenerCount()).toBe(0);
          if (executionStatus) {
            expect(proxyUpdateTriggerExecution).toHaveBeenCalledWith(
              executionId,
              expect.objectContaining({ status: executionStatus }),
              { projectId: 'project-1' }
            );
          } else {
            expect(proxyUpdateTriggerExecution).not.toHaveBeenCalled();
          }

          runEventIngressRegistry.ingest(
            'project-1',
            runId,
            canonicalEvent(runId, `run.${status}`),
            'live'
          );
          expect(
            vi
              .mocked(proxyUpdateTriggerExecution)
              .mock.calls.filter(
                ([id, update]) =>
                  id === executionId &&
                  update.status !== ExecutionStatus.Running
              )
          ).toHaveLength(executionStatus ? 1 : 0);
        }
      );

      it('ignores the previous Run snapshot after rebinding to a follow-up', async () => {
        const { store, streamContaining } = await startObservedLiveTask();
        const signal = await switchLegacyStreamToFollowUp({
          store,
          streamContaining,
        });
        runProjectionStore.upsertRunSummaries('project-1', [
          {
            project_id: 'project-1',
            run_id: 'live-run',
            status: 'failed',
            version: 3,
            updated_at: Date.now(),
          },
        ]);
        await Promise.resolve();
        expect(hasActiveSSEConnection(['follow-up-run'])).toBe(true);
        expect(signal.aborted).toBe(false);
        expect(runDomainEventHub.listenerCount()).toBe(1);

        runProjectionStore.upsertRunSummaries('project-1', [
          {
            project_id: 'project-1',
            run_id: 'follow-up-run',
            status: 'failed',
            version: 3,
            updated_at: Date.now(),
          },
        ]);
        await vi.waitFor(() =>
          expect(store.getState().tasks['follow-up-run'].status).toBe(
            ChatTaskStatus.FINISHED
          )
        );
        expect(signal.aborted).toBe(true);
        expect(runDomainEventHub.listenerCount()).toBe(0);
      });

      it('keeps follow-up terminal ownership when the legacy stream reopens', async () => {
        const { store, streamContaining } = await startObservedLiveTask();
        const signal = await switchLegacyStreamToFollowUp({
          store,
          streamContaining,
        });
        await streamContaining('/chat').onopen?.(
          new Response('', {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          })
        );
        runEventIngressRegistry.ingest(
          'project-1',
          'follow-up-run',
          canonicalEvent('follow-up-run', 'run.failed'),
          'live'
        );
        expect(store.getState().tasks['follow-up-run'].status).toBe(
          ChatTaskStatus.FINISHED
        );
        expect(signal.aborted).toBe(true);
        expect(runDomainEventHub.listenerCount()).toBe(0);
      });

      it.each(['event', 'snapshot'] as const)(
        'settles only the admitted Resume attempt from a terminal %s',
        async (terminalSource) => {
          const runId = `resumed-run-${terminalSource}`;
          vi.mocked(fetchPost).mockResolvedValueOnce({
            run_id: runId,
            attempt: { attempt_number: 2 },
          });
          const { store, streamContaining } = await startObservedLiveTask({
            initialRunId: runId,
            projectedStatus: 'interrupted',
            resumeRequestId: 'resume-request',
          });
          const signal = streamContaining('/chat').signal as AbortSignal;
          expect(signal.aborted).toBe(false);
          expect(hasActiveSSEConnection([runId])).toBe(true);
          expect(store.getState().tasks[runId].status).toBe(
            ChatTaskStatus.PENDING
          );

          // Canonical catch-up can replay the preceding Attempt's terminal
          // receipt before the admitted Attempt's start reaches this renderer.
          runEventIngressRegistry.ingest(
            'project-1',
            runId,
            canonicalEvent(runId, 'run.interrupted'),
            'reconnect_catch_up'
          );
          const eventStore = getProjectEventStore('project-1');
          eventStore.reconcileRunSummary(
            {
              project_id: 'project-1',
              run_id: runId,
              status: 'interrupted',
              version: 1,
              updated_at: Date.now(),
              latest_attempt: { attempt_number: 1, status: 'interrupted' },
            },
            eventStore.getIncarnation()
          );
          vi.mocked(fetchGet).mockRejectedValueOnce(
            new TypeError('NetworkError')
          );
          await streamContaining('/chat').onmessage?.({
            event: 'runtime_detached',
            data: '{}',
          });
          for (let i = 0; i < 20; i++) await Promise.resolve();
          expect(store.getState().tasks[runId].status).toBe(
            ChatTaskStatus.PENDING
          );
          expect(signal.aborted).toBe(false);
          expect(runDomainEventHub.listenerCount()).toBe(1);

          runEventIngressRegistry.ingest(
            'project-1',
            runId,
            {
              ...canonicalEvent(runId, 'run.attempt_started'),
              sequence: 2,
              run_version: 3,
              payload: { attempt_number: 2 },
            },
            'live'
          );
          if (terminalSource === 'event') {
            runEventIngressRegistry.ingest(
              'project-1',
              runId,
              {
                ...canonicalEvent(runId, 'run.failed'),
                sequence: 3,
                run_version: 4,
              },
              'live'
            );
          } else {
            runProjectionStore.upsertRunSummaries('project-1', [
              {
                project_id: 'project-1',
                run_id: runId,
                status: 'failed',
                version: 4,
                updated_at: Date.now(),
                latest_attempt: { attempt_number: 2, status: 'failed' },
              },
            ]);
          }
          await vi.waitFor(() =>
            expect(store.getState().tasks[runId]).toMatchObject({
              status: ChatTaskStatus.FINISHED,
              durableRunStatus: 'failed',
            })
          );
          expect(signal.aborted).toBe(true);
          expect(runDomainEventHub.listenerCount()).toBe(0);
        }
      );

      it('ignores a replayed terminal behind a newer running snapshot', async () => {
        const runId = 'newer-running-attempt';
        const { store, streamContaining } = await startObservedLiveTask({
          initialRunId: runId,
        });
        const signal = streamContaining('/chat').signal as AbortSignal;
        runProjectionStore.upsertRunSummaries('project-1', [
          {
            project_id: 'project-1',
            run_id: runId,
            status: 'running',
            version: 3,
            updated_at: Date.now(),
            latest_attempt: { attempt_number: 2, status: 'running' },
          },
        ]);
        runEventIngressRegistry.ingest(
          'project-1',
          runId,
          canonicalEvent(runId, 'run.failed'),
          'reconnect_catch_up'
        );
        await Promise.resolve();
        expect(store.getState().tasks[runId].status).not.toBe(
          ChatTaskStatus.FINISHED
        );
        expect(signal.aborted).toBe(false);
        expect(runDomainEventHub.listenerCount()).toBe(1);

        runEventIngressRegistry.ingest(
          'project-1',
          runId,
          {
            ...canonicalEvent(runId, 'run.failed'),
            event_id: 'current-attempt-terminal',
            sequence: 2,
            run_version: 4,
          },
          'live'
        );
        expect(store.getState().tasks[runId].status).toBe(
          ChatTaskStatus.FINISHED
        );
        expect(signal.aborted).toBe(true);
        expect(runDomainEventHub.listenerCount()).toBe(0);
      });

      it('delegates one canonical terminal receipt without enqueueing a competing legacy outcome', async () => {
        vi.mocked(proxyUpdateTriggerExecution).mockResolvedValue(undefined);
        const { streamContaining } = await startObservedLiveTask({
          initialRunId: 'trigger-retry-run',
          executionId: 'execution-canonical-retry',
        });
        await vi.waitFor(() =>
          expect(runDomainEventHub.listenerCount()).toBe(1)
        );

        runEventIngressRegistry.ingest(
          'project-1',
          'trigger-retry-run',
          canonicalEvent(
            'trigger-retry-run',
            'run.failed',
            'Canonical cleanup failed.'
          ),
          'live'
        );
        // Model a legacy ERROR frame that was already queued when the
        // canonical terminal receipt disposed the observer and transport.
        await streamContaining('/chat').onmessage?.({
          data: JSON.stringify({
            step: AgentStep.ERROR,
            data: { message: 'Legacy cleanup failed.' },
          }),
        });

        await vi.waitFor(() =>
          expect(proxyUpdateTriggerExecution).toHaveBeenCalledTimes(1)
        );
        const terminalUpdates = vi
          .mocked(proxyUpdateTriggerExecution)
          .mock.calls.map(([, update]) => update.status);
        expect(terminalUpdates).toEqual([ExecutionStatus.Failed]);
        expect(proxyUpdateTriggerExecution).toHaveBeenLastCalledWith(
          'execution-canonical-retry',
          expect.objectContaining({
            status: ExecutionStatus.Failed,
            error_message: 'Canonical cleanup failed.',
          }),
          { projectId: 'project-1' }
        );
      });

      it('reports a terminal trigger status after an earlier running update', async () => {
        let resolveRunningUpdate!: () => void;
        vi.mocked(proxyUpdateTriggerExecution)
          .mockImplementationOnce(
            () =>
              new Promise<void>((resolve) => {
                resolveRunningUpdate = resolve;
              })
          )
          .mockResolvedValue(undefined);
        const { store, streamContaining } = await startObservedLiveTask({
          initialRunId: 'trigger-initial-run',
        });
        const legacyStream = streamContaining('/chat');
        await legacyStream.onmessage?.({
          data: JSON.stringify({
            step: AgentStep.CONFIRMED,
            data: { question: 'Initial scheduled task' },
          }),
        });
        store.getState().setNextTaskId('trigger-follow-up-run');
        store
          .getState()
          .setNextExecutionId(
            'trigger-initial-run',
            'execution-running-then-failed'
          );

        await legacyStream.onmessage?.({
          data: JSON.stringify({
            step: AgentStep.CONFIRMED,
            data: { question: 'Continue scheduled task' },
          }),
        });
        await vi.waitFor(() =>
          expect(proxyUpdateTriggerExecution).toHaveBeenCalledWith(
            'execution-running-then-failed',
            expect.objectContaining({ status: ExecutionStatus.Running }),
            { projectId: 'project-1' }
          )
        );

        runEventIngressRegistry.ingest(
          'project-1',
          'trigger-follow-up-run',
          canonicalEvent(
            'trigger-follow-up-run',
            'run.failed',
            'Follow-up failed.'
          ),
          'live'
        );

        // ChatStore delegates both receipts immediately. The trigger API owns
        // their per-execution serialization and durable terminal delivery.
        expect(proxyUpdateTriggerExecution).toHaveBeenCalledTimes(2);
        resolveRunningUpdate();

        await vi.waitFor(() =>
          expect(proxyUpdateTriggerExecution).toHaveBeenCalledWith(
            'execution-running-then-failed',
            expect.objectContaining({
              status: ExecutionStatus.Failed,
              error_message: 'Follow-up failed.',
            }),
            { projectId: 'project-1' }
          )
        );
      });

      it('rebinds the terminal observer and ingress when the legacy stream switches to a follow-up Run', async () => {
        const { store, streamContaining } = await startObservedLiveTask();
        await vi.waitFor(() =>
          expect(runDomainEventHub.listenerCount()).toBe(1)
        );
        const signal = await switchLegacyStreamToFollowUp({
          store,
          streamContaining,
        });

        await vi.waitFor(() =>
          expect(runEventIngressRegistry.has('follow-up-run')).toBe(true)
        );
        expect(runDomainEventHub.listenerCount()).toBe(1);

        runEventIngressRegistry.ingest(
          'project-1',
          'live-run',
          canonicalEvent('live-run', 'run.failed'),
          'live'
        );
        expect(store.getState().tasks['follow-up-run'].status).not.toBe(
          ChatTaskStatus.FINISHED
        );
        expect(runDomainEventHub.listenerCount()).toBe(1);

        runEventIngressRegistry.ingest(
          'project-1',
          'follow-up-run',
          canonicalEvent('follow-up-run', 'run.failed'),
          'live'
        );
        expect(store.getState().tasks['follow-up-run']).toMatchObject({
          status: ChatTaskStatus.FINISHED,
          durableRunStatus: 'failed',
          isPending: false,
        });
        expect(runDomainEventHub.listenerCount()).toBe(0);
        expect(signal.aborted).toBe(true);
      });

      it('keeps the follow-up observer active when NEW_TASK_STATE races an async END handler', async () => {
        const { store, streamContaining } = await startObservedLiveTask({
          executionId: 'execution-before-follow-up',
        });
        const legacyStream = streamContaining('/chat');
        const signal = legacyStream.signal as AbortSignal;
        store.getState().setNextTaskId('follow-up-run');

        // The real fetch-event-source dispatcher does not await this Promise
        // before invoking the next onmessage callback.
        const endHandling = legacyStream.onmessage?.({
          data: JSON.stringify({
            step: AgentStep.END,
            data: { content: 'Done' },
          }),
        });
        const followUpHandling = legacyStream.onmessage?.({
          data: JSON.stringify({
            step: AgentStep.NEW_TASK_STATE,
            data: {
              task_id: 'follow-up-run',
              content: 'Improve the game',
            },
          }),
        });
        await Promise.all([endHandling, followUpHandling]);

        await vi.waitFor(() =>
          expect(runEventIngressRegistry.has('follow-up-run')).toBe(true)
        );
        expect(hasActiveSSEConnection(['live-run'])).toBe(false);
        expect(hasActiveSSEConnection(['follow-up-run'])).toBe(true);
        expect(hasAnyActiveLegacySSEConnection()).toBe(true);
        expect(runDomainEventHub.listenerCount()).toBe(1);
        expect(signal.aborted).toBe(false);
        await vi.waitFor(() =>
          expect(proxyUpdateTriggerExecution).toHaveBeenCalledWith(
            'execution-before-follow-up',
            expect.objectContaining({ status: ExecutionStatus.Completed }),
            { projectId: 'project-1' }
          )
        );

        runEventIngressRegistry.ingest(
          'project-1',
          'follow-up-run',
          canonicalEvent('follow-up-run', 'run.failed'),
          'live'
        );

        expect(store.getState().tasks['follow-up-run']).toMatchObject({
          status: ChatTaskStatus.FINISHED,
          durableRunStatus: 'failed',
          isPending: false,
        });
        expect(runDomainEventHub.listenerCount()).toBe(0);
        expect(signal.aborted).toBe(true);
      });

      it('closes an idle reusable transport without treating it as an active Run', async () => {
        const { streamContaining } = await startObservedLiveTask({
          initialRunId: 'idle-run',
        });
        const legacyStream = streamContaining('/chat');
        const signal = legacyStream.signal as AbortSignal;

        await legacyStream.onmessage?.({
          data: JSON.stringify({
            step: AgentStep.END,
            data: { content: 'Done' },
          }),
        });

        expect(hasActiveSSEConnection(['idle-run'])).toBe(false);
        expect(hasSSETransportForTasks(['idle-run'])).toBe(true);
        expect(getIdleSSETransportTaskId(['idle-run'])).toBe('idle-run');
        expect(hasAnyActiveLegacySSEConnection()).toBe(false);
        expect(signal.aborted).toBe(false);

        closeIdleSSEConnectionsForTasks(['idle-run']);

        expect(signal.aborted).toBe(true);
        expect(hasActiveSSEConnection(['idle-run'])).toBe(false);
        expect(hasSSETransportForTasks(['idle-run'])).toBe(false);
        expect(getIdleSSETransportTaskId(['idle-run'])).toBeNull();
      });

      describe('successful canonical legacy tails', () => {
        const seedWorkforce = (
          store: ReturnType<typeof createChatStoreInstance>,
          runId = 'live-run'
        ) => {
          const task = {
            id: 'sub-1',
            content: 'Create game',
            status: 'running',
            fileList: [],
          };
          store.getState().setTaskRunning(runId, [{ ...task }] as any);
          store.getState().setTaskAssigning(runId, [
            {
              agent_id: 'developer-1',
              name: 'Developer',
              type: 'developer_agent',
              tasks: [{ ...task }],
              log: [],
              img: [],
              tools: [],
            },
          ] as any);
          store.getState().setStatus(runId, ChatTaskStatus.RUNNING);
          store.getState().setTaskTime(runId, Date.now() - 1000);
        };
        const send = (
          legacy: any,
          step: string,
          data: Record<string, unknown>,
          runId?: string
        ) =>
          legacy.onmessage({
            data: JSON.stringify({
              step,
              data,
              ...(runId ? { run_id: runId } : {}),
            }),
          });
        const complete = (runId = 'live-run') =>
          runEventIngressRegistry.ingest(
            'project-1',
            runId,
            canonicalEvent(runId, 'run.completed', 'Done'),
            'live'
          );

        const displayTailFrames: [string, Record<string, unknown>][] = [
          [
            AgentStep.CREATE_AGENT,
            {
              agent_id: 'developer-1',
              agent_name: 'developer_agent',
              tools: [],
            },
          ],
          [
            AgentStep.ASSIGN_TASK,
            {
              assignee_id: 'developer-1',
              task_id: 'sub-1',
              content: 'Create game',
              state: 'RUNNING',
              failure_count: 1,
            },
          ],
          [
            AgentStep.DEACTIVATE_TOOLKIT,
            {
              agent_id: 'developer-1',
              agent_name: 'developer_agent',
              process_task_id: 'sub-1',
              toolkit_name: 'Terminal Toolkit',
              method_name: 'shell_exec',
              message: 'Success: created game',
            },
          ],
          [
            AgentStep.TERMINAL,
            {
              agent_name: 'developer_agent',
              process_task_id: 'sub-1',
              output: 'Build complete',
            },
          ],
          [
            AgentStep.WRITE_FILE,
            {
              agent_name: 'developer_agent',
              process_task_id: 'sub-1',
              file_path: '/workspace/game.html',
            },
          ],
          [
            AgentStep.NOTICE,
            { process_task_id: 'sub-1', notice: 'Validated output' },
          ],
          [
            AgentStep.DEACTIVATE_AGENT,
            { agent_id: 'developer-1', process_task_id: 'sub-1', tokens: 7 },
          ],
        ];
        const sendDisplayTail = async (legacy: any, runId?: string) => {
          for (const [step, data] of displayTailFrames) {
            await send(legacy, step, data, runId);
          }
        };

        it('reconstructs delayed display dependencies without prebuilt agents or subtasks', async () => {
          const { store, streamContaining } = await startObservedLiveTask();
          const legacy = streamContaining('/chat');
          store.getState().setStatus('live-run', ChatTaskStatus.RUNNING);
          store.getState().setTaskTime('live-run', Date.now() - 1000);
          complete();
          const elapsed = store.getState().tasks['live-run'].elapsed;

          await sendDisplayTail(legacy);
          expect(store.getState().tasks['live-run']).toMatchObject({
            status: ChatTaskStatus.FINISHED,
            durableRunStatus: 'completed',
            taskTime: 0,
            elapsed,
            isPending: false,
            autoConfirmDeadline: null,
            taskRunning: [
              {
                id: 'sub-1',
                status: 'skipped',
                toolkits: [
                  {
                    toolkitStatus: 'completed',
                    message: 'Success: created game',
                  },
                ],
              },
            ],
            taskAssigning: [
              {
                agent_id: 'developer-1',
                status: 'completed',
                tasks: [
                  {
                    id: 'sub-1',
                    status: 'skipped',
                    terminal: ['Build complete'],
                    fileList: [{ path: '/workspace/game.html' }],
                    toolkits: [
                      {
                        toolkitStatus: 'completed',
                        message: 'Success: created game',
                      },
                      {
                        toolkitStatus: 'completed',
                        message: 'Validated output',
                      },
                    ],
                  },
                ],
              },
            ],
          });
          await send(legacy, AgentStep.TASK_STATE, {
            task_id: 'sub-1',
            state: 'DONE',
            result: 'Game created',
          });
          await send(legacy, AgentStep.END, { content: 'Done' });
          expect(store.getState().tasks['live-run']).toMatchObject({
            status: ChatTaskStatus.FINISHED,
            taskTime: 0,
            elapsed,
            taskRunning: [{ id: 'sub-1', status: 'completed' }],
            taskAssigning: [
              {
                tasks: [
                  { id: 'sub-1', status: 'completed', report: 'Game created' },
                ],
              },
            ],
          });
          expect(hasActiveSSEConnection(['live-run'])).toBe(false);
        });

        it('retains terminal assignment evidence and completes a previously started toolkit', async () => {
          const { store, streamContaining } = await startObservedLiveTask();
          const legacy = streamContaining('/chat');
          seedWorkforce(store);
          await send(legacy, AgentStep.ACTIVATE_TOOLKIT, {
            agent_id: 'developer-1',
            agent_name: 'developer_agent',
            process_task_id: 'sub-1',
            toolkit_name: 'Terminal Toolkit',
            method_name: 'shell_exec',
            message: 'Executing',
          });
          await send(legacy, AgentStep.TASK_STATE, {
            task_id: 'sub-1',
            state: 'DONE',
            result: 'Existing result',
          });
          complete();
          await send(legacy, ...displayTailFrames[1]);
          await send(legacy, ...displayTailFrames[2]);
          const task = store.getState().tasks['live-run'];
          expect(task.taskAssigning[0].tasks[0]).toMatchObject({
            status: 'completed',
            report: 'Existing result',
            toolkits: [
              {
                toolkitStatus: 'completed',
                message: expect.stringContaining('Success: created game'),
              },
            ],
          });
          expect(task.taskAssigning[0].tasks[0].toolkits).toHaveLength(1);
          expect(task.taskRunning[0]).toMatchObject({
            status: 'completed',
            toolkits: [
              {
                toolkitStatus: 'completed',
                message: expect.stringContaining('Success: created game'),
              },
            ],
          });
          expect(task.taskAssigning[0].log).toHaveLength(2);
        });

        it('projects deactivation usage without replaying quick-reply completion effects', async () => {
          const { store, streamContaining } = await startObservedLiveTask({
            executionId: 'tail-execution',
          });
          const legacy = streamContaining('/chat');
          seedWorkforce(store);
          store.getState().addTokens('live-run', 17);
          complete();
          const receiptCount = vi.mocked(proxyUpdateTriggerExecution).mock.calls
            .length;
          const historyCount = vi.mocked(proxyFetchPut).mock.calls.length;
          await send(legacy, AgentStep.DEACTIVATE_AGENT, {
            agent_id: 'developer-1',
            agent_name: 'question_confirm_agent',
            process_task_id: 'sub-1',
            status: 'completed',
            message: 'Final response',
            tokens: 123,
          });
          expect(store.getState().tasks['live-run']).toMatchObject({
            tokens: 140,
            status: ChatTaskStatus.FINISHED,
            taskTime: 0,
            taskAssigning: [{ status: 'completed' }],
          });
          expect(proxyUpdateTriggerExecution).toHaveBeenCalledTimes(
            receiptCount
          );
          expect(proxyFetchPut).toHaveBeenCalledTimes(historyCount);
          await send(legacy, AgentStep.END, { content: 'Done' });
          expect(store.getState().tasks['live-run'].tokens).toBe(140);
        });

        it('projects a single-agent toolkit receipt once when display collections share a todo', async () => {
          const { store, streamContaining } = await startObservedLiveTask();
          const legacy = streamContaining('/chat');
          await send(legacy, AgentStep.TODO_STATE, {
            agent_id: 'single-1',
            todos: [
              { id: 'sub-1', content: 'Create game', status: 'in_progress' },
            ],
          });
          complete();
          await send(legacy, AgentStep.TODO_STATE, {
            agent_id: 'single-1',
            todos: [
              { id: 'sub-1', content: 'Create game', status: 'completed' },
            ],
          });
          await send(legacy, AgentStep.DEACTIVATE_TOOLKIT, {
            agent_id: 'single-1',
            agent_name: 'single_agent',
            process_task_id: 'sub-1',
            toolkit_name: 'Terminal Toolkit',
            method_name: 'shell_exec',
            message: 'Game created',
          });
          const task = store.getState().tasks['live-run'];
          expect(task.taskRunning[0].toolkits).toHaveLength(1);
          expect(task.taskAssigning[0].tasks[0].toolkits).toHaveLength(1);
          expect(task.taskAssigning[0]).toMatchObject({
            status: 'completed',
            tasks: [
              {
                status: 'completed',
                toolkits: [
                  { toolkitStatus: 'completed', message: 'Game created' },
                ],
              },
            ],
          });
          expect(task.status).toBe(ChatTaskStatus.FINISHED);
          expect(task.taskTime).toBe(0);
        });

        it('does not navigate a browser preview from a delayed toolkit result', async () => {
          const { usePageTabStore } = await import('@/store/pageTabStore');
          const openPreview = vi
            .spyOn(usePageTabStore.getState(), 'openBrowserPreview')
            .mockImplementation(() => {});
          try {
            const { store, streamContaining } = await startObservedLiveTask();
            const legacy = streamContaining('/chat');
            seedWorkforce(store);
            await send(legacy, AgentStep.ACTIVATE_TOOLKIT, {
              agent_id: 'developer-1',
              process_task_id: 'sub-1',
              toolkit_name: 'Browser Toolkit',
              method_name: 'visit page',
              message: 'http://localhost:3000/',
              tool_call_id: 'preview-1',
            });
            complete();
            await send(legacy, AgentStep.DEACTIVATE_TOOLKIT, {
              agent_id: 'developer-1',
              process_task_id: 'sub-1',
              toolkit_name: 'Browser Toolkit',
              method_name: 'visit page',
              message: 'Navigation completed.',
              tool_call_id: 'preview-1',
            });
            expect(openPreview).not.toHaveBeenCalled();
            expect(
              store.getState().tasks['live-run'].taskAssigning[0].tasks[0]
                .toolkits?.[0].message
            ).toContain('Navigation completed.');
          } finally {
            openPreview.mockRestore();
          }
        });

        it.each(['END', 'closed transport', 'failed Run', 'old Run'] as const)(
          'rejects display dependency frames beyond the %s ownership boundary',
          async (boundary) => {
            const { store, streamContaining } = await startObservedLiveTask();
            const legacy = streamContaining('/chat');
            let runId = 'live-run';
            if (boundary === 'old Run') {
              await switchLegacyStreamToFollowUp({ store, streamContaining });
              runId = 'follow-up-run';
            }
            if (boundary === 'failed Run') {
              runEventIngressRegistry.ingest(
                'project-1',
                runId,
                canonicalEvent(runId, 'run.failed'),
                'live'
              );
            } else {
              complete(runId);
            }
            if (boundary === 'END')
              await send(legacy, AgentStep.END, { content: 'Done' });
            if (boundary === 'closed transport')
              closeSSEConnectionsForTasks([runId]);
            const snapshot = JSON.stringify(store.getState().tasks[runId]);
            await sendDisplayTail(
              legacy,
              boundary === 'old Run' ? 'live-run' : undefined
            );
            expect(JSON.stringify(store.getState().tasks[runId])).toBe(
              snapshot
            );
          }
        );

        it('retains the final task result and usage before END without restarting the clock', async () => {
          const { store, streamContaining } = await startObservedLiveTask();
          const legacy = streamContaining('/chat');
          seedWorkforce(store);
          complete();
          const elapsed = store.getState().tasks['live-run'].elapsed;

          await send(legacy, AgentStep.TASK_STATE, {
            task_id: 'sub-1',
            state: 'DONE',
            result: 'Game created',
          });
          await send(legacy, AgentStep.REQUEST_USAGE, {
            agent_id: 'developer-1',
            tokens: 125,
            step_total_tokens: 125,
          });
          expect(store.getState().tasks['live-run']).toMatchObject({
            status: ChatTaskStatus.FINISHED,
            durableRunStatus: 'completed',
            taskTime: 0,
            elapsed,
            tokens: 125,
            taskRunning: [{ id: 'sub-1', status: 'completed' }],
            taskAssigning: [
              {
                tasks: [
                  { id: 'sub-1', status: 'completed', report: 'Game created' },
                ],
              },
            ],
          });
          await send(legacy, AgentStep.END, { content: 'Done', tokens: 125 });
          expect(
            store.getState().tasks['live-run'].taskAssigning[0].tasks[0].report
          ).toBe('Game created');
          expect(store.getState().tasks['live-run'].tokens).toBe(125);
          expect(legacy.signal.aborted).toBe(false);
        });

        it('finishes the todo display but ignores execution and auto-confirm frames after completion', async () => {
          const { store, streamContaining } = await startObservedLiveTask();
          const legacy = streamContaining('/chat');
          await send(legacy, AgentStep.TODO_STATE, {
            agent_id: 'single-1',
            todos: [
              { id: 'todo-1', content: 'Make game', status: 'in_progress' },
              { id: 'todo-2', content: 'Optional work', status: 'in_progress' },
              { id: 'todo-3', content: 'Existing result', status: 'completed' },
            ],
          });
          complete();
          const elapsed = store.getState().tasks['live-run'].elapsed;
          await send(legacy, AgentStep.TODO_STATE, {
            agent_id: 'single-1',
            todos: [
              { id: 'todo-1', content: 'Make game', status: 'completed' },
              { id: 'todo-2', content: 'Optional work', status: 'in_progress' },
              { id: 'todo-3', content: 'Existing result', status: 'pending' },
              { id: 'late-todo', content: 'Late work', status: 'in_progress' },
            ],
          });
          await send(legacy, AgentStep.TO_SUB_TASKS, {
            sub_tasks: [{ id: 'unexpected-plan', content: 'Restart' }],
          });
          await send(legacy, AgentStep.ACTIVATE_AGENT, {
            agent_id: 'single-1',
            process_task_id: 'todo-1',
            state: 'RUNNING',
          });
          await send(legacy, AgentStep.ACTIVATE_TOOLKIT, {
            agent_id: 'single-1',
            process_task_id: 'todo-1',
            toolkit_name: 'Terminal Toolkit',
            method_name: 'shell_exec',
            message: 'Do not restart',
          });
          await send(legacy, AgentStep.DECOMPOSE_TEXT, {
            content: 'Do not restart planning',
          });
          await send(legacy, AgentStep.ASK, {
            agent: 'single-1',
            content: 'Do not resume user input',
          });
          await send(legacy, AgentStep.TASK_STATE, {
            task_id: 'todo-1',
            state: 'RUNNING',
          });
          expect(store.getState().tasks['live-run']).toMatchObject({
            status: ChatTaskStatus.FINISHED,
            durableRunStatus: 'completed',
            taskTime: 0,
            elapsed,
            autoConfirmDeadline: null,
            isPending: false,
            activeAsk: '',
            streamingDecomposeText: '',
            taskInfo: [
              { id: 'todo-1', status: 'completed' },
              { id: 'todo-2', status: 'skipped' },
              { id: 'todo-3', status: 'completed' },
              { id: 'late-todo', status: 'skipped' },
            ],
            taskRunning: [
              { id: 'todo-1', status: 'completed' },
              { id: 'todo-2', status: 'skipped' },
              { id: 'todo-3', status: 'completed' },
              { id: 'late-todo', status: 'skipped' },
            ],
          });
          expect(
            store
              .getState()
              .tasks['live-run'].messages.some(
                (message) => message.step === AgentStep.TO_SUB_TASKS
              )
          ).toBe(false);
          expect(
            store.getState().tasks['live-run'].taskAssigning[0].log
          ).toHaveLength(0);
        });

        it('closes the display-only tail at legacy END', async () => {
          const { store, streamContaining } = await startObservedLiveTask();
          const legacy = streamContaining('/chat');
          seedWorkforce(store);
          complete();
          await send(legacy, AgentStep.TASK_STATE, {
            task_id: 'sub-1',
            state: 'DONE',
            result: 'Final result',
          });
          await send(legacy, AgentStep.END, { content: 'Done', tokens: 100 });
          await send(legacy, AgentStep.TASK_STATE, {
            task_id: 'sub-1',
            state: 'FAILED',
            result: 'Late obsolete failure',
          });
          await send(legacy, AgentStep.REQUEST_USAGE, {
            agent_id: 'developer-1',
            tokens: 999,
          });
          await send(legacy, AgentStep.TODO_STATE, {
            todos: [{ id: 'obsolete', content: 'Late', status: 'in_progress' }],
          });
          expect(store.getState().tasks['live-run']).toMatchObject({
            tokens: 100,
            status: ChatTaskStatus.FINISHED,
            durableRunStatus: 'completed',
            taskRunning: [{ id: 'sub-1', status: 'completed' }],
            taskAssigning: [{ tasks: [{ report: 'Final result' }] }],
          });
        });

        it('accepts the current follow-up tail without applying explicitly old Run frames', async () => {
          const { store, streamContaining } = await startObservedLiveTask();
          const legacy = streamContaining('/chat');
          await switchLegacyStreamToFollowUp({ store, streamContaining });
          seedWorkforce(store, 'follow-up-run');
          complete('follow-up-run');
          await send(
            legacy,
            AgentStep.REQUEST_USAGE,
            { agent_id: 'developer-1', tokens: 999 },
            'live-run'
          );
          await send(
            legacy,
            AgentStep.TODO_STATE,
            {
              todos: [
                { id: 'obsolete', content: 'Late', status: 'in_progress' },
              ],
            },
            'live-run'
          );
          await send(
            legacy,
            AgentStep.TASK_STATE,
            { task_id: 'sub-1', state: 'DONE', result: 'Improved game' },
            'follow-up-run'
          );
          await send(
            legacy,
            AgentStep.REQUEST_USAGE,
            { agent_id: 'developer-1', tokens: 75 },
            'follow-up-run'
          );
          expect(store.getState().tasks['live-run'].tokens).toBe(0);
          expect(store.getState().tasks['follow-up-run']).toMatchObject({
            status: ChatTaskStatus.FINISHED,
            durableRunStatus: 'completed',
            tokens: 75,
            taskRunning: [{ id: 'sub-1', status: 'completed' }],
            taskAssigning: [{ tasks: [{ report: 'Improved game' }] }],
          });
        });

        it.each(['failed', 'cancelled', 'interrupted'] as const)(
          'does not accept a success tail for a %s Run',
          async (status) => {
            const { store, streamContaining } = await startObservedLiveTask();
            const legacy = streamContaining('/chat');
            seedWorkforce(store);
            runEventIngressRegistry.ingest(
              'project-1',
              'live-run',
              canonicalEvent('live-run', `run.${status}`),
              'live'
            );
            const snapshot = store.getState().tasks['live-run'];
            await send(legacy, AgentStep.TASK_STATE, {
              task_id: 'sub-1',
              state: 'DONE',
              result: 'Wrong success',
            });
            await send(legacy, AgentStep.REQUEST_USAGE, { tokens: 999 });
            await send(legacy, AgentStep.TODO_STATE, {
              todos: [
                {
                  id: 'unexpected',
                  content: 'Unexpected',
                  status: 'completed',
                },
              ],
            });
            expect(store.getState().tasks['live-run']).toEqual(snapshot);
          }
        );

        it('ignores a tail delivered by a transport closed before the final frames', async () => {
          const { store, streamContaining } = await startObservedLiveTask();
          const legacy = streamContaining('/chat');
          seedWorkforce(store);
          complete();
          closeSSEConnectionsForTasks(['live-run']);
          await send(legacy, AgentStep.TASK_STATE, {
            task_id: 'sub-1',
            state: 'DONE',
            result: 'Late closed result',
          });
          await send(legacy, AgentStep.REQUEST_USAGE, { tokens: 999 });
          expect(store.getState().tasks['live-run'].tokens).toBe(0);
          expect(
            store.getState().tasks['live-run'].taskAssigning[0].tasks[0].report
          ).toBeUndefined();
        });
      });

      it('marks a canonical-only completed Run idle while preserving its warm transport', async () => {
        const { store, streamContaining } = await startObservedLiveTask({
          initialRunId: 'canonical-completed-run',
        });
        const signal = streamContaining('/chat').signal as AbortSignal;

        runEventIngressRegistry.ingest(
          'project-1',
          'canonical-completed-run',
          canonicalEvent('canonical-completed-run', 'run.completed', 'Done'),
          'live'
        );

        expect(store.getState().tasks['canonical-completed-run']).toMatchObject(
          {
            status: ChatTaskStatus.FINISHED,
            durableRunStatus: 'completed',
            isPending: false,
          }
        );
        expect(hasActiveSSEConnection(['canonical-completed-run'])).toBe(false);
        expect(hasSSETransportForTasks(['canonical-completed-run'])).toBe(true);
        expect(getIdleSSETransportTaskId(['canonical-completed-run'])).toBe(
          'canonical-completed-run'
        );
        expect(hasAnyActiveLegacySSEConnection()).toBe(false);
        expect(signal.aborted).toBe(false);
        expect(runDomainEventHub.listenerCount()).toBe(0);
      });

      it.each(['stop', 'remove', 'close'] as const)(
        '%s on the follow-up Run aborts its shared legacy connection',
        async (action) => {
          const initialRunId = `${action}-initial-run`;
          const followUpRunId = `${action}-follow-up-run`;
          const { store, streamContaining } = await startObservedLiveTask({
            initialRunId,
          });
          const signal = await switchLegacyStreamToFollowUp({
            store,
            streamContaining,
            initialRunId,
            followUpRunId,
          });

          if (action === 'stop') {
            store.getState().stopTask(followUpRunId);
          } else if (action === 'remove') {
            store.getState().removeTask(followUpRunId);
          } else {
            closeSSEConnectionsForTasks([followUpRunId]);
          }

          expect(signal.aborted).toBe(true);
          expect(hasActiveSSEConnection([initialRunId])).toBe(false);
          expect(hasActiveSSEConnection([followUpRunId])).toBe(false);
          expect(hasAnyActiveLegacySSEConnection()).toBe(false);
          expect(runDomainEventHub.listenerCount()).toBe(0);
        }
      );

      it('settles from an existing terminal projection after subscribing', async () => {
        const { store, streamContaining } = await startObservedLiveTask({
          projectedStatus: 'failed',
        });

        expect(store.getState().tasks['live-run']).toMatchObject({
          status: ChatTaskStatus.FINISHED,
          durableRunStatus: 'failed',
          isPending: false,
        });
        expect(runDomainEventHub.listenerCount()).toBe(0);
        expect(streamContaining('/runs/live-run/stream')).toBeUndefined();
      });

      it('keeps the canonical observer after a fatal legacy error until terminal settlement', async () => {
        const first = await startObservedLiveTask({
          initialRunId: 'fatal-run',
        });
        await vi.waitFor(() =>
          expect(runDomainEventHub.listenerCount()).toBe(1)
        );
        expect(() =>
          first.streamContaining('/chat').onerror?.(new Error('fatal'))
        ).toThrow('fatal');
        expect(hasSSETransportForTasks(['fatal-run'])).toBe(false);
        expect(runDomainEventHub.listenerCount()).toBe(1);

        runEventIngressRegistry.ingest(
          'project-1',
          'fatal-run',
          canonicalEvent('fatal-run', 'run.failed'),
          'live'
        );
        expect(first.store.getState().tasks['fatal-run']).toMatchObject({
          status: ChatTaskStatus.FINISHED,
          durableRunStatus: 'failed',
        });
        expect(runDomainEventHub.listenerCount()).toBe(0);
      });

      it('keeps the canonical observer after legacy close until terminal settlement', async () => {
        const second = await startObservedLiveTask({
          initialRunId: 'closed-run',
        });
        await vi.waitFor(() =>
          expect(runDomainEventHub.listenerCount()).toBe(1)
        );
        second.streamContaining('/chat').onclose?.();
        expect(hasSSETransportForTasks(['closed-run'])).toBe(false);
        expect(runDomainEventHub.listenerCount()).toBe(1);

        runEventIngressRegistry.ingest(
          'project-1',
          'closed-run',
          canonicalEvent('closed-run', 'runtime.interrupted'),
          'live'
        );
        expect(second.store.getState().tasks['closed-run']).toMatchObject({
          status: ChatTaskStatus.FINISHED,
          durableRunStatus: 'interrupted',
        });
        expect(runDomainEventHub.listenerCount()).toBe(0);
      });

      it('releases listeners through explicit task close and clearTasks', async () => {
        const first = await startObservedLiveTask({
          initialRunId: 'explicit-close-run',
        });
        await vi.waitFor(() =>
          expect(runDomainEventHub.listenerCount()).toBe(1)
        );
        closeSSEConnectionsForTasks(['explicit-close-run']);
        expect(runDomainEventHub.listenerCount()).toBe(0);

        const second = await startObservedLiveTask({
          initialRunId: 'clear-run',
        });
        await vi.waitFor(() =>
          expect(runDomainEventHub.listenerCount()).toBe(1)
        );
        second.store.getState().clearTasks();
        expect(runDomainEventHub.listenerCount()).toBe(0);
        expect(
          first.store.getState().tasks['explicit-close-run']
        ).toBeDefined();
      });

      it('does not duplicate an error when legacy and canonical failures interleave', async () => {
        const { store, streamContaining } = await startObservedLiveTask();
        const message = 'Background preview did not stop.';

        await streamContaining('/chat').onmessage?.({
          data: JSON.stringify({
            step: AgentStep.ERROR,
            data: { message },
          }),
        });
        runEventIngressRegistry.ingest(
          'project-1',
          'live-run',
          canonicalEvent('live-run', 'run.failed', message),
          'live'
        );

        expect(
          store
            .getState()
            .tasks['live-run'].messages.filter((item) =>
              item.content.includes(message)
            )
        ).toHaveLength(1);
        expect(runDomainEventHub.listenerCount()).toBe(0);
      });

      it('does not duplicate an error when canonical failure arrives before legacy ERROR', async () => {
        const { store, streamContaining } = await startObservedLiveTask();
        const message = 'Background preview did not stop.';

        runEventIngressRegistry.ingest(
          'project-1',
          'live-run',
          canonicalEvent('live-run', 'run.failed', message),
          'live'
        );
        await streamContaining('/chat').onmessage?.({
          data: JSON.stringify({
            step: AgentStep.ERROR,
            data: { message },
          }),
        });

        const errors = store
          .getState()
          .tasks['live-run'].messages.filter(
            (item) => item.step === AgentStep.ERROR
          );
        expect(errors).toHaveLength(1);
        expect(errors[0].content).toContain(message);
        expect(fetchDelete).not.toHaveBeenCalled();
        expect(runDomainEventHub.listenerCount()).toBe(0);
      });

      describe('canonical failure error context', () => {
        let originalAuthState: ReturnType<typeof getAuthStore>;
        let originalAuthImplementation = vi
          .mocked(getAuthStore)
          .getMockImplementation();
        let errorToast: ReturnType<typeof vi.spyOn>;

        beforeEach(() => {
          originalAuthImplementation = vi
            .mocked(getAuthStore)
            .getMockImplementation();
          originalAuthState = getAuthStore();
          vi.mocked(getAuthStore).mockReturnValue({
            ...originalAuthState,
            user_id: 'account-a',
          });
          setUsageAccount('account-a');
          useUsageNoticeStore.setState({ modelType: 'cloud' });
          errorToast = vi.spyOn(toast, 'error').mockReturnValue('usage-toast');
        });

        afterEach(() => {
          if (originalAuthImplementation)
            vi.mocked(getAuthStore).mockImplementation(
              originalAuthImplementation
            );
          setUsageAccount(null);
          errorToast.mockRestore();
        });

        const quotaMessage = 'Error code: 429 insufficient_quota';
        const errorCards = (
          store: ReturnType<typeof createChatStoreInstance>,
          runId = 'live-run'
        ) =>
          store
            .getState()
            .tasks[runId].messages.filter(
              (message) => message.step === AgentStep.ERROR
            );

        it('classifies canonical cloud quota once with its request model and execution', async () => {
          const { store, streamContaining } = await startObservedLiveTask({
            executionId: 'quota-execution',
          });
          runEventIngressRegistry.ingest(
            'project-1',
            'live-run',
            canonicalEvent('live-run', 'run.failed', quotaMessage),
            'live'
          );
          await streamContaining('/chat').onmessage?.({
            data: JSON.stringify({
              step: AgentStep.ERROR,
              data: { message: quotaMessage },
            }),
          });

          expect(errorCards(store)).toHaveLength(1);
          expect(errorCards(store)[0].errorReason).toBe('service');
          expect(useUsageNoticeStore.getState().incidents).toEqual([
            {
              reason: 'service',
              modelId: 'gpt-5.4',
              executionIds: ['quota-execution'],
            },
          ]);
          expect(errorToast).toHaveBeenCalledTimes(1);
          expect(proxyUpdateTriggerExecution).toHaveBeenCalledTimes(1);
          expect(fetchDelete).not.toHaveBeenCalled();
        });

        it('enriches a projected failure without resettling it or duplicating the receipt', async () => {
          const { store, streamContaining } = await startObservedLiveTask({
            executionId: 'projected-failure-execution',
          });
          runProjectionStore.upsertRunSummaries('project-1', [
            {
              run_id: 'live-run',
              project_id: 'project-1',
              status: 'failed',
              version: 1,
              latest_attempt: { attempt_number: 1, status: 'failed' },
              updated_at: Date.now(),
            },
          ]);
          await vi.waitFor(() =>
            expect(store.getState().tasks['live-run'].status).toBe(
              ChatTaskStatus.FINISHED
            )
          );
          expect(errorCards(store)[0].errorReason).toBe('task');
          expect(useUsageNoticeStore.getState().incidents).toEqual([]);
          const { elapsed, taskTime } = store.getState().tasks['live-run'];
          const originalErrorId = errorCards(store)[0].id;

          for (let index = 0; index < 2; index++) {
            await streamContaining('/chat').onmessage?.({
              data: JSON.stringify({
                step: AgentStep.ERROR,
                data: { message: quotaMessage },
              }),
            });
          }

          expect(errorCards(store)).toHaveLength(1);
          expect(errorCards(store)[0]).toMatchObject({
            id: originalErrorId,
            errorReason: 'service',
          });
          expect(errorCards(store)[0].content).toContain(quotaMessage);
          expect(store.getState().tasks['live-run']).toMatchObject({
            status: ChatTaskStatus.FINISHED,
            durableRunStatus: 'failed',
            elapsed,
            taskTime,
          });
          expect(errorToast).toHaveBeenCalledTimes(1);
          expect(proxyUpdateTriggerExecution).toHaveBeenCalledTimes(1);
          expect(fetchDelete).not.toHaveBeenCalled();
        });

        it('keeps specific canonical failure details when a generic legacy error arrives', async () => {
          const { store, streamContaining } = await startObservedLiveTask();
          runEventIngressRegistry.ingest(
            'project-1',
            'live-run',
            canonicalEvent('live-run', 'run.failed', quotaMessage),
            'live'
          );
          const originalError = errorCards(store)[0];
          await streamContaining('/chat').onmessage?.({
            data: JSON.stringify({
              step: AgentStep.ERROR,
              data: { message: 'Task failed' },
            }),
          });
          expect(errorCards(store)).toEqual([originalError]);
          expect(errorToast).toHaveBeenCalledTimes(1);
        });

        it('associates a follow-up failure with the current execution', async () => {
          const { store, streamContaining } = await startObservedLiveTask({
            executionId: 'initial-execution',
          });
          await switchLegacyStreamToFollowUp({ store, streamContaining });
          store
            .getState()
            .setExecutionId('follow-up-run', 'follow-up-execution');
          runEventIngressRegistry.ingest(
            'project-1',
            'follow-up-run',
            canonicalEvent('follow-up-run', 'run.failed', quotaMessage),
            'live'
          );
          expect(errorCards(store, 'follow-up-run')[0].errorReason).toBe(
            'service'
          );
          expect(
            useUsageNoticeStore.getState().incidents[0].executionIds
          ).toEqual(['follow-up-execution']);
          expect(errorToast).toHaveBeenCalledTimes(1);
        });

        it.each(['canonical', 'legacy enrichment'])(
          'does not attach an old request incident to a new account during %s',
          async (source) => {
            const { store, streamContaining } = await startObservedLiveTask();
            setUsageAccount('account-b');
            runEventIngressRegistry.ingest(
              'project-1',
              'live-run',
              canonicalEvent(
                'live-run',
                'run.failed',
                source === 'canonical' ? quotaMessage : ''
              ),
              'live'
            );
            if (source === 'legacy enrichment') {
              await streamContaining('/chat').onmessage?.({
                data: JSON.stringify({
                  step: AgentStep.ERROR,
                  data: { message: quotaMessage },
                }),
              });
            }
            expect(errorCards(store)[0].errorReason).toBe('service');
            expect(useUsageNoticeStore.getState().account).toBe('account-b');
            expect(useUsageNoticeStore.getState().incidents).toEqual([]);
            expect(errorToast).not.toHaveBeenCalled();
          }
        );
      });
    });

  });

  describe.each([false, true])('Task startup: %s', (awaitAdmission) => {
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
            'single' as any,
            { awaitAdmission }
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
        if (awaitAdmission) {
          await expect(startPromise).rejects.toThrow(/backend|Backend/);
        } else {
          await startPromise;
        }
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
            code: 1,
            text: 'The saved Project frontier has no unfinished next action.',
            error_code: 'continuation_clarification_required',
          }),
          {
            status: 200,
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
        const startPromise = result.current
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
            'single' as any,
            { awaitAdmission }
          );
        if (awaitAdmission) {
          await expect(startPromise).rejects.toMatchObject({
            code: 'continuation_clarification_required',
          });
        } else {
          await startPromise;
        }
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

    it('keeps completed legacy history terminal in the event timeline', async () => {
      vi.stubEnv('VITE_CHATBOX_EVENT_BUS', 'true');
      releaseProjectEventStore('proj-replay');
      const eventStore = getProjectEventStore('proj-replay', {
        scheduleFlush: () => () => {},
      });
      const startedAt = Date.parse('2026-08-18T00:00:00Z') / 1000;
      const taskId = 'legacy-completed-history';
      vi.mocked(fetchEventSource).mockImplementation(async (_url, opts) => {
        for (const [index, event] of [
          {
            step: 'confirmed',
            data: { task_id: taskId, question: 'Build a report' },
            timestamp: startedAt,
          },
          {
            step: 'todo_state',
            data: { agent_id: 'single-agent', todos: [] },
            timestamp: startedAt + 1,
          },
          {
            step: 'end',
            data: { result: 'Report complete' },
            timestamp: startedAt + 600,
          },
        ].entries()) {
          await opts.onmessage?.({
            data: JSON.stringify({ id: index + 1, task_id: taskId, ...event }),
          } as any);
        }
        opts.onclose?.();
      });

      try {
        const { result } = renderHook(() => useChatStore());
        await act(async () => {
          await result.current.getState().replay(taskId, 'Build a report', 0);
        });
        const task = result.current.getState().tasks[taskId];
        expect(task.status).toBe(ChatTaskStatus.FINISHED);
        expect(task.elapsed).toBe(600_000);

        eventStore.flushAll();
        const snapshot = eventStore.getSnapshot();
        const runs = reconcileTimelineRuns(
          composeTimelineRuns(selectRenderableChatNodes(snapshot.chat)),
          snapshot.view.runs
        );
        expect(runs).toHaveLength(1);
        expect(runs[0].status).toBe('completed');
        expect(runs[0].userQuery?.content).toBe('Build a report');
        expect(runs[0].finalAssistantResponse?.content).toBe('Report complete');
        expect(runs[0].timestamps.durationMs).toBe(600_000);
        expect(runs[0].timestamps.elapsedAnchor?.anchoredAt).toBeNull();
      } finally {
        vi.unstubAllEnvs();
        releaseProjectEventStore('proj-replay');
      }
    });

    it('freezes failed legacy replay at the persisted error time without an end event', async () => {
      const taskId = 'legacy-failed-history';
      const startedAt = Date.parse('2026-08-18T00:00:00Z') / 1000;
      vi.mocked(fetchEventSource).mockImplementation(async (_url, opts) => {
        for (const [index, event] of [
          {
            step: 'confirmed',
            data: { task_id: taskId, question: 'Build a report' },
            timestamp: startedAt,
          },
          {
            step: 'error',
            data: {
              message:
                "tool 'shell_exec' may have produced an external side effect",
              retryable: false,
            },
            timestamp: startedAt + 600,
          },
          {
            step: 'deactivate_agent',
            data: { agent_id: 'single-agent', tokens: 0 },
            timestamp: startedAt + 610,
          },
        ].entries()) {
          await opts.onmessage?.({
            data: JSON.stringify({
              id: 26_870 + index,
              task_id: taskId,
              ...event,
            }),
          } as any);
        }
        opts.onclose?.();
      });

      try {
        const { result } = renderHook(() => useChatStore());
        await act(async () => {
          await result.current.getState().replay(taskId, 'Build a report', 0);
        });
        expect(result.current.getState().tasks[taskId]).toMatchObject({
          status: ChatTaskStatus.FINISHED,
          durableRunStatus: 'failed',
          elapsed: 600_000,
          taskTime: 0,
        });
      } finally {
        releaseProjectEventStore('proj-replay');
      }
    });

    it.each([undefined, 'normal'] as const)(
      'settles a live error from its active clock (type=%s)',
      async (type) => {
        const taskId = 'live-failed-task';
        const now = Date.parse('2026-09-16T00:00:00Z');
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);
        const { result } = renderHook(() => useChatStore());
        vi.mocked(useProjectStore.getState).mockReturnValue({
          ...replayProjectState(),
          appendInitChatStore: () => {
            result.current.getState().create(taskId);
            return { taskId, chatStore: result.current };
          },
          getAllChatStores: () => [],
          getProjectModel: () => null,
          setProjectModel: vi.fn(),
          setProjectSpace: vi.fn(),
          setHistoryId: vi.fn(),
          getProjectThinkingEffortOverride: () => undefined,
        } as any);
        vi.mocked(proxyFetchGet).mockImplementation((url: string) =>
          Promise.resolve(
            url.includes('snapshots')
              ? []
              : {
                  value: 'test-cloud-key',
                  api_url: 'https://models.example.test',
                  items: [],
                  warning_code: null,
                }
          )
        );
        vi.mocked(fetchEventSource).mockImplementation(async (_url, opts) => {
          await opts.onmessage?.({
            data: JSON.stringify({
              step: 'confirmed',
              data: { task_id: taskId, question: 'Build a report' },
              timestamp: 100,
            }),
          } as any);
          result.current.getState().setTaskTime(taskId, now - 5_000);
          result.current.getState().setElapsed(taskId, 2_000);
          await opts.onmessage?.({
            data: JSON.stringify({
              step: 'error',
              data: { message: 'Live execution failed', retryable: false },
              timestamp: 700,
            }),
          } as any);
          opts.onclose?.();
        });

        try {
          await act(async () => {
            await result.current
              .getState()
              .startTask(
                taskId,
                type,
                undefined,
                undefined,
                'Build a report',
                [],
                undefined,
                'proj-replay'
              );
          });
          await vi.waitFor(() => {
            expect(result.current.getState().tasks[taskId]).toMatchObject({
              status: ChatTaskStatus.FINISHED,
              durableRunStatus: 'failed',
              elapsed: 7_000,
              taskTime: 0,
            });
          });
        } finally {
          nowSpy.mockRestore();
          releaseProjectEventStore('proj-replay');
        }
      }
    );

    it('keeps one narration and file receipt after partial canonical replay falls back to cloud', async () => {
      vi.stubEnv('VITE_CHATBOX_EVENT_BUS', 'true');
      releaseProjectEventStore('proj-replay');
      const eventStore = getProjectEventStore('proj-replay', {
        scheduleFlush: () => () => {},
      });
      const startedAt = Date.parse('2026-08-18T00:00:00Z') / 1000;
      const taskId = 'partial-canonical-history';
      const narration = 'Building the cathedral.';
      const tailNarration = 'Finishing the stained glass.';
      const filePath = 'models/cathedral.glb';
      const tailFilePath = 'models/stained-glass.glb';
      const canonicalEvents = [
        {
          event_id: 'canonical-narration',
          event_type: 'activity.progress',
          legacy_step: 'decompose_text',
          // Exact display-safe producer shape from semantic_events.py.
          payload: {
            semantic_schema_version: 1,
            display_schema_version: 1,
            semantic: {
              kind: 'narration',
              subject: {
                type: 'activity_stream',
                id: `${taskId}:narration`,
              },
              lifecycle: { phase: 'progress', status: 'running' },
              completeness: { state: 'complete', missing_fields: [] },
              provenance: { source: 'legacy.decompose_text' },
              actor: { type: 'agent' },
              correlation: { run_id: taskId },
            },
            status: 'running',
            display_title: narration,
            display_fragment_exact: true,
          },
        },
        {
          event_id: 'canonical-file',
          event_type: 'file.written',
          legacy_step: 'write_file',
          payload: {
            semantic_schema_version: 1,
            display_schema_version: 1,
            semantic: {
              kind: 'file_change',
              subject: { type: 'file', id: filePath },
              lifecycle: { phase: 'completed', status: 'completed' },
              completeness: { state: 'complete', missing_fields: [] },
              provenance: { source: 'legacy.write_file' },
              correlation: { task_id: 'subtask-1' },
            },
            relative_path: filePath,
            name: 'cathedral.glb',
            process_task_id: 'subtask-1',
            operation: 'written',
            display_title: `Wrote ${filePath}`,
          },
        },
      ];
      vi.mocked(fetchEventSource).mockImplementation(async (url, opts) => {
        if (String(url).includes(`/runs/${taskId}/stream`)) {
          for (const [index, event] of canonicalEvents.entries()) {
            await opts.onmessage?.({
              id: event.event_id,
              data: JSON.stringify({
                project_id: 'proj-replay',
                run_id: taskId,
                sequence: index + 1,
                run_version: index + 1,
                created_at: startedAt + index + 1,
                ...event,
              }),
            } as any);
          }
          const failure = new Error('Synthetic partial replay failure');
          opts.onerror?.(failure);
          throw failure;
        }

        for (const [index, event] of [
          {
            step: 'confirmed',
            data: { task_id: taskId, question: 'Build a cathedral' },
            timestamp: startedAt,
          },
          {
            step: 'decompose_text',
            data: { content: narration },
            timestamp: startedAt + 1,
          },
          {
            step: 'write_file',
            data: {
              file_path: `/workspace/${filePath}`,
              relative_path: filePath,
              process_task_id: 'subtask-1',
            },
            timestamp: startedAt + 2,
          },
          {
            step: 'decompose_text',
            data: { content: tailNarration },
            timestamp: startedAt + 3,
          },
          {
            step: 'write_file',
            data: {
              file_path: `/workspace/${tailFilePath}`,
              relative_path: tailFilePath,
              process_task_id: 'subtask-2',
            },
            timestamp: startedAt + 4,
          },
          {
            step: 'end',
            data: { result: 'Cathedral complete' },
            timestamp: startedAt + 600,
          },
        ].entries()) {
          await opts.onmessage?.({
            data: JSON.stringify({
              id: 10_000 + index,
              task_id: taskId,
              ...event,
            }),
          } as any);
        }
        opts.onclose?.();
      });

      try {
        const { result } = renderHook(() => useChatStore());
        await act(async () => {
          await result.current
            .getState()
            .replay(
              taskId,
              'Build a cathedral',
              0,
              'proj-replay',
              'local_durable'
            );
        });
        expect(fetchEventSource).toHaveBeenCalledTimes(2);
        expect(vi.mocked(fetchEventSource).mock.calls[1][0]).toContain(
          `/chat/steps/playback/${taskId}`
        );
        expect(result.current.getState().tasks[taskId]).toMatchObject({
          status: ChatTaskStatus.FINISHED,
          elapsed: 600_000,
        });

        eventStore.flushAll();
        const snapshot = eventStore.getSnapshot();
        const runs = composeTimelineRuns(
          presentChatSemanticEntities(selectRenderableChatNodes(snapshot.chat))
        );
        expect(runs).toHaveLength(1);
        const run = runs[0];
        expect(run.userQuery?.content).toBe('Build a cathedral');
        expect(run.finalAssistantResponse?.content).toBe('Cathedral complete');
        expect(
          run.nodes
            .filter((node) => node.kind === 'activity')
            .map((node) => node.title)
        ).toEqual([narration, tailNarration]);
        expect(run.artifacts.map((artifact) => artifact.relativePath)).toEqual([
          filePath,
          tailFilePath,
        ]);
        expect(run.summary.artifactCount).toBe(2);
        expect(
          run.nodes.some((node) => node.eventId === 'canonical-narration')
        ).toBe(true);
        expect(
          run.nodes.some((node) => node.eventId === 'canonical-file')
        ).toBe(true);
      } finally {
        vi.unstubAllEnvs();
        releaseProjectEventStore('proj-replay');
      }
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
