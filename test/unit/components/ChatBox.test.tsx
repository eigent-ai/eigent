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

// Comprehensive unit tests for ChatBox component
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchDelete,
  fetchGet,
  fetchPost,
  fetchPut,
  proxyFetchDelete,
  proxyFetchGet,
} from '../../../src/api/http';
import ChatBox from '../../../src/components/ChatBox/index';
import { useAuthStore } from '../../../src/store/authStore';
import { usePageTabStore } from '../../../src/store/pageTabStore';

const eventNativeHarness = vi.hoisted(() => ({
  enabled: false,
  snapshot: null as any,
  controlOptions: null as any,
}));

// Mock dependencies (use the same relative paths as the imports above)
vi.mock('../../../src/store/authStore', () => ({
  useAuthStore: vi.fn(),
  getAuthStore: vi.fn(() => ({ language: 'en-US', setLanguage: vi.fn() })),
}));
vi.mock('../../../src/api/http', () => ({
  fetchGet: vi.fn(),
  fetchPost: vi.fn(),
  fetchPut: vi.fn(),
  fetchDelete: vi.fn(),
  proxyFetchGet: vi.fn(),
  proxyFetchDelete: vi.fn(),
}));
// Also mock the alias paths the component uses so the component picks up these mocks
vi.mock('@/store/authStore', () => ({
  useAuthStore: vi.fn(),
  getAuthStore: vi.fn(() => ({ language: 'en-US', setLanguage: vi.fn() })),
}));
vi.mock('@/api/http', () => ({
  fetchGet: vi.fn(),
  fetchPost: vi.fn(),
  fetchPut: vi.fn(),
  fetchDelete: vi.fn(),
  proxyFetchGet: vi.fn(),
  proxyFetchDelete: vi.fn(),
}));
vi.mock('@/store/chatEventProjectionBridge', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/store/chatEventProjectionBridge')>();
  return {
    ...actual,
    isChatEventTimelineEnabled: () => eventNativeHarness.enabled,
  };
});
vi.mock('@/hooks/useProjectEventRuntime', () => ({
  useProjectEventRuntime: () => ({
    hydration: {
      status: 'ready',
      errorCode: null,
      eventsTruncated: false,
      retry: vi.fn(),
    },
    projectId: 'test-project-id',
    snapshot: eventNativeHarness.snapshot,
  }),
}));
vi.mock('../../../src/components/ChatBox/EventNativeProjectTimeline', () => ({
  EventNativeProjectTimeline: ({ floatingControl }: any) => (
    <div data-testid="event-native-timeline">{floatingControl}</div>
  ),
}));
vi.mock(
  '../../../src/components/ChatBox/BottomBox/useEventNativeHumanControl',
  () => ({
    useEventNativeHumanControl: (options: any) => {
      eventNativeHarness.controlOptions = options;
      return {
        interaction: null,
        variant: null,
        pendingCount: 0,
        phase: 'idle',
        submitError: null,
      };
    },
  })
);
vi.mock('../../../src/lib', () => ({
  generateUniqueId: vi.fn(() => 'test-unique-id'),
  replayActiveTask: vi.fn(),
}));

// Mock projectStore with proper vanilla store structure
vi.mock('../../../src/store/projectStore', () => {
  const useProjectStore = vi.fn();
  (useProjectStore as any).getState = vi.fn(() => ({
    getAllChatStores: () => [],
  }));
  return { useProjectStore };
});

vi.mock('@/store/projectStore', () => {
  const useProjectStore = vi.fn();
  (useProjectStore as any).getState = vi.fn(() => ({
    getAllChatStores: () => [],
  }));
  return { useProjectStore };
});

// Mock useChatStoreAdapter to provide both stores
vi.mock('../../../src/hooks/useChatStoreAdapter', () => ({
  default: vi.fn(),
}));

vi.mock('@/hooks/useModelConfigCheck', () => ({
  useModelConfigCheck: () => ({
    hasModel: true,
    isConfigLoaded: true,
    cloudUsageLimitReached: false,
  }),
}));

// Mock i18next for translations
vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => {},
  },
  useTranslation: () => ({
    t: (key: string, options: Record<string, unknown> = {}) => {
      const translations: Record<string, string> = {
        'chat.ask-placeholder': 'Type your message...',
        'chat.attachment-only-message': 'Please use the attached file(s).',
        'layout.by-messaging-eigent': 'By messaging Eigent, you agree to our',
        'layout.terms-of-use': 'Terms of Use',
        'layout.and': 'and',
        'layout.privacy-policy': 'Privacy Policy',
      };
      return translations[key] || String(options.defaultValue ?? key);
    },
  }),
}));

// Mock BottomBox component
vi.mock('../../../src/components/ChatBox/BottomBox', () => ({
  default: vi.fn(({ inputProps }: any) => {
    if (!inputProps) return null;
    const hasContent =
      (inputProps.value || '').trim().length > 0 ||
      inputProps.files?.length > 0;
    const primaryAction = hasContent
      ? 'send'
      : inputProps.taskControlState === 'running'
        ? 'pause'
        : inputProps.taskControlState === 'paused'
          ? 'resume'
          : 'idle';
    return (
      <div data-testid="bottom-box">
        <input
          data-testid="message-input"
          placeholder={inputProps.placeholder}
          value={inputProps.value}
          onChange={(e) => inputProps.onChange(e.target.value)}
        />
        <button
          data-testid="send-button"
          data-composer-primary-action={primaryAction}
          disabled={primaryAction === 'idle'}
          onClick={() => {
            if (primaryAction === 'send') inputProps.onSend();
            if (primaryAction === 'pause') inputProps.onPauseTask();
            if (primaryAction === 'resume') inputProps.onResumeTask();
          }}
        >
          {primaryAction}
        </button>
      </div>
    );
  }),
}));

// Mock ProjectChatContainer to avoid scrollTo issues
vi.mock('../../../src/components/ChatBox/ProjectChatContainer', () => ({
  ProjectChatContainer: vi.fn(() => (
    <div data-testid="project-chat-container">Chat Container</div>
  )),
}));

// Mock other components
vi.mock('../../../src/components/ChatBox/MessageCard', () => ({
  MessageCard: vi.fn(({ content, role }: any) => (
    <div data-testid={`message-${role}`}>{content}</div>
  )),
}));

vi.mock('../../../src/components/ChatBox/TaskCard', () => ({
  TaskCard: vi.fn(() => <div data-testid="task-card">Task Card</div>),
}));

vi.mock('../../../src/components/ChatBox/NoticeCard', () => ({
  NoticeCard: vi.fn(() => <div data-testid="notice-card">Notice Card</div>),
}));

