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
  proxyFetchPut,
} from '@/api/http';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { generateUniqueId, replayActiveTask } from '@/lib';
import { proxyUpdateTriggerExecution } from '@/service/triggerApi';
import { useAuthStore } from '@/store/authStore';
import { useTriggerTaskStore } from '@/store/triggerTaskStore';
import { ExecutionStatus } from '@/types';
import { AgentStep, ChatTaskStatus } from '@/types/constants';
import { TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import BottomBox from './BottomBox';
import { HeaderBox } from './HeaderBox';
import { ProjectChatContainer } from './ProjectChatContainer';

export default function ChatBox(): JSX.Element {
  const [message, setMessage] = useState<string>('');

  //Get Chatstore for the active project's task
  const { chatStore, projectStore } = useChatStoreAdapter();
  if (!chatStore) {
    return <div>Loading...</div>;
  }

  // Subscribe to triggerTaskStore for queue management
  const triggerTaskStoreState = useTriggerTaskStore();

  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Track which trigger task we've already started processing to avoid duplicate sends
  const processedTriggerTaskRef = useRef<string | null>(null);
  const [privacy, setPrivacy] = useState<any>(false);
  const [hasSearchKey, setHasSearchKey] = useState<any>(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // const [privacyDialogOpen, setPrivacyDialogOpen] = useState(false);
  const { modelType } = useAuthStore();
  const [useCloudModelInDev, setUseCloudModelInDev] = useState(false);
  useEffect(() => {
    // Only show warning message, don't block functionality
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
    proxyFetchGet('/api/user/privacy')
      .then((res) => {
        let _privacy = 0;
        Object.keys(res).forEach((key) => {
          if (!res[key]) {
            _privacy++;
            return;
          }
        });
        setPrivacy(_privacy === 0 ? true : false);
      })
      .catch((err) => console.error('Failed to fetch settings:', err));

    proxyFetchGet('/api/configs')
      .then((configsRes) => {
        const configs = Array.isArray(configsRes) ? configsRes : [];
        const _hasApiKey = configs.find(
          (item) => item.config_name === 'GOOGLE_API_KEY'
        );
        const _hasApiId = configs.find(
          (item) => item.config_name === 'SEARCH_ENGINE_ID'
        );
        if (_hasApiKey && _hasApiId) setHasSearchKey(true);
      })
      .catch((err) => console.error('Failed to fetch configs:', err));
  }, []);

  // Refresh privacy status when dialog closes
  // useEffect(() => {
  // 	if (!privacyDialogOpen) {
  // 		proxyFetchGet("/api/user/privacy")
  // 			.then((res) => {
  // 				let _privacy = 0;
  // 				Object.keys(res).forEach((key) => {
  // 					if (!res[key]) {
  // 						_privacy++;
  // 						return;
  // 					}
  // 				});
  // 				setPrivacy(_privacy === 0 ? true : false);
  // 			})
  // 			.catch((err) => console.error("Failed to fetch settings:", err));
  // 	}
  // }, [privacyDialogOpen]);
  const [searchParams, setSearchParams] = useSearchParams();
  const share_token = searchParams.get('share_token');
  const skill_prompt = searchParams.get('skill_prompt');

  const handleSendRef = useRef<
    ((messageStr?: string, taskId?: string) => Promise<void>) | null
  >(null);

  const navigate = useNavigate();

  // Task time tracking
  const [taskTime, setTaskTime] = useState(
    chatStore?.getFormattedTaskTime(chatStore?.activeTaskId as string) ||
      '00:00'
  );

  const [_hasSubTask, setHasSubTask] = useState(false);

  const activeTaskId = chatStore?.activeTaskId;
  const activeTaskMessages = chatStore?.tasks[activeTaskId as string]?.messages;
  const activeAsk = chatStore?.tasks[activeTaskId as string]?.activeAsk;

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
    const _hasSubTask = chatStore.tasks[
      chatStore.activeTaskId as string
    ]?.messages?.find((message) => message.step === AgentStep.TO_SUB_TASKS)
      ? true
      : false;
    setHasSubTask(_hasSubTask);
  }, [chatStore, activeTaskId, activeTaskMessages]);

  useEffect(() => {
    if (!chatStore) return;
    const _activeAsk = activeAsk;
    let timer: NodeJS.Timeout;
    if (_activeAsk && _activeAsk !== '') {
      const _taskId = chatStore.activeTaskId as string;
      timer = setTimeout(() => {
        if (handleSendRef.current) {
          handleSendRef.current('skip', _taskId);
        }
      }, 30000); // 30 seconds
      return () => clearTimeout(timer); // clear previous timer
    }
    // if activeAsk is empty, also clear timer
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [activeAsk, message, chatStore, activeTaskId]);

  const getAllChatStoresMemoized = useMemo(() => {
    if (!projectStore.activeProjectId) return [];
    return projectStore.getAllChatStores(projectStore.activeProjectId);
  }, [projectStore]);

  // Check if any chat store in the project has messages
  const hasAnyMessages = useMemo(() => {
    if (!chatStore) return false;
    // First check current active chat store
    if (chatStore.activeTaskId && chatStore.tasks[chatStore.activeTaskId]) {
      const activeTask = chatStore.tasks[chatStore.activeTaskId];
      if (
        (activeTask.messages && activeTask.messages.length > 0) ||
        activeTask.hasMessages
      ) {
        return true;
      }
    }

    // Then check all other chat stores in the project
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

  const isTaskBusy = useMemo(() => {
    if (!chatStore?.activeTaskId || !chatStore.tasks[chatStore.activeTaskId])
      return false;
    const task = chatStore.tasks[chatStore.activeTaskId];
    return (
      // running or paused
      task.status === ChatTaskStatus.RUNNING ||
      task.status === ChatTaskStatus.PAUSE ||
      // splitting phase
      task.messages.some(
        (m) => m.step === AgentStep.TO_SUB_TASKS && !m.isConfirm
      ) ||
      // skeleton/computing phase
      (!task.messages.find((m) => m.step === AgentStep.TO_SUB_TASKS) &&
        !task.hasWaitComfirm &&
        task.messages.length > 0) ||
      task.isTakeControl
    );
  }, [chatStore?.activeTaskId, chatStore?.tasks]);

  const isInputDisabled = useMemo(() => {
    if (!chatStore?.activeTaskId || !chatStore.tasks[chatStore.activeTaskId])
      return true;

    const task = chatStore.tasks[chatStore.activeTaskId];

    // If ask human is active, allow input
    if (task.activeAsk) return false;

    if (isTaskBusy) return true;

    // Standard checks - check model first, then privacy
    if (!privacy) return true;
    if (useCloudModelInDev) return true;
    if (task.isContextExceeded) return true;

    return false;
  }, [
    chatStore?.activeTaskId,
    chatStore?.tasks,
    privacy,
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

      if (!privacy) {
        toast.error('Please accept the privacy policy first.');
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
    [chatStore, projectStore.activeProjectId, privacy, navigate]
  );

  useEffect(() => {
    // Wait for both config and privacy to be loaded before handling share token
    if (share_token) {
      handleSendShare(share_token);
    }
  }, [share_token, handleSendShare]);

  // Handle skill_prompt from URL - pre-fill message when navigating from Skills page
  useEffect(() => {
    if (skill_prompt) {
      setMessage(skill_prompt);
      // Clear the skill_prompt param from URL after setting the message
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.delete('skill_prompt');
      setSearchParams(newSearchParams, { replace: true });
    }
  }, [skill_prompt, searchParams, setSearchParams]);

  useEffect(() => {
    if (!chatStore) return;
    console.log('ChatStore Data: ', chatStore);
  }, [chatStore]);

  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      setTimeout(() => {
        scrollContainerRef.current!.scrollTo({
          top: scrollContainerRef.current!.scrollHeight + 20,
          behavior: 'smooth',
        });
      }, 200);
    }
  }, []);

  // Handle scrollbar visibility on scroll
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      // Add scrolling class
      scrollContainer.classList.add('scrolling');

      // Clear existing timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current);
      }

      // Remove scrolling class after 1 second of no scrolling
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
  }, []);

  if (!chatStore) {
    return <div>Loading...</div>;
  }

  const handleSend = async (
    messageStr?: string,
    taskId?: string,
    executionId?: string
  ) => {
    const _taskId = taskId || chatStore.activeTaskId;
    if (message.trim() === '' && !messageStr) return;
    const tempMessageContent = messageStr || message;
    chatStore.setHasMessages(_taskId as string, true);
    if (!_taskId) return;

    // Multi-turn support: Check if task is running or planning (splitting/confirm)
    const task = chatStore.tasks[_taskId];
    const requiresHumanReply = Boolean(task?.activeAsk);
    const isTaskInProgress = ['running', 'pause'].includes(task?.status || '');
    const isTaskBusy =
      // running or paused counts as busy
      (task.status === 'running' && task.hasMessages) ||
      task.status === 'pause' ||
      // splitting phase: has to_sub_tasks not confirmed OR skeleton computing
      task.messages.some(
        (m) => m.step === AgentStep.TO_SUB_TASKS && !m.isConfirm
      ) ||
      (!task.messages.find((m) => m.step === AgentStep.TO_SUB_TASKS) &&
        !task.hasWaitComfirm &&
        task.messages.length > 0) ||
      task.isTakeControl ||
      // explicit confirm wait while task is pending but card not confirmed yet
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
          content: tempMessageContent,
          attaches:
            JSON.parse(JSON.stringify(chatStore.tasks[_taskId]?.attaches)) ||
            [],
        });
        setMessage('');

        // Scroll to bottom after adding user message
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
          console.log(
            'activeAskList',
            JSON.parse(JSON.stringify(activeAskList))
          );
          let message = activeAskList.shift();
          chatStore.setActiveAskList(_taskId, [...activeAskList]);
          chatStore.setActiveAsk(_taskId, message?.agent_name || '');
          chatStore.setIsPending(_taskId, false);
          chatStore.addMessages(_taskId, message!);
        }
      } else {
        // Check if we should continue the conversation or start a new task
        const hasMessages =
          chatStore.tasks[_taskId as string].messages.length > 0;
        const isFinished =
          chatStore.tasks[_taskId as string].status === 'finished';
        const hasWaitComfirm =
          chatStore.tasks[_taskId as string]?.hasWaitComfirm;

        // Check if this task was manually stopped (finished but without natural completion)
        const wasTaskStopped =
          isFinished &&
          !chatStore.tasks[_taskId as string].messages.some(
            (m) => m.step === 'end' // Natural completion has an "end" step message
          );

        // Continue conversation if:
        // 1. Has wait confirm (simple query response) - but not if task was stopped
        // 2. Task is naturally finished (complex task completed) - but not if task was stopped
        // 3. Has any messages but pending (ongoing conversation)
        const shouldContinueConversation =
          (hasWaitComfirm && !wasTaskStopped) ||
          (isFinished && !wasTaskStopped) ||
          (hasMessages &&
            chatStore.tasks[_taskId as string].status ===
              ChatTaskStatus.PENDING);

        if (shouldContinueConversation) {
          // Check if this is the very first message and task hasn't started
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

          // Only start a new task if: pending, no messages processed yet
          // OR while or after replaying a project
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
            // Pass the message content to startTask instead of adding it to current chatStore
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
            // keep hasWaitComfirm as true so that follow-up improves work as usual
          } else {
            // Continue conversation: simple response, complex task, or finished task
            console.log(
              '[Multi-turn] Continuing conversation with improve API'
            );

            const attachesForThisTurn = JSON.parse(
              JSON.stringify(chatStore.tasks[_taskId]?.attaches || [])
            );
            const improveAttaches =
              attachesForThisTurn.map(
                (f: { filePath: string }) => f.filePath
              ) || [];

            //Generate nextId in case new chatStore is created to sync with the backend beforehand
            const nextTaskId = generateUniqueId();
            chatStore.setNextTaskId(nextTaskId);
            chatStore.setNextExecutionId(taskId as string, executionId);

            // Use improve endpoint (POST /chat/{id}) - {id} is project_id
            fetchPost(`/chat/${projectStore.activeProjectId}`, {
              question: tempMessageContent,
              task_id: nextTaskId,
              attaches: improveAttaches,
            });
            chatStore.setIsPending(_taskId, true);
            chatStore.addMessages(_taskId, {
              id: generateUniqueId(),
              role: 'user',
              content: tempMessageContent,
              attaches: attachesForThisTurn,
            });
            chatStore.setAttaches(_taskId, []);
            setMessage('');
          }
        } else {
          if (!privacy) {
            const API_FIELDS = [
              'take_screenshot',
              'access_local_software',
              'access_your_address',
              'password_storage',
            ];
            const requestData = {
              [API_FIELDS[0]]: true,
              [API_FIELDS[1]]: true,
              [API_FIELDS[2]]: true,
              [API_FIELDS[3]]: true,
            };
            proxyFetchPut('/api/user/privacy', requestData);
            setPrivacy(true);
          }

          setTimeout(() => {
            scrollToBottom();
          }, 200);

          // For the very first message, add it to the current chatStore first, then call startTask
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

  const [loading, setLoading] = useState(false);
  const handleConfirmTask = async (taskId?: string) => {
    const _taskId = taskId || chatStore.activeTaskId;
    if (!_taskId || !projectStore.activeProjectId) {
      return;
    }
    setLoading(true);
    await chatStore.handleConfirmTask(projectStore.activeProjectId, _taskId);
    setLoading(false);
  };

  // File selection handler
  const handleFileSelect = async () => {
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

  // Replay handler
  const [isReplayLoading, setIsReplayLoading] = useState(false);
  const handleReplay = async () => {
    setIsReplayLoading(true);
    await replayActiveTask(chatStore, projectStore, navigate);
    setIsReplayLoading(false);
  };

  // Pause/Resume handler
  const [isPauseResumeLoading, setIsPauseResumeLoading] = useState(false);
  const handlePauseResume = () => {
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

  // Stop task handler - triggers Action.skip_task which preserves context
  const handleSkip = async () => {
    const taskId = chatStore.activeTaskId as string;
    console.log('='.repeat(80));
    console.log('🛑 [STOP-BUTTON] handleSkip CALLED from frontend');
    console.log(
      `[STOP-BUTTON] taskId: ${taskId}, projectId: ${projectStore.activeProjectId}`
    );
    console.log('='.repeat(80));
    setIsPauseResumeLoading(true);

    try {
      // Call skip-task endpoint to trigger Action.skip_task
      // This will stop the task gracefully while preserving context for multi-turn
      console.log(
        `[STOP-BUTTON] Sending POST request to /chat/${projectStore.activeProjectId}/skip-task`
      );
      await fetchPost(`/chat/${projectStore.activeProjectId}/skip-task`, {
        project_id: projectStore.activeProjectId,
      });
      console.log('[STOP-BUTTON] ✅ Backend skip-task request successful');

      // DO NOT call chatStore.stopTask here!
      // Keep SSE connection alive to receive "end" event from backend
      // The "end" event will set status to 'finished' and allow multi-turn conversation
      console.log(
        "[STOP-BUTTON] ⚠️  SSE connection kept alive, waiting for backend 'end' event"
      );

      // Only set isPending to false so UI shows task is stopped
      chatStore.setIsPending(taskId, false);
      console.log(
        '[STOP-BUTTON] ✅ Task marked as not pending, SSE connection remains open'
      );

      toast.success('Task stopped successfully', {
        closeButton: true,
      });
    } catch (error) {
      console.error('[STOP-BUTTON] ❌ Failed to stop task:', error);

      // If backend call failed, close SSE connection as fallback
      console.log(
        '[STOP-BUTTON] Backend call failed, closing SSE connection as fallback'
      );
      try {
        chatStore.stopTask(taskId);
        chatStore.setIsPending(taskId, false);
        console.log(
          '[STOP-BUTTON] ⚠️  SSE connection closed due to backend failure'
        );
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
      console.log('[STOP-BUTTON] handleSkip completed');
      setIsPauseResumeLoading(false);
    }
  };

  // Edit query handler
  const handleEditQuery = async () => {
    const taskId = chatStore.activeTaskId as string;
    const projectId = projectStore.activeProjectId;

    // Early validation
    if (!projectId) {
      console.error('No active project ID found for edit operation');
      return;
    }

    // Get question and attachments before any deletions
    const messageIndex = chatStore.tasks[taskId].messages.findLastIndex(
      (item) => item.step === 'to_sub_tasks'
    );
    const questionMessage = chatStore.tasks[taskId].messages[messageIndex - 2];
    const question = questionMessage.content;
    // Get the file attachments from the original user message (not from task.attaches which gets cleared after sending)
    const attachments = questionMessage.attaches || [];

    // Delete task from backend first
    try {
      await fetchDelete(`/chat/${projectId}`);
    } catch (error) {
      console.error('Failed to delete task from backend:', error);
      // Continue with local cleanup even if backend fails
    }

    // Delete chat history
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

    // Create new task and clean up locally
    let id = chatStore.create();
    chatStore.setHasMessages(id, true);
    // Copy the file attachments to the new task
    if (attachments.length > 0) {
      chatStore.setAttaches(id, attachments);
    }
    chatStore.removeTask(taskId);
    setMessage(question);
  };

  // Determine BottomBox state
  const getBottomBoxState = () => {
    if (!chatStore.activeTaskId) return 'input';
    const task = chatStore.tasks[chatStore.activeTaskId];

    // Queued messages no longer change BottomBox state; QueuedBox renders independently

    // Check for any to_sub_tasks message (confirmed or not)
    const anyToSubTasksMessage = task.messages.find(
      (m) => m.step === 'to_sub_tasks'
    );
    const toSubTasksMessage = task.messages.find(
      (m) => m.step === 'to_sub_tasks' && !m.isConfirm
    );

    // Determine if we're in the "splitting in progress" phase (skeleton visible)
    // Only show splitting if there's NO to_sub_tasks message yet (not even confirmed)
    const isSkeletonPhase =
      (task.status !== 'finished' &&
        !anyToSubTasksMessage &&
        !task.hasWaitComfirm &&
        task.messages.length > 0) ||
      (task.isTakeControl && !anyToSubTasksMessage);
    if (isSkeletonPhase) {
      return 'splitting';
    }

    // After splitting completes and TaskCard is awaiting user confirmation,
    // the Task becomes 'pending' and we show the confirm state.
    if (
      toSubTasksMessage &&
      !toSubTasksMessage.isConfirm &&
      task.status === 'pending'
    ) {
      return 'confirm';
    }

    // If subtasks exist but not yet confirmed while task is still running, keep showing splitting
    if (toSubTasksMessage && !toSubTasksMessage.isConfirm) {
      return 'splitting';
    }

    // Check task status
    if (
      task.status === ChatTaskStatus.RUNNING ||
      task.status === ChatTaskStatus.PAUSE
    ) {
      return 'running';
    }

    if (task.status === 'finished' && task.type !== '') {
      return 'finished';
    }

    return 'input';
  };

  useEffect(() => {
    const _hasSubTask = chatStore.tasks[
      chatStore.activeTaskId as string
    ]?.messages?.find((message) => message.step === 'to_sub_tasks')
      ? true
      : false;
    setHasSubTask(_hasSubTask);
  }, [chatStore?.tasks[chatStore.activeTaskId as string]?.messages]);

  // Process queued messages when task is idle
  // This handles messages added by triggers (useTriggerTaskExecutor)
  // Check currentTask first (already dequeued by useTriggerTaskExecutor), then pending tasks
  useEffect(() => {
    if (!projectStore.activeProjectId) return;

    // First, check if there's a currentTask that matches our project and needs processing
    // The currentTask is set by useTriggerTaskExecutor.executeTask after dequeuing
    const currentTask = triggerTaskStoreState.currentTask;
    const hasCurrentTaskForProject =
      currentTask &&
      currentTask.projectId === projectStore.activeProjectId &&
      currentTask.status === ExecutionStatus.Running;

    // Also check for pending tasks in queue (fallback)
    const pendingTasks = triggerTaskStoreState.taskQueue.filter(
      (t) =>
        t.projectId === projectStore.activeProjectId &&
        t.status === ExecutionStatus.Pending
    );

    // No tasks to process
    if (!hasCurrentTaskForProject && pendingTasks.length === 0) return;

    const taskId = chatStore.activeTaskId;
    if (!taskId) return;

    const task = chatStore.tasks[taskId];
    if (!task) return;

    // Check if task is idle (not busy)
    const isTaskBusy =
      task.status === 'running' ||
      task.status === 'pause' ||
      task.isPending ||
      task.messages.some((m) => m.step === 'to_sub_tasks' && !m.isConfirm) ||
      (!task.messages.find((m) => m.step === 'to_sub_tasks') &&
        !task.hasWaitComfirm &&
        task.messages.length > 0) ||
      task.isTakeControl;

    // Only process if task is idle
    if (isTaskBusy) return;

    // Use currentTask if available, otherwise dequeue from pending
    let taskToProcess: typeof currentTask;
    if (hasCurrentTaskForProject) {
      // Skip if we've already started processing this trigger task
      // This prevents duplicate sends on re-renders while the task is still running
      if (processedTriggerTaskRef.current === currentTask.id) {
        console.log(
          '[ChatBox] Skipping already-processed currentTask:',
          currentTask.id
        );
        return;
      }
      taskToProcess = currentTask;
      console.log(
        '[ChatBox] Processing currentTask:',
        taskToProcess.triggerName,
        taskToProcess.formattedMessage?.substring(0, 50) + '...'
      );
    } else {
      // Dequeue the task from triggerTaskStore (marks as running)
      taskToProcess = triggerTaskStoreState.dequeueTask();
      if (!taskToProcess) return;

      // Skip if we've already started processing this trigger task
      if (processedTriggerTaskRef.current === taskToProcess.id) {
        console.log(
          '[ChatBox] Skipping already-processed queued task:',
          taskToProcess.id
        );
        return;
      }
      console.log(
        '[ChatBox] Processing queued task:',
        taskToProcess.triggerName,
        taskToProcess.formattedMessage?.substring(0, 50) + '...'
      );
    }

    // Mark this trigger task as being processed to prevent duplicate sends
    processedTriggerTaskRef.current = taskToProcess.id;

    // Register execution mapping for this task (for external tracking)
    if (taskToProcess.executionId && projectStore.activeProjectId) {
      const targetTaskId = chatStore.nextTaskId || taskId;

      triggerTaskStoreState.registerExecutionMapping(
        targetTaskId,
        taskToProcess.executionId,
        taskToProcess.id,
        projectStore.activeProjectId
      );
    }

    // Process the queued message via handleSend
    // Pass executionId so startTask can set it on the new task
    const messageContent =
      taskToProcess.formattedMessage || taskToProcess.taskPrompt;
    handleSend(messageContent, undefined, taskToProcess.executionId);
  }, [
    projectStore.activeProjectId,
    triggerTaskStoreState.taskQueue,
    triggerTaskStoreState.currentTask,
    chatStore.activeTaskId,
    chatStore.tasks[chatStore.activeTaskId as string]?.status,
    chatStore.tasks[chatStore.activeTaskId as string]?.isPending,
    chatStore.tasks[chatStore.activeTaskId as string]?.messages?.length,
  ]);

  // Clear the processed trigger task ref when currentTask changes to null (task completed)
  // This allows processing new trigger tasks
  useEffect(() => {
    if (!triggerTaskStoreState.currentTask) {
      processedTriggerTaskRef.current = null;
    }
  }, [triggerTaskStoreState.currentTask]);

  useEffect(() => {
    const activeAsk =
      chatStore?.tasks[chatStore.activeTaskId as string]?.activeAsk;
    let timer: NodeJS.Timeout;
    if (activeAsk && activeAsk !== '') {
      const _taskId = chatStore.activeTaskId as string;
      timer = setTimeout(() => {
        handleSend('skip', _taskId);
      }, 30000); // 30 seconds
      return () => clearTimeout(timer); // clear previous timer
    }
    // if activeAsk is empty, also clear timer
    return () => {
      clearTimeout(timer);
    };
  }, [
    chatStore?.tasks[chatStore.activeTaskId as string]?.activeAsk,
    message, // depend on message
  ]);

  const handleRemoveTaskQueue = async (task_id: string) => {
    const project_id = projectStore.activeProjectId;
    if (!project_id) {
      console.error('No active project ID found');
      return;
    }

    // Find the task in triggerTaskStore
    const taskToCancel = triggerTaskStoreState.getTaskById(task_id);
    if (!taskToCancel) {
      console.error(`Task with id ${task_id} not found in trigger queue`);
      return;
    }

    try {
      // Cancel the task in triggerTaskStore
      triggerTaskStoreState.cancelTask(
        task_id,
        'Task was removed from queue by user.'
      );

      // Update the backend execution status
      await proxyUpdateTriggerExecution(
        taskToCancel.executionId,
        {
          status: ExecutionStatus.Cancelled,
          error_message: 'Task was removed from queue by user.',
        },
        {
          projectId: project_id,
        }
      );

      console.log(`[ChatBox] Task ${task_id} cancelled successfully`);
    } catch (error) {
      console.error(`[ChatBox] Failed to cancel task ${task_id}:`, error);
      toast.error('Failed to cancel task', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  };

  return (
    <div className="h-full w-full flex-none items-center justify-center overflow-hidden rounded-2xl border-solid border-border-tertiary bg-surface-secondary">
      {/* Unified ChatBox Structure */}
      <div className="relative flex h-full w-full flex-col overflow-hidden">
        {/* Header Box - Always visible */}
        {chatStore.activeTaskId && (
          <HeaderBox
            tokens={chatStore.tasks[chatStore.activeTaskId]?.tokens || 0}
            status={chatStore.tasks[chatStore.activeTaskId]?.status}
            replayLoading={isReplayLoading}
            onReplay={handleReplay}
          />
        )}

        {/* Main Content Area - Flex 1 to take remaining space */}
        <div className="relative flex flex-1 flex-col overflow-hidden">
          {/* Project Chat Container - Show when has messages (absolute, full height) */}
          <div
            className={`absolute inset-0 flex h-full flex-col transition-all duration-300 ease-in-out ${
              hasAnyMessages
                ? 'pointer-events-auto translate-y-0 opacity-100'
                : 'pointer-events-none -translate-y-4 opacity-0'
            }`}
          >
            <ProjectChatContainer
              onSkip={handleSkip}
              isPauseResumeLoading={isPauseResumeLoading}
            />
          </div>

          {/* Init State Container - Welcome + BottomBox + Suggestions (vertically centered) */}
          <div
            className={`flex flex-1 flex-col transition-all duration-300 ease-in-out ${
              hasAnyMessages
                ? 'pointer-events-none absolute inset-0 opacity-0'
                : 'pointer-events-auto opacity-100'
            }`}
          >
            {/* Welcome Message - Top area, flex-1 to push content down */}
            <div className="flex flex-1 flex-col items-center justify-end gap-1 pb-4">
              <div className="text-center text-body-lg font-bold text-text-heading">
                {t('layout.welcome-to-eigent')}
              </div>
            </div>

            {/* Bottom Box - Center (init state only) */}
            {chatStore.activeTaskId && (
              <BottomBox
                state="input"
                inputProps={{
                  value: message,
                  onChange: setMessage,
                  onSend: handleSend,
                  files:
                    chatStore.tasks[chatStore.activeTaskId]?.attaches?.map(
                      (f) => ({
                        fileName: f.fileName,
                        filePath: f.filePath,
                      })
                    ) || [],
                  onFilesChange: (files) =>
                    chatStore.setAttaches(
                      chatStore.activeTaskId as string,
                      files as any
                    ),
                  onAddFile: handleFileSelect,
                  placeholder: t('chat.ask-placeholder'),
                  disabled: isInputDisabled,
                  textareaRef: textareaRef,
                  allowDragDrop: true,
                  privacy: privacy,
                  useCloudModelInDev: useCloudModelInDev,
                }}
              />
            )}

            {/* Suggestion Area - Bottom area, flex-1 to push content up */}
            <div className="flex flex-1 items-start justify-center gap-2 bg-surface-primary pr-2 pt-3">
              {!privacy ? (
                <div className="flex items-center gap-2">
                  <div
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.tagName === 'A') {
                        return;
                      }
                      const API_FIELDS = [
                        'take_screenshot',
                        'access_local_software',
                        'access_your_address',
                        'password_storage',
                      ];
                      const requestData = {
                        [API_FIELDS[0]]: true,
                        [API_FIELDS[1]]: true,
                        [API_FIELDS[2]]: true,
                        [API_FIELDS[3]]: true,
                      };
                      proxyFetchPut('/api/user/privacy', requestData);
                      setPrivacy(true);
                    }}
                    className="flex cursor-pointer items-center gap-1 rounded-md bg-surface-information px-sm py-xs"
                  >
                    <TriangleAlert
                      size={20}
                      className="text-icon-information"
                    />
                    <span className="flex-1 text-xs font-medium leading-[20px] text-text-information">
                      {t('layout.by-messaging-eigent')}{' '}
                      <a
                        href="https://www.eigent.ai/terms-of-use"
                        target="_blank"
                        className="text-text-information underline"
                        onClick={(e) => e.stopPropagation()}
                        rel="noreferrer"
                      >
                        {t('layout.terms-of-use')}
                      </a>{' '}
                      {t('layout.and')}{' '}
                      <a
                        href="https://www.eigent.ai/privacy-policy"
                        target="_blank"
                        className="text-text-information underline"
                        onClick={(e) => e.stopPropagation()}
                        rel="noreferrer"
                      >
                        {t('layout.privacy-policy')}
                      </a>
                      .
                    </span>
                  </div>
                </div>
              ) : (
                <div className="mr-2 flex flex-col items-center gap-2">
                  {[
                    {
                      label: t('layout.it-ticket-creation'),
                      message: t('layout.it-ticket-creation-message'),
                    },
                    {
                      label: t('layout.bank-transfer-csv-analysis'),
                      message: t('layout.bank-transfer-csv-analysis-message'),
                    },
                    {
                      label: t('layout.find-duplicate-files'),
                      message: t('layout.find-duplicate-files-message'),
                    },
                  ].map(({ label, message }) => (
                    <div
                      key={label}
                      className="cursor-pointer rounded-md bg-surface-tertiary px-sm py-xs text-xs font-medium leading-none text-button-tertiery-text-default opacity-70 transition-all duration-300 hover:opacity-100"
                      onClick={() => {
                        setMessage(message);
                      }}
                    >
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bottom Box - Show when has messages */}
        {chatStore.activeTaskId && hasAnyMessages && (
          <BottomBox
            state={hasAnyMessages ? getBottomBoxState() : 'input'}
            queuedMessages={triggerTaskStoreState.taskQueue
              .filter(
                (t) =>
                  t.projectId === projectStore.activeProjectId &&
                  t.status === ExecutionStatus.Pending
              )
              .map((t) => ({
                id: t.id,
                content: t.formattedMessage || t.taskPrompt,
                timestamp: t.timestamp,
              }))}
            onRemoveQueuedMessage={(id) => handleRemoveTaskQueue(id)}
            subtitle={
              hasAnyMessages && getBottomBoxState() === 'confirm'
                ? (() => {
                    const messages =
                      chatStore.tasks[chatStore.activeTaskId]?.messages || [];
                    const lastUserMessage = messages
                      .slice()
                      .reverse()
                      .find((msg) => msg.role === 'user');
                    return (
                      lastUserMessage?.content ||
                      chatStore.tasks[chatStore.activeTaskId]?.summaryTask
                    );
                  })()
                : chatStore.tasks[chatStore.activeTaskId]?.summaryTask
            }
            onStartTask={() => handleConfirmTask()}
            onEdit={handleEditQuery}
            taskTime={taskTime}
            taskStatus={chatStore.tasks[chatStore.activeTaskId]?.status}
            onPauseResume={handlePauseResume}
            pauseResumeLoading={isPauseResumeLoading}
            loading={loading}
            inputProps={{
              value: message,
              onChange: setMessage,
              onSend: handleSend,
              files:
                chatStore.tasks[chatStore.activeTaskId]?.attaches?.map((f) => ({
                  fileName: f.fileName,
                  filePath: f.filePath,
                })) || [],
              onFilesChange: (files) =>
                chatStore.setAttaches(
                  chatStore.activeTaskId as string,
                  files as any
                ),
              onAddFile: handleFileSelect,
              placeholder: t('chat.ask-placeholder'),
              disabled: isInputDisabled,
              textareaRef: textareaRef,
              allowDragDrop: hasAnyMessages,
              privacy: hasAnyMessages ? privacy : true,
              useCloudModelInDev: useCloudModelInDev,
            }}
          />
        )}
      </div>
    </div>
  );
}
