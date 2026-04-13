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
  fetchDelete,
  fetchPost,
  fetchPut,
  proxyFetchDelete,
  proxyFetchGet,
} from '@/api/http';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { generateUniqueId, replayActiveTask } from '@/lib';
import { proxyUpdateTriggerExecution } from '@/service/triggerApi';
import { useAuthStore } from '@/store/authStore';
import type { ChatStore } from '@/store/chatStore';
import { usePageTabStore } from '@/store/pageTabStore';
import type { ProjectStore } from '@/store/projectStore';
import { ExecutionStatus } from '@/types';
import { AgentStep, ChatTaskStatus } from '@/types/constants';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import type { BottomBoxState } from './BottomBox';

/** Minimum scroll padding under messages (matches previous ~8rem floor). */
export const CHAT_SCROLL_BOTTOM_MIN_PX = 128;
/** Small gap between last message and BottomBox top. */
export const CHAT_SCROLL_BOTTOM_GAP_PX = 8;
/** Below this ChatBox width, the timeline uses a header dropdown instead of the left rail. */
export const CHAT_TIMELINE_BREAKPOINT_PX = 600;
/** Default width for the folded workforce rail. */
export const WORKFORCE_FOLDED_RAIL_CLASS = 'w-[360px]';
/** Session view: narrower fixed right rail. */
export const SESSION_WORKFORCE_RAIL_CLASS = 'w-[240px]';

export type UseWorkforceChatInputOptions = {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  bottomBoxOverlayRef: React.RefObject<HTMLDivElement | null>;
  /** When false, skip measuring bottom overlay height for scroll padding (e.g. project shell). */
  measureScrollBottomInset?: boolean;
};

export type UseWorkforceChatInputResult = {
  chatStore: ChatStore | null;
  projectStore: ProjectStore;
  message: string;
  setMessage: React.Dispatch<React.SetStateAction<string>>;
  textareaRef: React.RefObject<HTMLDivElement | null>;
  taskTime: string;
  loading: boolean;
  isReplayLoading: boolean;
  isPauseResumeLoading: boolean;
  hasModel: boolean;
  isConfigLoaded: boolean;
  useCloudModelInDev: boolean;
  queuedMessages: Array<{ id: string; content: string; timestamp: number }>;
  handleRemoveTaskQueue: (task_id: string) => Promise<void>;
  getBottomBoxState: () => BottomBoxState;
  handleSend: (
    messageStr?: string,
    taskId?: string,
    executionId?: string
  ) => Promise<void>;
  handleConfirmTask: (taskId?: string) => Promise<void>;
  handleFileSelect: () => Promise<void>;
  handlePauseResume: () => void;
  handleEditQuery: () => Promise<void>;
  handleReplay: () => Promise<void>;
  handleSkip: () => Promise<void>;
  isInputDisabled: boolean;
  scrollBottomInsetPx: number;
  hasAnyMessages: boolean;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  checkModelConfig: () => Promise<void>;
};