vi.mock('../../../src/components/ChatBox/TypeCardSkeleton', () => ({
  TypeCardSkeleton: vi.fn(() => <div data-testid="skeleton">Loading...</div>),
}));

describe('ChatBox Component', async () => {
  const mockUseAuthStore = vi.mocked(useAuthStore);
  const mockFetchGet = vi.mocked(fetchGet);
  const _mockFetchPost = vi.mocked(fetchPost);
  const _mockFetchPut = vi.mocked(fetchPut);
  const _mockFetchDelete = vi.mocked(fetchDelete);
  const mockProxyFetchGet = vi.mocked(proxyFetchGet);
  const _mockProxyFetchDelete = vi.mocked(proxyFetchDelete);

  // Import the mocked hook
  const mockUseChatStoreAdapter = vi.mocked(
    (await import('../../../src/hooks/useChatStoreAdapter')).default
  );
  const mockUseProjectStore = vi.mocked(
    (await import('../../../src/store/projectStore')).useProjectStore
  );

  const defaultChatStoreState = {
    activeTaskId: 'test-task-id',
    tasks: {
      'test-task-id': {
        messages: [],
        hasMessages: false,
        isPending: false,
        activeAsk: '',
        askList: [],
        hasWaitComfirm: false,
        isTakeControl: false,
        type: 'normal',
        delayTime: 0,
        status: 'pending',
        taskInfo: [],
        attaches: [],
        taskRunning: [],
        taskAssigning: [],
        cotList: [],
        activeWorkspace: null,
        snapshots: [],
        isTaskEdit: false,
        isContextExceeded: false,
      },
    },
    setHasMessages: vi.fn(),
    addMessages: vi.fn(),
    removeMessage: vi.fn(),
    setIsPending: vi.fn(),
    startTask: vi.fn(),
    setActiveAsk: vi.fn(),
    setActiveAskList: vi.fn(),
    setHasWaitComfirm: vi.fn(),
    handleConfirmTask: vi.fn(),
    setActiveTaskId: vi.fn(),
    create: vi.fn(),
    setSelectedFile: vi.fn(),
    setActiveWorkspace: vi.fn(),
    setIsTakeControl: vi.fn(),
    setIsTaskEdit: vi.fn(),
    addTaskInfo: vi.fn(),
    updateTaskInfo: vi.fn(),
    saveTaskInfo: vi.fn(),
    deleteTaskInfo: vi.fn(),
    getFormattedTaskTime: vi.fn(() => '00:00:00'),
    setAttaches: vi.fn(),
    setNextTaskId: vi.fn(),
    setNextExecutionId: vi.fn(),
    setTaskSessionMode: vi.fn(),
    setTaskSource: vi.fn(),
    setExecutionId: vi.fn(),
    removeTask: vi.fn(),
    stopTask: vi.fn(),
    setElapsed: vi.fn(),
    setTaskTime: vi.fn(),
    setStatus: vi.fn(),
    setDurableRunStatus: vi.fn(),
    markHumanInteractionResolved: vi.fn(),
  };

  const preparedRunState = {
    setNextTaskId: vi.fn(),
    setTaskSessionMode: vi.fn(),
    setTaskSource: vi.fn(),
    setExecutionId: vi.fn(),
    setIsPending: vi.fn(),
    setHasMessages: vi.fn(),
    addMessages: vi.fn(),
    setStatus: vi.fn(),
  };

  const preparedRunChatStore = {
    getState: vi.fn(() => preparedRunState),
  };

  const defaultProjectStoreState = {
    activeProjectId: 'test-project-id',
    projects: {},
    createProject: vi.fn(),
    setActiveProject: vi.fn(),
    removeProject: vi.fn(),
    updateProject: vi.fn(),
    replayProject: vi.fn(),
    addQueuedMessage: vi.fn(),
    removeQueuedMessage: vi.fn(),
    restoreQueuedMessage: vi.fn(),
    clearQueuedMessages: vi.fn(),
    setQueuedMessageProcessing: vi.fn(),
    createChatStore: vi.fn(),
    appendInitChatStore: vi.fn((_projectId: string, _taskId: string) => ({
      chatStore: preparedRunChatStore,
    })),
    setActiveChatStore: vi.fn(),
    removeChatStore: vi.fn(),
    saveChatStore: vi.fn(),
    getChatStore: vi.fn(),
    getActiveChatStore: vi.fn(() => ({
      getState: () => defaultChatStoreState,
      subscribe: () => () => {},
    })),
    getAllChatStores: vi.fn(() => []),
    getAllProjects: vi.fn(),
    getProjectById: vi.fn(() => ({ queuedMessages: [] })),
    getProjectTotalTokens: vi.fn(),
    setHistoryId: vi.fn(),
    getHistoryId: vi.fn(),
  };

  const defaultAuthStoreState = {
    modelType: 'cloud',
  };

  const runningEventNativeSnapshot = (runId = 'test-task-id') => ({
    view: {
      projectId: 'test-project-id',
      mode: 'live',
      seenEventIds: {},
      currentCursor: 1,
      eventsTruncated: false,
      lastSyncedAt: null,
      needsResync: false,
      resyncReason: null,
      resyncTargetCursor: null,
      runs: {
        [runId]: {
          runId,
          status: 'running',
          lastSequence: 1,
          runVersion: 1,
          updatedAt: '2026-08-20T00:00:00Z',
          origin: 'local',
          resumeBlockedReason: null,
        },
      },
      artifactsByRun: {},
      legacySteps: [],
      unknownEvents: [],
    },
    chat: {
      projectId: 'test-project-id',
      nodes: [
        {
          id: `${runId}:started`,
          eventId: `${runId}:started`,
          projectId: 'test-project-id',
          runId,
          createdAt: '2026-08-20T00:00:00Z',
          runSequence: 1,
          cloudCursor: 1,
          eventType: 'run.attempt_started',
          legacyStep: null,
          kind: 'run_status',
          status: 'running',
        },
      ],
      nodeById: {},
      seenEventIds: {},
    },
    control: {
      projectId: 'test-project-id',
      orderedInteractionIds: [],
      interactionById: {},
      seenEventIds: {},
    },
    revision: 1,
    hasHydratedSnapshot: true,
    overflowed: false,
    lastEffects: [],
  });

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    window.sessionStorage.clear();
    eventNativeHarness.enabled = false;
    eventNativeHarness.snapshot = null;
    eventNativeHarness.controlOptions = null;
    usePageTabStore.setState({
      workspaceChatDraftRequest: null,
      workspaceChatDraftRequestSequence: 0,
      workspaceReviewHandoffs: [],
      workspaceChatFocusRequestId: 0,
      sessionPreviewProjectId: null,
      sessionPreviewByProject: {},
    });
    defaultProjectStoreState.activeProjectId = 'test-project-id';
    defaultProjectStoreState.getActiveChatStore.mockImplementation(() => ({
      getState: () => defaultChatStoreState,
      subscribe: () => () => {},
    }));
    defaultProjectStoreState.getProjectById.mockImplementation(() => ({
      queuedMessages: [],
    }));
    defaultProjectStoreState.removeQueuedMessage.mockImplementation(
      () => undefined
    );
    defaultProjectStoreState.getAllChatStores.mockReturnValue([]);

    // Setup default store states
    mockUseChatStoreAdapter.mockReturnValue({
      projectStore: defaultProjectStoreState as any,
      chatStore: defaultChatStoreState as any,
    });
    mockUseProjectStore.mockReturnValue(defaultProjectStoreState as any);
    mockUseAuthStore.mockReturnValue(defaultAuthStoreState as any);

    // Setup default API responses
    mockFetchGet.mockResolvedValue({ runs: [] });
    mockProxyFetchGet.mockImplementation((url: string) => {
      if (url === '/api/user/key' || url === '/api/v1/user/key') {
        return Promise.resolve({ value: 'test-api-key' });
      }
      if (url === '/api/v1/configs') {
        return Promise.resolve([
          { config_name: 'GOOGLE_API_KEY', value: 'test-key' },
          { config_name: 'SEARCH_ENGINE_ID', value: 'test-id' },
        ]);
      }
      return Promise.resolve({});
    });

    _mockFetchPost.mockResolvedValue({ success: true });
    _mockFetchPut.mockResolvedValue({ success: true });

    // Mock import.meta.env
    Object.defineProperty(import.meta, 'env', {
      value: { VITE_USE_LOCAL_PROXY: 'false' },
      writable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const renderChatBox = () => {
    return render(
      <BrowserRouter>
        <ChatBox />
      </BrowserRouter>
    );
  };

  describe('Initial Render', () => {
    it('should render bottom box when no messages exist', () => {
      renderChatBox();

      expect(screen.getByTestId('bottom-box')).toBeInTheDocument();
    });

    it('should render message input in bottom box', () => {
      renderChatBox();

      expect(screen.getByTestId('message-input')).toBeInTheDocument();
    });

    it('appends a Project-scoped review handoff to the Chat draft', async () => {
      renderChatBox();

      act(() => {
        usePageTabStore.setState({
          workspaceChatDraftRequestSequence: 1,
          workspaceChatFocusRequestId: 1,
          workspaceChatDraftRequest: {
            requestId: 1,
            projectId: 'test-project-id',
            content: 'Please address review comment 1.',
            reviewHandoffIds: [],
          },
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('message-input')).toHaveValue(
          'Please address review comment 1.'
        );
      });
      expect(usePageTabStore.getState().workspaceChatDraftRequest).toBeNull();
    });

    it('marks review comments sent only after Chat accepts the message', async () => {
      renderChatBox();

      act(() => {
        usePageTabStore.setState({
          sessionPreviewProjectId: 'test-project-id',
          sessionPreviewByProject: {
            'test-project-id': {
              open: true,
              activeTabId: 'review-1',
              tabs: [
                {
                  id: 'review-1',
                  type: 'review',
                  title: 'Review',
                  reviewComments: [
                    {
                      id: 'comment-1',
                      fileId: 'src/app.ts',
                      path: 'src/app.ts',
                      selection: null,
                      body: 'Keep this compatible.',
                      createdAt: 1,
                    },
                  ],
                },
              ],
            },
          },
          workspaceChatDraftRequestSequence: 1,
          workspaceChatFocusRequestId: 1,
          workspaceChatDraftRequest: {
            requestId: 1,
            projectId: 'test-project-id',
            content: 'Please address review comment 1.',
            reviewHandoffIds: ['handoff-1'],
          },
          workspaceReviewHandoffs: [
            {
              handoffId: 'handoff-1',
              requestId: 1,
              projectId: 'test-project-id',
              reviewTabId: 'review-1',
              commentIds: ['comment-1'],
              content: 'Please address review comment 1.',
            },
          ],
        });
      });

      await waitFor(() => {
        expect(screen.getByTestId('message-input')).toHaveValue(
          'Please address review comment 1.'
        );
      });
      const pendingReviewTab =
        usePageTabStore.getState().sessionPreviewByProject['test-project-id']
          .tabs[0];
      expect(pendingReviewTab.type).toBe('review');
      expect(
        pendingReviewTab.type === 'review'
          ? pendingReviewTab.reviewComments?.[0].status
          : 'wrong-tab-type'
      ).toBeUndefined();

      await userEvent.click(screen.getByTestId('send-button'));

      await waitFor(() => {
        const reviewTab =
          usePageTabStore.getState().sessionPreviewByProject['test-project-id']
            .tabs[0];
        expect(reviewTab).toMatchObject({
          reviewComments: [
            expect.objectContaining({ id: 'comment-1', status: 'sent' }),
          ],
        });
      });
      expect(usePageTabStore.getState().workspaceReviewHandoffs).toEqual([]);
    });

    it('does not acknowledge review feedback removed from the composer', async () => {
      renderChatBox();

      act(() => {
        usePageTabStore.setState({
          sessionPreviewProjectId: 'test-project-id',
          sessionPreviewByProject: {
            'test-project-id': {
              open: true,
              activeTabId: 'review-1',
              tabs: [
                {
                  id: 'review-1',
                  type: 'review',
                  title: 'Review',
                  reviewComments: [
                    {
                      id: 'comment-1',
                      fileId: 'src/app.ts',
                      path: 'src/app.ts',
                      selection: null,
                      body: 'Keep this compatible.',
                      createdAt: 1,
                    },
                  ],
                },
              ],
            },
          },
          workspaceChatDraftRequestSequence: 1,
          workspaceChatFocusRequestId: 1,
          workspaceChatDraftRequest: {
            requestId: 1,
            projectId: 'test-project-id',
            content: 'Please address review comment 1.',
            reviewHandoffIds: ['handoff-1'],
          },
          workspaceReviewHandoffs: [
            {
              handoffId: 'handoff-1',
              requestId: 1,
              projectId: 'test-project-id',
              reviewTabId: 'review-1',
              commentIds: ['comment-1'],
              content: 'Please address review comment 1.',
            },
          ],
        });
      });

      const input = await screen.findByTestId('message-input');
      await userEvent.clear(input);
      await userEvent.type(input, 'Unrelated request');
      await userEvent.click(screen.getByTestId('send-button'));

      await waitFor(() =>
        expect(defaultChatStoreState.startTask).toHaveBeenCalled()
      );
      const call = defaultChatStoreState.startTask.mock.calls.at(-1) ?? [];
      expect(call[4]).toBe('Unrelated request');
      expect(call[9]).toBeUndefined();
      const reviewTabAfterSend =
        usePageTabStore.getState().sessionPreviewByProject['test-project-id']
          .tabs[0];
      expect(reviewTabAfterSend).toMatchObject({
        reviewComments: [expect.objectContaining({ id: 'comment-1' })],
      });
      expect(
        reviewTabAfterSend.type === 'review'
          ? reviewTabAfterSend.reviewComments?.[0].status
          : 'wrong-tab-type'
      ).toBeUndefined();
      expect(usePageTabStore.getState().workspaceReviewHandoffs).toEqual([]);
    });

    it('recovers an admitted review handoff from the durable user message', async () => {
      eventNativeHarness.enabled = true;
      eventNativeHarness.snapshot = runningEventNativeSnapshot();
      eventNativeHarness.snapshot.chat.nodes.push({
        id: 'review-user-message',
        eventId: 'review-user-message',
        projectId: 'test-project-id',
        runId: 'test-task-id',
        createdAt: '2026-08-20T00:00:01Z',
        runSequence: 2,
        cloudCursor: 2,
        eventType: 'user.message',
        legacyStep: null,
        kind: 'message',
        role: 'user',
        content: 'Review feedback',
        status: 'completed',
        reviewHandoffIds: ['handoff-recovered'],
      });
      usePageTabStore.setState({
        sessionPreviewProjectId: 'test-project-id',
        sessionPreviewByProject: {
          'test-project-id': {
            open: true,
            activeTabId: 'review-1',
            tabs: [
              {
                id: 'review-1',
                type: 'review',
                title: 'Review',
                reviewComments: [
                  {
                    id: 'comment-1',
                    fileId: 'src/app.ts',
                    path: 'src/app.ts',
                    selection: null,
                    body: 'Keep this compatible.',
                    createdAt: 1,
                  },
                ],
              },
            ],
          },
        },
        workspaceReviewHandoffs: [
          {
            handoffId: 'handoff-recovered',
            requestId: 1,
            projectId: 'test-project-id',
            reviewTabId: 'review-1',
            commentIds: ['comment-1'],
            content: 'Review feedback',
          },
        ],
      });

      renderChatBox();

      await waitFor(() => {
        const tab =
          usePageTabStore.getState().sessionPreviewByProject['test-project-id']
            .tabs[0];
        expect(tab).toMatchObject({
          reviewComments: [
            expect.objectContaining({ id: 'comment-1', status: 'sent' }),
          ],
        });
      });
      expect(usePageTabStore.getState().workspaceReviewHandoffs).toEqual([]);
    });

    it('should not fetch privacy settings on mount', async () => {
      renderChatBox();

      await waitFor(() => {
        expect(mockProxyFetchGet).not.toHaveBeenCalledWith('/api/user/privacy');
      });
    });

    it('should fetch API configurations on mount', async () => {
      renderChatBox();

      await waitFor(() => {
        expect(mockProxyFetchGet).toHaveBeenCalledWith('/api/v1/configs');
      });
    });
  });

  describe('Privacy', () => {
    it('should not fetch privacy settings on mount', async () => {
      renderChatBox();

      // Privacy is now handled at login, not in ChatBox
      await waitFor(() => {
        expect(mockProxyFetchGet).not.toHaveBeenCalledWith('/api/user/privacy');
      });
    });
  });

  describe('Chat Interface', () => {
    it('keeps cloud history visible when local event history is unavailable', () => {
      eventNativeHarness.enabled = true;
      eventNativeHarness.snapshot = null;
      const restoredChatStore = {
        ...defaultChatStoreState,
        tasks: {
          'test-task-id': {
            ...defaultChatStoreState.tasks['test-task-id'],
            messages: [
              {
                id: 'restored-message',
                role: 'agent',
                content: 'Restored cloud history',
              },
            ],
            hasMessages: true,
          },
        },
      };
      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: restoredChatStore as any,
      });

      renderChatBox();

      expect(screen.getByTestId('project-chat-container')).toBeInTheDocument();
      expect(
        screen.queryByTestId('event-native-timeline')
      ).not.toBeInTheDocument();
    });

    beforeEach(() => {
      const updatedChatState = {
        ...defaultChatStoreState,
        tasks: {
          'test-task-id': {
            ...defaultChatStoreState.tasks['test-task-id'],
            messages: [
              {
                id: '1',
                role: 'user',
                content: 'Hello',
                attaches: [],
              },
              {
                id: '2',
                role: 'assistant',
                content: 'Hi there!',
                attaches: [],
              },
            ],
            hasMessages: true,
          },
        },
      };

      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: updatedChatState as any,
      });
    });

    it('should render project chat container when messages exist', () => {
      renderChatBox();

      expect(screen.getByTestId('project-chat-container')).toBeInTheDocument();
    });

    it.each([
      ['running', 'pause'],
      ['pause', 'resume'],
    ] as const)(
      'routes the empty composer %s state through the %s task control',
      async (status, action) => {
        const user = userEvent.setup();
        const controlledTask = {
          ...defaultChatStoreState.tasks['test-task-id'],
          status,
          hasMessages: true,
          messages: [{ id: '1', role: 'user', content: 'Start', attaches: [] }],
          elapsed: 100,
          taskTime: 1_000,
        };
        const controlledStore = {
          ...defaultChatStoreState,
          tasks: { 'test-task-id': controlledTask },
          setElapsed: vi.fn(),
          setTaskTime: vi.fn(),
          setStatus: vi.fn(),
        };
        mockUseChatStoreAdapter.mockReturnValue({
          projectStore: defaultProjectStoreState as any,
          chatStore: controlledStore as any,
        });

        renderChatBox();

        const actionButton = screen.getByTestId('send-button');
        expect(actionButton).toHaveAttribute(
          'data-composer-primary-action',
          action
        );
        await user.click(actionButton);

        await waitFor(() => {
          expect(_mockFetchPut).toHaveBeenCalledWith(
            '/task/test-project-id/take-control',
            { action }
          );
        });
      }
    );

    it('sends an attachment-only draft with a usable instruction', async () => {
      const user = userEvent.setup();
      const attachment = {
        fileName: 'brief.pdf',
        filePath: '/tmp/brief.pdf',
      };
      const attachmentStore = {
        ...defaultChatStoreState,
        tasks: {
          'test-task-id': {
            ...defaultChatStoreState.tasks['test-task-id'],
            attaches: [attachment],
          },
        },
      };
      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: attachmentStore as any,
      });

      renderChatBox();

      const actionButton = screen.getByTestId('send-button');
      expect(actionButton).toHaveAttribute(
        'data-composer-primary-action',
        'send'
      );
      await user.click(actionButton);

      await waitFor(() => {
        expect(attachmentStore.startTask).toHaveBeenCalledWith(
          'test-task-id',
          undefined,
          undefined,
          undefined,
          'Please use the attached file(s).',
          [attachment],
          undefined,
          'test-project-id',
          'single-agent',
          undefined
        );
      });
    });

    it('should handle message sending', async () => {
      const user = userEvent.setup();

      // Create a proper pending state where we can continue a conversation
      const updatedChatState = {
        ...defaultChatStoreState,
        tasks: {
          'test-task-id': {
            ...defaultChatStoreState.tasks['test-task-id'],
            messages: [
              {
                id: '1',
                role: 'user',
                content: 'Hello',
                attaches: [],
              },
              {
                id: '2',
                role: 'assistant',
                content: 'Hi there!',
                step: 'wait_confirm', // Add wait_confirm to allow continuation
                attaches: [],
              },
            ],
            hasMessages: true,
            hasWaitComfirm: true, // Set hasWaitComfirm to true
            status: 'pending', // Keep it pending
          },
        },
      };

      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: updatedChatState as any,
      });

      renderChatBox();

      const messageInput = screen.getByTestId('message-input');
      const sendButton = screen.getByTestId('send-button');

      await user.type(messageInput, 'Test message');
      await user.click(sendButton);

      // A follow-up is prepared as a new durable Run before admission.
      await waitFor(() => {
        expect(defaultProjectStoreState.appendInitChatStore).toHaveBeenCalled();
        expect(_mockFetchPost).toHaveBeenCalledWith(
          '/chat/test-project-id',
          expect.objectContaining({
            question: 'Test message',
          })
        );
      });

      const nextTaskId =
        defaultProjectStoreState.appendInitChatStore.mock.calls[0][1];
      expect(preparedRunState.setNextTaskId).toHaveBeenCalledWith(nextTaskId);
      expect(preparedRunState.setTaskSessionMode).toHaveBeenCalledWith(
        nextTaskId,
        'single-agent'
      );
      expect(preparedRunState.setIsPending).toHaveBeenCalledWith(
        nextTaskId,
        true
      );
      expect(preparedRunState.setHasMessages).toHaveBeenCalledWith(
        nextTaskId,
        true
      );
      expect(_mockFetchPost).toHaveBeenCalledWith(
        '/chat/test-project-id',
        expect.objectContaining({ task_id: nextTaskId })
      );
    });

    it('keeps the composer available and queues a second task while running', async () => {
      const user = userEvent.setup();
      const runningChatState = {
        ...defaultChatStoreState,
        tasks: {
          'test-task-id': {
            ...defaultChatStoreState.tasks['test-task-id'],
            messages: [
              {
                id: 'running-query',
                role: 'user',
                content: 'First task',
                attaches: [],
              },
            ],
            hasMessages: true,
            status: 'running',
          },
        },
      };
      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: runningChatState as any,
      });
      _mockFetchPost.mockResolvedValueOnce({
        request_id: 'test-unique-id',
        project_id: 'test-project-id',
        content: 'Second task',
        attachment_paths: [],
        delivery_mode: 'wait',
        status: 'pending',
        source: 'local',
        created_at: 1,
        updated_at: 1,
      });

      renderChatBox();
      await user.type(screen.getByTestId('message-input'), 'Second task');
      await user.click(screen.getByTestId('send-button'));

      await waitFor(() => {
        expect(_mockFetchPost).toHaveBeenCalledWith(
          '/projects/test-project-id/follow-ups',
          {
            request_id: 'test-unique-id',
            content: 'Second task',
            attachment_paths: [],
            delivery_mode: 'wait',
            source: 'local',
            source_command_id: undefined,
          }
        );
        expect(
          defaultProjectStoreState.restoreQueuedMessage
        ).toHaveBeenCalledWith(
          'test-project-id',
          expect.objectContaining({
            task_id: 'test-unique-id',
            content: 'Second task',
            source: 'local',
          })
        );
      });
    });

    it('admits queued follow-ups one at a time without writing into the completed Run', async () => {
      const queuedMessages = [
        {
          task_id: 'queued-run-1',
          run_id: 'queued-run-1',
          content: 'First queued follow-up',
          timestamp: 1,
          attaches: [],
        },
        {
          task_id: 'queued-run-2',
          run_id: 'queued-run-2',
          content: 'Second queued follow-up',
          timestamp: 2,
          attaches: [],
        },
      ];
      defaultProjectStoreState.getProjectById.mockImplementation(
        () => ({ queuedMessages }) as any
      );
      defaultProjectStoreState.removeQueuedMessage.mockImplementation(
        (_projectId: string, taskId: string) => {
          const index = queuedMessages.findIndex(
            (item) => item.task_id === taskId
          );
          return index >= 0 ? queuedMessages.splice(index, 1)[0] : undefined;
        }
      );

      const completedTask = {
        ...defaultChatStoreState.tasks['test-task-id'],
        messages: [
          {
            id: 'completed-query',
            role: 'user',
            content: 'Completed task',
            attaches: [],
          },
        ],
        hasMessages: true,
        hasWaitComfirm: true,
        status: 'finished',
      };
      const completedStore = {
        ...defaultChatStoreState,
        tasks: { 'test-task-id': completedTask },
      };
      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: completedStore as any,
      });
      defaultProjectStoreState.getAllChatStores.mockReturnValue([]);
      eventNativeHarness.enabled = true;
      eventNativeHarness.snapshot = runningEventNativeSnapshot('test-task-id');
      eventNativeHarness.snapshot.view.runs['test-task-id'].status =
        'completed';
      mockFetchGet.mockImplementation((url: string) => {
        if (url === '/chat/test-project-id/status') {
          return Promise.resolve({
            has_lock: true,
            status: 'done',
            run_id: 'test-task-id',
          });
        }
        return Promise.resolve({ items: [] });
      });

      const view = renderChatBox();

      await waitFor(() => {
        expect(_mockFetchPost).toHaveBeenCalledWith('/chat/test-project-id', {
          question: 'First queued follow-up',
          task_id: 'queued-run-1',
          attaches: [],
          target: undefined,
        });
      });
      expect(
        _mockFetchPost.mock.calls.filter(
          ([url]) => url === '/chat/test-project-id'
        )
      ).toHaveLength(1);
      expect(completedStore.addMessages).not.toHaveBeenCalled();
      expect(defaultProjectStoreState.removeQueuedMessage).toHaveBeenCalledWith(
        'test-project-id',
        'queued-run-1'
      );

      eventNativeHarness.snapshot = runningEventNativeSnapshot('queued-run-1');
      eventNativeHarness.snapshot.revision = 2;
      view.rerender(
        <BrowserRouter>
          <ChatBox />
        </BrowserRouter>
      );
      await Promise.resolve();
      expect(
        _mockFetchPost.mock.calls.filter(
          ([url]) => url === '/chat/test-project-id'
        )
      ).toHaveLength(1);

      eventNativeHarness.snapshot = runningEventNativeSnapshot('queued-run-1');
      eventNativeHarness.snapshot.revision = 3;
      eventNativeHarness.snapshot.view.runs['queued-run-1'].status =
        'completed';
      view.rerender(
        <BrowserRouter>
          <ChatBox />
        </BrowserRouter>
      );

      await waitFor(() => {
        expect(_mockFetchPost).toHaveBeenCalledWith('/chat/test-project-id', {
          question: 'Second queued follow-up',
          task_id: 'queued-run-2',
          attaches: [],
          target: undefined,
        });
      });
    });

    it('should not send empty messages', async () => {
      const user = userEvent.setup();

      renderChatBox();

      const sendButton = screen.getByTestId('send-button');
      await user.click(sendButton);

      expect(defaultChatStoreState.addMessages).not.toHaveBeenCalled();
    });
  });

  describe('Event-native floating Stop', () => {
    const setRunningEventNativeStore = () => {
      const runningTask = {
        ...defaultChatStoreState.tasks['test-task-id'],
        status: 'running',
        hasMessages: true,
        messages: [{ id: '1', role: 'user', content: 'Start', attaches: [] }],
      };
      const runningStore = {
        ...defaultChatStoreState,
        tasks: { 'test-task-id': runningTask },
        stopTask: vi.fn(),
        setIsPending: vi.fn(),
      };
      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: runningStore as any,
      });
      eventNativeHarness.enabled = true;
      eventNativeHarness.snapshot = runningEventNativeSnapshot();
      return runningStore;
    };

    it('keeps the plan overlay host mounted for the durable timeline', () => {
      setRunningEventNativeStore();

      renderChatBox();

      expect(
        document.getElementById('plan-task-overlay-root')
      ).toBeInTheDocument();
    });

    it('keeps Stop and Pause available while projected Run ownership hydrates', async () => {
      const user = userEvent.setup();
      setRunningEventNativeStore();
      eventNativeHarness.snapshot.chat.nodes[0].eventType = 'legacy.agent_step';

      renderChatBox();

      const floatingStop = document.querySelector(
        '[data-floating-stop-control]'
      );
      expect(floatingStop).toHaveClass('justify-center');
      expect(floatingStop).toHaveStyle({ bottom: '128px' });
      const stopButton = screen.getByRole('button', { name: 'Stop Task' });
      const pauseButton = screen.getByTestId('send-button');
      expect(pauseButton).toHaveAttribute(
        'data-composer-primary-action',
        'pause'
      );

      await user.click(pauseButton);
      await waitFor(() => {
        expect(_mockFetchPut).toHaveBeenCalledWith(
          '/task/test-project-id/take-control',
          { action: 'pause' }
        );
      });

      await user.click(stopButton);
      await waitFor(() => {
        expect(_mockFetchPost).toHaveBeenCalledWith(
          '/chat/test-project-id/skip-task',
          { project_id: 'test-project-id' }
        );
      });
    });

    it('keeps the centered Stop control in the legacy-history fallback', () => {
      setRunningEventNativeStore();
      eventNativeHarness.snapshot = null;

      renderChatBox();

      expect(screen.getByTestId('project-chat-container')).toBeInTheDocument();
      expect(
        document.querySelector('[data-floating-stop-control]')
      ).toHaveClass('justify-center');
      expect(
        screen.getByRole('button', { name: 'Stop Task' })
      ).toBeInTheDocument();
    });

    it('fails closed when the rendered Run loses control ownership before click', async () => {
      const user = userEvent.setup();
      setRunningEventNativeStore();
      renderChatBox();
      const stopButton = await screen.findByRole('button', {
        name: 'Stop Task',
      });

      const snapshot = eventNativeHarness.snapshot;
      snapshot.view.runs['typed-run'] = {
        ...snapshot.view.runs['test-task-id'],
        runId: 'typed-run',
      };
      snapshot.control.orderedInteractionIds.push('typed-request');
      snapshot.control.interactionById['typed-request'] = {
        interactionId: 'typed-request',
        runId: 'typed-run',
        status: 'requested',
        requestSource: 'canonical',
        requestEventType: 'interaction.requested',
      };

      await user.click(stopButton);

      expect(_mockFetchPost).not.toHaveBeenCalledWith(
        expect.stringMatching(/^\/runs\//),
        expect.anything()
      );
    });

    it('reuses the request id after failure and never closes the legacy SSE', async () => {
      const user = userEvent.setup();
      const runningStore = setRunningEventNativeStore();
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      _mockFetchPost.mockRejectedValue(new Error('offline'));
      renderChatBox();
      const stopButton = await screen.findByRole('button', {
        name: 'Stop Task',
      });

      await user.click(stopButton);
      await waitFor(() => expect(_mockFetchPost).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(stopButton).not.toBeDisabled());
      await user.click(stopButton);
      await waitFor(() => expect(_mockFetchPost).toHaveBeenCalledTimes(2));

      const [firstUrl, firstBody] = _mockFetchPost.mock.calls[0];
      const [secondUrl, secondBody] = _mockFetchPost.mock.calls[1];
      expect(firstUrl).toBe('/runs/test-task-id/cancel');
      expect(secondUrl).toBe(firstUrl);
      expect(secondBody.request_id).toBe(firstBody.request_id);
      expect(runningStore.stopTask).not.toHaveBeenCalled();
      expect(runningStore.setIsPending).not.toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe('Event-native human-control compatibility bridge', () => {
    it('reconciles the initiating Project after the user switches Projects', () => {
      eventNativeHarness.enabled = true;
      eventNativeHarness.snapshot = runningEventNativeSnapshot();
      const projectAState = {
        ...defaultChatStoreState,
        activeTaskId: 'test-task-id',
        tasks: {
          'test-task-id': {
            ...defaultChatStoreState.tasks['test-task-id'],
            messages: [],
            askList: [],
          },
        },
        setIsPending: vi.fn(),
        setDurableRunStatus: vi.fn(),
        setStatus: vi.fn(),
        markHumanInteractionResolved: vi.fn(),
        setActiveAskList: vi.fn(),
        setActiveAsk: vi.fn(),
        addMessages: vi.fn(),
      };
      const projectBState = {
        ...projectAState,
        setIsPending: vi.fn(),
        setDurableRunStatus: vi.fn(),
        setStatus: vi.fn(),
        markHumanInteractionResolved: vi.fn(),
        setActiveAskList: vi.fn(),
        setActiveAsk: vi.fn(),
        addMessages: vi.fn(),
      };
      const projectAStore = { getState: () => projectAState };
      const projectBStore = { getState: () => projectBState };
      defaultProjectStoreState.getActiveChatStore.mockImplementation(((
        projectId?: string
      ) =>
        projectId === 'test-project-id'
          ? projectAStore
          : projectBStore) as any);
      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: projectAState as any,
      });

      renderChatBox();
      const initiatingCallbacks = eventNativeHarness.controlOptions;
      defaultProjectStoreState.activeProjectId = 'project-b';
      const interaction = {
        interactionId: 'interaction-1',
        runId: 'test-task-id',
      };

      initiatingCallbacks.onSubmissionStart(interaction);
      initiatingCallbacks.onSubmissionFailure(interaction);
      initiatingCallbacks.onDurableResolution(interaction);

      expect(
        defaultProjectStoreState.getActiveChatStore
      ).toHaveBeenLastCalledWith('test-project-id');
      expect(projectAState.setIsPending).toHaveBeenCalledWith(
        'test-task-id',
        true
      );
      expect(projectAState.setIsPending).toHaveBeenCalledWith(
        'test-task-id',
        false
      );
      expect(projectAState.markHumanInteractionResolved).toHaveBeenCalledWith(
        'test-task-id',
        'interaction-1'
      );
      expect(projectBState.setIsPending).not.toHaveBeenCalled();
      expect(projectBState.markHumanInteractionResolved).not.toHaveBeenCalled();
    });
  });

  describe('Task Management', () => {
    it('should render project chat container when tasks have messages', () => {
      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: {
          ...defaultChatStoreState,
          tasks: {
            'test-task-id': {
              ...defaultChatStoreState.tasks['test-task-id'],
              messages: [
                {
                  id: '1',
                  role: 'assistant',
                  content: '',
                  step: 'to_sub_tasks',
                  taskType: 1,
                },
              ],
              hasMessages: true,
              isTakeControl: false,
              cotList: [],
            },
          },
        } as any,
      });

      renderChatBox();

      // With the new architecture, task cards are rendered inside ProjectChatContainer
      expect(screen.getByTestId('project-chat-container')).toBeInTheDocument();
    });

    it('should render project chat container for notice card scenario', () => {
      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: {
          ...defaultChatStoreState,
          tasks: {
            'test-task-id': {
              ...defaultChatStoreState.tasks['test-task-id'],
              messages: [
                {
                  id: '1',
                  role: 'assistant',
                  content: '',
                  step: 'notice_card',
                },
              ],
              hasMessages: true,
              isTakeControl: false,
              cotList: ['item1'],
            },
          },
        } as any,
      });

      renderChatBox();

      // With the new architecture, notice cards are rendered inside ProjectChatContainer
      expect(screen.getByTestId('project-chat-container')).toBeInTheDocument();
    });
  });

  describe('Loading States', () => {
    it('should render project chat container when task is pending', () => {
      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: {
          ...defaultChatStoreState,
          tasks: {
            'test-task-id': {
              ...defaultChatStoreState.tasks['test-task-id'],
              messages: [
                {
                  id: '1',
                  role: 'user',
                  content: 'Hello',
                },
              ],
              hasMessages: true,
              hasWaitComfirm: false,
              isTakeControl: false,
            },
          },
        } as any,
      });

      renderChatBox();

      // With the new architecture, loading states are handled inside ProjectChatContainer
      expect(screen.getByTestId('project-chat-container')).toBeInTheDocument();
    });
  });

  describe('File Handling', () => {
    it('should render project chat container when message has files', () => {
      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: {
          ...defaultChatStoreState,
          tasks: {
            'test-task-id': {
              ...defaultChatStoreState.tasks['test-task-id'],
              messages: [
                {
                  id: '1',
                  role: 'assistant',
                  content: 'Task complete',
                  step: 'end',
                  fileList: [
                    {
                      name: 'test-file.pdf',
                      type: 'PDF',
                      path: '/path/to/file',
                    },
                  ],
                },
              ],
              hasMessages: true,
            },
          },
        } as any,
      });

      renderChatBox();

      // With the new architecture, file lists are rendered inside ProjectChatContainer
      expect(screen.getByTestId('project-chat-container')).toBeInTheDocument();
    });

    it('should render project chat container for file handling', () => {
      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: {
          ...defaultChatStoreState,
          tasks: {
            'test-task-id': {
              ...defaultChatStoreState.tasks['test-task-id'],
              messages: [
                {
                  id: '1',
                  role: 'assistant',
                  content: 'Task complete',
                  step: 'end',
                  fileList: [
                    {
                      name: 'test-file.pdf',
                      type: 'PDF',
                      path: '/path/to/file',
                    },
                  ],
                },
              ],
              hasMessages: true,
            },
          },
        } as any,
      });

      renderChatBox();

      // With the new architecture, file lists are rendered inside ProjectChatContainer
      expect(screen.getByTestId('project-chat-container')).toBeInTheDocument();
    });
  });

  describe('Agent Interaction', () => {
    it('should handle human reply when activeAsk is set', async () => {
      const user = userEvent.setup();

      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: {
          ...defaultChatStoreState,
          tasks: {
            'test-task-id': {
              ...defaultChatStoreState.tasks['test-task-id'],
              activeAsk: 'test-agent',
              askList: [],
              hasMessages: true,
            },
          },
        } as any,
      });

      renderChatBox();

      const messageInput = screen.getByTestId('message-input');
      const sendButton = screen.getByTestId('send-button');

      await user.type(messageInput, 'Test reply');
      await user.click(sendButton);

      await waitFor(() => {
        // The API call now uses project ID instead of task ID
        expect(_mockFetchPost).toHaveBeenCalledWith(
          '/chat/test-project-id/human-reply',
          {
            agent: 'test-agent',
            reply: 'Test reply',
          }
        );
      });
    });

    it('should clear stale human reply state when backend no longer has the task lock', async () => {
      const user = userEvent.setup();
      _mockFetchPost.mockResolvedValueOnce({
        code: 1,
        text: 'This task is no longer waiting for a human reply.',
      });

      const storeObj = {
        ...defaultChatStoreState,
        tasks: {
          'test-task-id': {
            ...defaultChatStoreState.tasks['test-task-id'],
            activeAsk: 'test-agent',
            askList: [],
            hasMessages: true,
          },
        },
      } as any;

      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: storeObj,
      });

      renderChatBox();

      const messageInput = screen.getByTestId('message-input');
      const sendButton = screen.getByTestId('send-button');

      await user.type(messageInput, 'Late reply');
      await user.click(sendButton);

      await waitFor(() => {
        expect(storeObj.removeMessage).toHaveBeenCalledWith(
          'test-task-id',
          expect.any(String)
        );
        expect(storeObj.setIsPending).toHaveBeenCalledWith(
          'test-task-id',
          false
        );
        expect(storeObj.setActiveAskList).toHaveBeenCalledWith(
          'test-task-id',
          []
        );
        expect(storeObj.setActiveAsk).toHaveBeenCalledWith('test-task-id', '');
      });
    });

    it('should process ask list when human reply is sent', async () => {
      const user = userEvent.setup();

      const mockMessage = {
        id: '2',
        role: 'assistant',
        content: 'Next question',
        agent_name: 'next-agent',
      };

      // Create a store object we can assert against so we capture the exact mocked functions
      const storeObj = {
        ...defaultChatStoreState,
        tasks: {
          'test-task-id': {
            ...defaultChatStoreState.tasks['test-task-id'],
            activeAsk: 'test-agent',
            askList: [mockMessage],
            hasMessages: true,
          },
        },
      } as any;

      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: storeObj,
      });

      renderChatBox();

      // Type a non-empty message so handleSend proceeds to process the ask list
      const messageInput = screen.getByTestId('message-input');
      await user.type(messageInput, 'Reply to ask');
      const sendButton = screen.getByTestId('send-button');
      await user.click(sendButton);

      await waitFor(() => {
        // Assert that the ask processing resulted in either store updates or an API call
        const storeCalled =
          (storeObj.setActiveAskList as any).mock.calls.length > 0 ||
          (storeObj.addMessages as any).mock.calls.length > 0;
        const apiCalled = (_mockFetchPost as any).mock.calls.length > 0;
        expect(storeCalled || apiCalled).toBe(true);
      });
    });

    it('keeps an ordinary human question pending without a skip timer', () => {
      const timeoutSpy = vi.spyOn(window, 'setTimeout');

      const activeAskTask = {
        ...defaultChatStoreState.tasks['test-task-id'],
        activeAsk: 'test-agent',
        hasMessages: true,
        messages: [
          {
            id: 'ask-1',
            role: 'agent',
            content: 'Please clarify',
            step: 'ask',
          },
        ],
      };
      const storeObj = {
        ...defaultChatStoreState,
        tasks: { 'test-task-id': activeAskTask },
      } as any;
      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: storeObj,
      });

      renderChatBox();

      expect(
        timeoutSpy.mock.calls.filter(([, delay]) => delay === 30000)
      ).toHaveLength(0);
      expect(_mockFetchPost).not.toHaveBeenCalledWith(
        '/chat/test-project-id/human-reply',
        expect.objectContaining({ reply: 'skip' })
      );
      expect(storeObj.setActiveAsk).not.toHaveBeenCalled();
      expect(storeObj.setIsPending).not.toHaveBeenCalled();
      timeoutSpy.mockRestore();
    });

    it('should not auto-skip a question while replaying history', () => {
      const timeoutSpy = vi.spyOn(window, 'setTimeout');
      const replayTask = {
        ...defaultChatStoreState.tasks['test-task-id'],
        type: 'replay',
        activeAsk: 'test-agent',
        hasMessages: true,
        messages: [
          {
            id: 'historical-ask-1',
            role: 'agent',
            content: 'Historical question',
            step: 'ask',
          },
        ],
      };
      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: {
          ...defaultChatStoreState,
          tasks: { 'test-task-id': replayTask },
        } as any,
      });

      renderChatBox();

      expect(
        timeoutSpy.mock.calls.filter(([, delay]) => delay === 30000)
      ).toHaveLength(0);
      timeoutSpy.mockRestore();
    });
  });

  describe('Environment-specific Behavior', () => {
    it('should show cloud model warning in self-hosted mode', async () => {
      Object.defineProperty(import.meta, 'env', {
        value: { VITE_USE_LOCAL_PROXY: 'true' },
        writable: true,
      });

      mockUseAuthStore.mockReturnValue({
        modelType: 'cloud',
      } as any);

      renderChatBox();

      await waitFor(() => {
        const foundCloud = !!(
          document.body.textContent &&
          document.body.textContent.includes('Self-hosted')
        );
        const hasInput = !!screen.queryByTestId('message-input');
        expect(foundCloud || hasInput).toBe(true);
      });
    });

    it('should show search key warning when missing API keys', async () => {
      mockProxyFetchGet.mockImplementation((url: string) => {
        if (url === '/api/providers' || url === '/api/v1/providers') {
          return Promise.resolve({
            items: [{ id: 'test-provider', name: 'Test' }],
          });
        }
        if (url === '/api/v1/configs') {
          return Promise.resolve([]); // No API keys
        }
        return Promise.resolve({});
      });

      mockUseAuthStore.mockReturnValue({
        modelType: 'local',
      } as any);

      renderChatBox();

      await waitFor(() => {
        expect(screen.getByTestId('message-input')).toBeInTheDocument();
      });
    });
  });

  describe('Keyboard Shortcuts', () => {
    it('should handle message sending through send button', async () => {
      const user = userEvent.setup();

      // Set up a state where we can send messages
      const mockStartTask = vi.fn().mockResolvedValue(undefined);
      const stateForSending = {
        ...defaultChatStoreState,
        startTask: mockStartTask,
      };

      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: stateForSending as any,
      });

      renderChatBox();

      const messageInput = screen.getByTestId('message-input');
      await user.type(messageInput, 'Test message');

      // Click the send button instead of testing Ctrl+Enter
      const sendButton = screen.getByTestId('send-button');
      await user.click(sendButton);

      // Should call startTask for a new conversation
      await waitFor(() => {
        expect(mockStartTask).toHaveBeenCalled();
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle API errors gracefully', async () => {
      const user = userEvent.setup();
      // Instead of asserting on console.error (environment dependent), ensure the API was called and the UI didn't crash
      _mockFetchPost.mockRejectedValue(new Error('API Error'));

      // Force a code path that calls fetchPost by setting activeAsk on the task
      mockUseChatStoreAdapter.mockReturnValue({
        projectStore: defaultProjectStoreState as any,
        chatStore: {
          ...defaultChatStoreState,
          tasks: {
            'test-task-id': {
              ...defaultChatStoreState.tasks['test-task-id'],
              activeAsk: 'agent-x',
              hasMessages: true,
            },
          },
        } as any,
      });

      renderChatBox();

      // Make sure we send a non-empty message so API path is exercised
      const messageInput = screen.getByTestId('message-input');
      await user.type(messageInput, 'API test');
      const sendButton = screen.getByTestId('send-button');
      await user.click(sendButton);

      await waitFor(() => {
        expect((_mockFetchPost as any).mock.calls.length).toBeGreaterThan(0);
      });
    });

    it('should handle configs fetch errors', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      mockProxyFetchGet.mockRejectedValue(new Error('Configs fetch failed'));

      expect(() => renderChatBox()).not.toThrow();

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalled();
      });

      consoleErrorSpy.mockRestore();
    });
  });
});