export function useWorkforceChatInput(
  options: UseWorkforceChatInputOptions
): UseWorkforceChatInputResult {
  const {
    scrollContainerRef,
    bottomBoxOverlayRef,
    measureScrollBottomInset = true,
  } = options;

  const { chatStore, projectStore } = useChatStoreAdapter();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [message, setMessage] = useState<string>('');
  const textareaRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleSendRef = useRef<
    ((messageStr?: string, taskId?: string) => Promise<void>) | null
  >(null);

  const workspaceChatFocusRequestId = usePageTabStore(
    (s) => s.workspaceChatFocusRequestId
  );
  const activeWorkspaceTab = usePageTabStore((s) => s.activeWorkspaceTab);
  const setHasAgentFiles = usePageTabStore((s) => s.setHasAgentFiles);
  const markTabAsUnviewed = usePageTabStore((s) => s.markTabAsUnviewed);

  const [hasModel, setHasModel] = useState(false);
  const [isConfigLoaded, setIsConfigLoaded] = useState(false);
  const [scrollBottomInsetPx, setScrollBottomInsetPx] = useState(
    CHAT_SCROLL_BOTTOM_MIN_PX
  );
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const { modelType } = useAuthStore();
  const [useCloudModelInDev, setUseCloudModelInDev] = useState(false);
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const share_token = searchParams.get('share_token');
  const skill_prompt = searchParams.get('skill_prompt');

  const [taskTime, setTaskTime] = useState(
    chatStore?.getFormattedTaskTime(chatStore?.activeTaskId as string) ||
      '00:00'
  );
  const [loading, setLoading] = useState(false);
  const [isReplayLoading, setIsReplayLoading] = useState(false);
  const [isPauseResumeLoading, setIsPauseResumeLoading] = useState(false);

  const activeTaskId = chatStore?.activeTaskId;
  const activeAsk = chatStore?.tasks[activeTaskId as string]?.activeAsk;

  useEffect(() => {
    if (
      import.meta.env.VITE_USE_LOCAL_PROXY === 'true' &&
      modelType === 'cloud'
    ) {
      setUseCloudModelInDev(true);
    } else {
      setUseCloudModelInDev(false);
    }
  }, [modelType]);

  useEffect(() => {
    if (workspaceChatFocusRequestId === 0) return;
    const focusTimer = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 180);
    return () => clearTimeout(focusTimer);
  }, [workspaceChatFocusRequestId]);

  const checkModelConfig = useCallback(async () => {
    try {
      if (modelType === 'cloud') {
        const res = await proxyFetchGet('/api/v1/user/key');
        setHasModel(!!res.value);
      } else if (modelType === 'local' || modelType === 'custom') {
        const res = await proxyFetchGet('/api/v1/providers', { prefer: true });
        const providerList = res.items || [];
        setHasModel(providerList.length > 0);
      } else {
        setHasModel(false);
      }
    } catch (err) {
      console.error('Failed to check model config:', err);
      setHasModel(false);
    } finally {
      setIsConfigLoaded(true);
    }
  }, [modelType]);

  useEffect(() => {
    proxyFetchGet('/api/configs').catch((err) =>
      console.error('Failed to fetch configs:', err)
    );
    checkModelConfig();
  }, [modelType, checkModelConfig]);

  useEffect(() => {
    if (location.pathname === '/') {
      checkModelConfig();
    }
  }, [location.pathname, checkModelConfig]);

  useEffect(() => {
    const handleFocus = () => {
      checkModelConfig();
    };
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [checkModelConfig]);

  useEffect(() => {
    if (!chatStore?.activeTaskId) return;
    const interval = setInterval(() => {
      if (chatStore.activeTaskId) {
        setTaskTime(chatStore.getFormattedTaskTime(chatStore.activeTaskId));
      }
    }, 500);
    return () => clearInterval(interval);
  }, [chatStore?.activeTaskId, chatStore]);

  useEffect(() => {
    if (!chatStore) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (activeAsk && activeAsk !== '') {
      const _taskId = chatStore.activeTaskId as string;
      timer = setTimeout(() => {
        handleSendRef.current?.('skip', _taskId);
      }, 30000);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [activeAsk, chatStore, activeTaskId]);

  const getAllChatStoresMemoized = useMemo(() => {
    if (!projectStore.activeProjectId) return [];
    return projectStore.getAllChatStores(projectStore.activeProjectId);
  }, [projectStore]);

  const hasAnyMessages = useMemo(() => {
    if (!chatStore) return false;
    if (chatStore.activeTaskId && chatStore.tasks[chatStore.activeTaskId]) {
      const activeTask = chatStore.tasks[chatStore.activeTaskId];
      if (
        (activeTask.messages && activeTask.messages.length > 0) ||
        activeTask.hasMessages
      ) {
        return true;
      }
    }
    return getAllChatStoresMemoized.some(({ chatStore: store }) => {
      const state = store.getState();
      return (
        state.activeTaskId &&
        state.tasks[state.activeTaskId] &&
        (state.tasks[state.activeTaskId].messages.length > 0 ||
          state.tasks[state.activeTaskId].hasMessages)
      );
    });
  }, [chatStore, getAllChatStoresMemoized]);

  useLayoutEffect(() => {
    if (
      !measureScrollBottomInset ||
      !chatStore?.activeTaskId ||
      !hasAnyMessages
    )
      return;

    const el = bottomBoxOverlayRef.current;
    if (!el) return;

    const measure = () => {
      const raw = el.getBoundingClientRect().height;
      setScrollBottomInsetPx(
        Math.max(
          CHAT_SCROLL_BOTTOM_MIN_PX,
          Math.round(raw) + CHAT_SCROLL_BOTTOM_GAP_PX
        )
      );
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [
    chatStore?.activeTaskId,
    hasAnyMessages,
    measureScrollBottomInset,
    bottomBoxOverlayRef,
  ]);

  const isTaskBusy = useMemo(() => {
    if (!chatStore?.activeTaskId || !chatStore.tasks[chatStore.activeTaskId])
      return false;
    const task = chatStore.tasks[chatStore.activeTaskId];

    return (
      task.status === ChatTaskStatus.RUNNING ||
      task.status === ChatTaskStatus.PAUSE ||
      task.messages.some(
        (m) => m.step === AgentStep.TO_SUB_TASKS && !m.isConfirm
      ) ||
      ((task.status as string) !== ChatTaskStatus.FINISHED &&
        (task.status as string) !== ChatTaskStatus.RUNNING &&
        !task.messages.find((m) => m.step === AgentStep.TO_SUB_TASKS) &&
        !task.hasWaitComfirm &&
        task.messages.length > 0) ||
      task.isTakeControl
    );
  }, [chatStore?.activeTaskId, chatStore?.tasks]);

  const isInputDisabled = useMemo(() => {
    if (!chatStore?.activeTaskId || !chatStore.tasks[chatStore.activeTaskId])
      return true;

    const task = chatStore.tasks[chatStore.activeTaskId];

    if (task.activeAsk) return false;

    if (isTaskBusy) return true;

    if (!hasModel) return true;
    if (useCloudModelInDev) return true;
    if (task.isContextExceeded) return true;

    return false;
  }, [
    chatStore?.activeTaskId,
    chatStore?.tasks,
    hasModel,
    useCloudModelInDev,
    isTaskBusy,
  ]);

  const handleSendShare = useCallback(
    async (token: string) => {
      if (!chatStore) return;
      if (!token) return;
      if (!projectStore.activeProjectId) {
        console.warn("Can't send share due to no active projectId");
        return;
      }

      if (!hasModel) {
        toast.error('Please select a model first.');
        navigate('/history?tab=agents');
        return;
      }

      let _token: string = token.split('__')[0];
      let taskId: string = token.split('__')[1];
      chatStore.create(taskId, 'share');
      chatStore.setHasMessages(taskId, true);
      const res = await proxyFetchGet(`/api/chat/share/info/${_token}`);
      if (res?.question) {
        chatStore.addMessages(taskId, {
          id: generateUniqueId(),
          role: 'user',
          content: res.question.split('|')[0],
        });
        try {
          await chatStore.startTask(taskId, 'share', _token, 0.1);
          chatStore.setActiveTaskId(taskId);
          chatStore.handleConfirmTask(
            projectStore.activeProjectId,
            taskId,
            'share'
          );
        } catch (err: any) {
          console.error('Failed to start shared task:', err);
          toast.error(
            err?.message ||
              'Failed to start task. Please check your model configuration.'
          );
        }
      }
    },
    [chatStore, projectStore.activeProjectId, hasModel, navigate]
  );

  useEffect(() => {
    if (skill_prompt) {
      setMessage(skill_prompt);
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.delete('skill_prompt');
      setSearchParams(newSearchParams, { replace: true });
    }
  }, [skill_prompt, searchParams, setSearchParams]);

  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      setTimeout(() => {
        scrollContainerRef.current!.scrollTo({
          top: scrollContainerRef.current!.scrollHeight + 20,
          behavior: 'smooth',
        });
      }, 200);
    }
  }, [scrollContainerRef]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      scrollContainer.classList.add('scrolling');
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
      scrollTimeoutRef.current = setTimeout(() => {
        scrollContainer.classList.remove('scrolling');
      }, 1000);
    };

    scrollContainer.addEventListener('scroll', handleScroll);

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll);
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }
    };
  }, [scrollContainerRef]);

  const handleSend = async (
    messageStr?: string,
    taskId?: string,
    executionId?: string
  ) => {
    if (!chatStore) return;
    const _taskId = taskId || chatStore.activeTaskId;
    if (message.trim() === '' && !messageStr) return;

    if (!hasModel) {
      toast.error('Please select a model first.');
      navigate('/history?tab=agents');
      return;
    }

    const rawMessageContent = messageStr || message;
    let tempMessageContent = rawMessageContent;
    const displayContent = tempMessageContent;

    if (executionId && projectStore.activeProjectId) {
      const project = projectStore.getProjectById(projectStore.activeProjectId);
      const isInQueue = project?.queuedMessages?.some(
        (m) => m.executionId === executionId
      );
      if (isInQueue) {
        console.warn(
          `[handleSend] Skipping message with executionId ${executionId} - already in queue, will be processed by useBackgroundTaskProcessor`
        );
        return;
      }
    }
    chatStore.setHasMessages(_taskId as string, true);
    if (!_taskId) return;

    const task = chatStore.tasks[_taskId];
    const requiresHumanReply = Boolean(task?.activeAsk);
    const isTaskBusy =
      (task.status === ChatTaskStatus.RUNNING && task.hasMessages) ||
      task.status === ChatTaskStatus.PAUSE ||
      task.messages.some(
        (m) => m.step === AgentStep.TO_SUB_TASKS && !m.isConfirm
      ) ||
      (!task.messages.find((m) => m.step === AgentStep.TO_SUB_TASKS) &&
        !task.hasWaitComfirm &&
        task.messages.length > 0 &&
        task.status !== ChatTaskStatus.FINISHED) ||
      task.isTakeControl ||
      (!!task.messages.find(
        (m) => m.step === AgentStep.TO_SUB_TASKS && !m.isConfirm
      ) &&
        task.status === ChatTaskStatus.PENDING);
    const isReplayChatStore = task?.type === 'replay';
    if (!requiresHumanReply && isTaskBusy && !isReplayChatStore) {
      toast.error(
        'Current task is in progress. Please wait for it to finish before sending a new request.',
        {
          closeButton: true,
        }
      );
      return;
    }

    if (textareaRef.current) textareaRef.current.style.height = '60px';
    try {
      if (requiresHumanReply) {
        chatStore.addMessages(_taskId, {
          id: generateUniqueId(),
          role: 'user',
          content: displayContent,
          attaches:
            JSON.parse(JSON.stringify(chatStore.tasks[_taskId]?.attaches)) ||
            [],
        });
        setMessage('');

        setTimeout(() => {
          scrollToBottom();
        }, 200);

        chatStore.setIsPending(_taskId, true);

        await fetchPost(`/chat/${projectStore.activeProjectId}/human-reply`, {
          agent: chatStore.tasks[_taskId].activeAsk,
          reply: tempMessageContent,
        });
        chatStore.setAttaches(_taskId, []);
        if (chatStore.tasks[_taskId].askList.length === 0) {
          chatStore.setActiveAsk(_taskId, '');
        } else {
          let activeAskList = chatStore.tasks[_taskId].askList;
          let message = activeAskList.shift();
          chatStore.setActiveAskList(_taskId, [...activeAskList]);
          chatStore.setActiveAsk(_taskId, message?.agent_name || '');
          chatStore.setIsPending(_taskId, false);
          chatStore.addMessages(_taskId, message!);
        }
      } else {
        const hasMessages =
          chatStore.tasks[_taskId as string].messages.length > 0;
        const isFinished =
          chatStore.tasks[_taskId as string].status === 'finished';
        const hasWaitComfirm =
          chatStore.tasks[_taskId as string]?.hasWaitComfirm;

        const wasTaskStopped =
          isFinished &&
          !chatStore.tasks[_taskId as string].messages.some(
            (m) => m.step === 'end'
          );

        const shouldContinueConversation =
          (hasWaitComfirm && !wasTaskStopped) ||
          (isFinished && !wasTaskStopped) ||
          (hasMessages &&
            chatStore.tasks[_taskId as string].status ===
              ChatTaskStatus.PENDING);

        if (shouldContinueConversation) {
          const hasSimpleResponse = chatStore.tasks[
            _taskId as string
          ].messages.some((m) => m.step === 'wait_confirm');
          const hasComplexTask = chatStore.tasks[
            _taskId as string
          ].messages.some((m) => m.step === 'to_sub_tasks');
          const hasErrorMessage = chatStore.tasks[
            _taskId as string
          ].messages.some(
            (m) => m.role === 'agent' && m.content.startsWith('❌ **Error**:')
          );

          if (
            (chatStore.tasks[_taskId as string].status ===
              ChatTaskStatus.PENDING &&
              !hasSimpleResponse &&
              !hasComplexTask &&
              !isFinished) ||
            chatStore.tasks[_taskId].type === 'replay' ||
            hasErrorMessage
          ) {
            setMessage('');
            const attachesToSend =
              JSON.parse(JSON.stringify(chatStore.tasks[_taskId]?.attaches)) ||
              [];
            try {
              await chatStore.startTask(
                _taskId,
                undefined,
                undefined,
                undefined,
                tempMessageContent,
                attachesToSend,
                executionId
              );
              chatStore.setAttaches(_taskId, []);
            } catch (err: any) {
              console.error('Failed to start task:', err);
              toast.error(
                err?.message ||
                  'Failed to start task. Please check your model configuration.'
              );
              return;
            }
          } else {
            const attachesForThisTurn = JSON.parse(
              JSON.stringify(chatStore.tasks[_taskId]?.attaches || [])
            );
            const improveAttaches =
              attachesForThisTurn.map(
                (f: { filePath: string }) => f.filePath
              ) || [];

            const nextTaskId = generateUniqueId();
            chatStore.setNextTaskId(nextTaskId);
            chatStore.setNextExecutionId(_taskId as string, executionId);

            fetchPost(`/chat/${projectStore.activeProjectId}`, {
              question: tempMessageContent,
              task_id: nextTaskId,
              attaches: improveAttaches,
              target: undefined,
            });
            chatStore.setIsPending(_taskId, true);
            chatStore.addMessages(_taskId, {
              id: generateUniqueId(),
              role: 'user',
              content: displayContent,
              attaches: attachesForThisTurn,
            });
            chatStore.setAttaches(_taskId, []);
            setMessage('');
          }
        } else {
          setTimeout(() => {
            scrollToBottom();
          }, 200);

          const attachesToSend =
            JSON.parse(JSON.stringify(chatStore.tasks[_taskId]?.attaches)) ||
            [];
          setMessage('');
          try {
            await chatStore.startTask(
              _taskId,
              undefined,
              undefined,
              undefined,
              tempMessageContent,
              attachesToSend,
              executionId
            );
            chatStore.setHasWaitComfirm(_taskId as string, true);
            chatStore.setAttaches(_taskId, []);
          } catch (err: any) {
            console.error('Failed to start task:', err);
            toast.error(
              err?.message ||
                'Failed to start task. Please check your model configuration.'
            );
            return;
          }
        }
      }
    } catch (error) {
      console.error('error:', error);
    }
  };

  handleSendRef.current = handleSend;

  const queuedMessages = useMemo(() => {
    const pid = projectStore.activeProjectId;
    if (!pid) return [];
    const project = projectStore.getProjectById(pid);
    return (project?.queuedMessages || []).map((m) => ({
      id: m.task_id,
      content: m.content,
      timestamp: m.timestamp,
    }));
  }, [projectStore]);

  useEffect(() => {
    if (share_token) {
      handleSendShare(share_token);
    }
  }, [share_token, handleSendShare]);

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const activeProjectId = projectStore.activeProjectId;
      if (!activeProjectId) return;

      for (const file of Array.from(files)) {
        try {
          const reader = new FileReader();
          reader.onload = async () => {
            if (reader.result && window.ipcRenderer) {
              await window.ipcRenderer.invoke('save-file-to-agent-folder', {
                projectId: activeProjectId,
                fileName: file.name,
                content: reader.result,
              });
              setHasAgentFiles(true);
              if (activeWorkspaceTab !== 'inbox') {
                markTabAsUnviewed('inbox', activeProjectId);
              }
            }
          };
          reader.onerror = () => {
            console.error('Error reading file:', file.name, reader.error);
          };
          reader.readAsArrayBuffer(file);
        } catch (error) {
          console.error('Error uploading file:', error);
        }
      }

      e.target.value = '';
    },
    [projectStore, setHasAgentFiles, markTabAsUnviewed, activeWorkspaceTab]
  );

  const handleConfirmTask = async (taskId?: string) => {
    if (!chatStore) return;
    const _taskId = taskId || chatStore.activeTaskId;
    if (!_taskId || !projectStore.activeProjectId) {
      return;
    }
    setLoading(true);
    await chatStore.handleConfirmTask(projectStore.activeProjectId, _taskId);
    setLoading(false);
  };

  const handleFileSelect = async () => {
    if (!chatStore) return;
    try {
      const result = await window.electronAPI.selectFile({
        title: t('chat.select-file'),
        filters: [{ name: t('chat.all-files'), extensions: ['*'] }],
      });

      if (result.success && result.files && result.files.length > 0) {
        const taskId = chatStore.activeTaskId as string;
        const files = [
          ...(chatStore.tasks[taskId].attaches || []),
          ...result.files.filter(
            (r: File) =>
              !chatStore.tasks[taskId].attaches?.some(
                (f: File) => f.filePath === r.filePath
              )
          ),
        ];
        chatStore.setAttaches(taskId, files);
      }
    } catch (error) {
      console.error('Select File Error:', error);
    }
  };

  const handleReplay = async () => {
    if (!chatStore) return;
    setIsReplayLoading(true);
    await replayActiveTask(chatStore, projectStore, navigate);
    setIsReplayLoading(false);
  };

  const handlePauseResume = () => {
    if (!chatStore) return;
    const taskId = chatStore.activeTaskId as string;
    const task = chatStore.tasks[taskId];
    const type = task.status === 'running' ? 'pause' : 'resume';

    setIsPauseResumeLoading(true);
    if (type === 'pause') {
      let { taskTime, elapsed } = task;
      const now = Date.now();
      elapsed += now - taskTime;
      chatStore.setElapsed(taskId, elapsed);
      chatStore.setTaskTime(taskId, 0);
      chatStore.setStatus(taskId, 'pause');
    } else {
      chatStore.setTaskTime(taskId, Date.now());
      chatStore.setStatus(taskId, 'running');
    }

    fetchPut(`/task/${projectStore.activeProjectId}/take-control`, {
      action: type,
    });
    setIsPauseResumeLoading(false);
  };

  const handleSkip = async () => {
    if (!chatStore) return;
    const taskId = chatStore.activeTaskId as string;
    setIsPauseResumeLoading(true);

    try {
      await fetchPost(`/chat/${projectStore.activeProjectId}/skip-task`, {
        project_id: projectStore.activeProjectId,
      });

      chatStore.setIsPending(taskId, false);

      toast.success('Task stopped successfully', {
        closeButton: true,
      });
    } catch (error) {
      console.error('[STOP-BUTTON] ❌ Failed to stop task:', error);

      try {
        chatStore.stopTask(taskId);
        chatStore.setIsPending(taskId, false);
        toast.warning(
          'Task stopped locally, but backend notification failed. Backend task may continue running.',
          {
            closeButton: true,
            duration: 5000,
          }
        );
      } catch (localError) {
        console.error(
          '[STOP-BUTTON] ❌ Failed to stop task locally:',
          localError
        );
        toast.error(
          'Failed to stop task completely. Please refresh the page.',
          {
            closeButton: true,
          }
        );
      }
    } finally {
      setIsPauseResumeLoading(false);
    }
  };

  const handleEditQuery = async () => {
    if (!chatStore) return;
    const taskId = chatStore.activeTaskId as string;
    const projectId = projectStore.activeProjectId;

    if (!projectId) {
      console.error('No active project ID found for edit operation');
      return;
    }

    const messageIndex = chatStore.tasks[taskId].messages.findLastIndex(
      (item) => item.step === 'to_sub_tasks'
    );
    const questionMessage = chatStore.tasks[taskId].messages[messageIndex - 2];
    const question = questionMessage.content;
    const attachments = questionMessage.attaches || [];

    try {
      await fetchDelete(`/chat/${projectId}`);
    } catch (error) {
      console.error('Failed to delete task from backend:', error);
    }

    const history_id = projectStore.getHistoryId(projectId);
    if (history_id) {
      try {
        await proxyFetchDelete(`/api/chat/history/${history_id}`);
      } catch (error) {
        console.error(
          `Failed to delete chat history (ID: ${history_id}) for project ${projectId}:`,
          error
        );
      }
    } else {
      console.warn(
        `No history ID found for project ${projectId} during edit operation`
      );
    }

    let id = chatStore.create();
    chatStore.setHasMessages(id, true);
    if (attachments.length > 0) {
      chatStore.setAttaches(id, attachments);
    }
    chatStore.removeTask(taskId);
    setMessage(question);
  };

  const getBottomBoxState = (): BottomBoxState => {
    if (!chatStore?.activeTaskId) return 'input';
    const task = chatStore.tasks[chatStore.activeTaskId];

    const anyToSubTasksMessage = task.messages.find(
      (m) => m.step === 'to_sub_tasks'
    );
    const toSubTasksMessage = task.messages.find(
      (m) => m.step === 'to_sub_tasks' && !m.isConfirm
    );

    const isSkeletonPhase =
      (task.status !== ChatTaskStatus.FINISHED &&
        task.status !== ChatTaskStatus.RUNNING &&
        !anyToSubTasksMessage &&
        !task.hasWaitComfirm &&
        task.messages.length > 0) ||
      (task.isTakeControl && !anyToSubTasksMessage);
    if (isSkeletonPhase) {
      return 'splitting';
    }

    if (
      toSubTasksMessage &&
      !toSubTasksMessage.isConfirm &&
      task.status === 'pending'
    ) {
      return 'confirm';
    }

    if (toSubTasksMessage && !toSubTasksMessage.isConfirm) {
      return 'splitting';
    }

    if (task.status === ChatTaskStatus.PAUSE) {
      return 'running';
    }
    if (task.status === ChatTaskStatus.RUNNING) {
      const hasSubTasks = task.messages.some(
        (m) => m.step === AgentStep.TO_SUB_TASKS
      );
      const isDirectMode =
        !hasSubTasks && (task.taskAssigning?.length ?? 0) > 0;
      return isDirectMode ? 'input' : 'running';
    }

    if (task.status === 'finished' && task.type !== '') {
      return 'finished';
    }

    return 'input';
  };

  const handleRemoveTaskQueue = async (task_id: string) => {
    const project_id = projectStore.activeProjectId;
    if (!project_id) {
      console.error('No active project ID found');
      return;
    }

    const removed = projectStore.removeQueuedMessage(project_id, task_id);
    if (!removed || !removed.task_id) {
      console.error(`Task with id ${task_id} not found in project queue`);
      return;
    }

    try {
      if (removed.executionId) {
        await proxyUpdateTriggerExecution(
          removed.executionId,
          {
            status: ExecutionStatus.Cancelled,
            error_message: 'Task was removed from queue by user.',
          },
          {
            projectId: project_id,
          }
        );
      }

      console.log(`[ChatBox] Task ${task_id} cancelled successfully`);
    } catch (error) {
      console.error(`[ChatBox] Failed to cancel task ${task_id}:`, error);
      projectStore.restoreQueuedMessage(project_id, removed);
      toast.error('Failed to cancel task', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  return {
    chatStore,
    projectStore,
    message,
    setMessage,
    textareaRef,
    taskTime,
    loading,
    isReplayLoading,
    isPauseResumeLoading,
    hasModel,
    isConfigLoaded,
    useCloudModelInDev,
    queuedMessages,
    handleRemoveTaskQueue,
    getBottomBoxState,
    handleSend,
    handleConfirmTask,
    handleFileSelect,
    handlePauseResume,
    handleEditQuery,
    handleReplay,
    handleSkip,
    isInputDisabled,
    scrollBottomInsetPx,
    hasAnyMessages,
    handleFileUpload,
    fileInputRef,
    checkModelConfig,
  };
}
