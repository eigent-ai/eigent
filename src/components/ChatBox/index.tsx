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
import { useAuthStore } from '@/store/authStore';
import { AgentStep, ChatTaskStatus } from '@/types/constants';
import { Square, SquareCheckBig, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import BottomBox from './BottomBox';
import { ProjectChatContainer } from './ProjectChatContainer';

export default function ChatBox(): JSX.Element {
  const [message, setMessage] = useState<string>('');
  const [mentionTarget, setMentionTarget] = useState<string | null>(null);

  //Get Chatstore for the active project's task
  const { chatStore, projectStore } = useChatStoreAdapter();
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [privacy, setPrivacy] = useState<any>(false);
  const [isPrivacyLoaded, setIsPrivacyLoaded] = useState<boolean>(false);
  const [_hasSearchKey, setHasSearchKey] = useState<any>(false);
  const [hasModel, setHasModel] = useState<any>(false);
  const [isConfigLoaded, setIsConfigLoaded] = useState<boolean>(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // const [privacyDialogOpen, setPrivacyDialogOpen] = useState(false);
  const { modelType } = useAuthStore();
  const [useCloudModelInDev, setUseCloudModelInDev] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Shared function to check model configuration
  const checkModelConfig = useCallback(async () => {
    try {
      if (modelType === 'cloud') {
        // For cloud model, check if API key exists
        const res = await proxyFetchGet('/api/user/key');
        setHasModel(!!res.value);
      } else if (modelType === 'local' || modelType === 'custom') {
        // For local/custom model, check if provider exists
        const res = await proxyFetchGet('/api/providers', { prefer: true });
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
      .catch((err) => console.error('Failed to fetch settings:', err))
      .finally(() => setIsPrivacyLoaded(true));

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

    checkModelConfig();
  }, [modelType, checkModelConfig]);

  // Re-check model config when returning from settings page
  useEffect(() => {
    // Check when location changes (user navigates)
    if (location.pathname === '/' && privacy) {
      checkModelConfig();
    }
  }, [location.pathname, privacy, checkModelConfig]);

  // Also check when window gains focus (user returns from settings)
  useEffect(() => {
    const handleFocus = () => {
      if (privacy) {
        checkModelConfig();
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [privacy, checkModelConfig]);

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

  const [loading, setLoading] = useState(false);
  const [isReplayLoading, setIsReplayLoading] = useState(false);
  const [isPauseResumeLoading, setIsPauseResumeLoading] = useState(false);
  const handleSendRef = useRef<
    ((messageStr?: string, taskId?: string) => Promise<void>) | null
  >(null);

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
      // skeleton/computing phase (not applicable after task finishes or in direct agent mode)
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

    // If ask human is active, allow input
    if (task.activeAsk) return false;

    if (isTaskBusy) return true;

    // Standard checks - check model first, then privacy
    if (!hasModel) return true;
    if (!privacy) return true;
    if (useCloudModelInDev) return true;
    if (task.isContextExceeded) return true;

    return false;
  }, [
    chatStore?.activeTaskId,
    chatStore?.tasks,
    privacy,
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

      // Check model configuration before starting task
      if (!hasModel) {
        toast.error('Please select a model first.');
        navigate('/setting/models');
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
    [chatStore, projectStore.activeProjectId, hasModel, privacy, navigate]
  );

  useEffect(() => {
    // Wait for both config and privacy to be loaded before handling share token
    if (share_token && isConfigLoaded && isPrivacyLoaded) {
      handleSendShare(share_token);
    }
  }, [share_token, isConfigLoaded, isPrivacyLoaded, handleSendShare]);

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

  const handleSend = async (messageStr?: string, taskId?: string) => {
    const _taskId = taskId || chatStore.activeTaskId;
    if (message.trim() === '' && !messageStr) return;

    // Check model first, then privacy
    if (!hasModel) {
      toast.error('Please select a model first.');
      navigate('/setting/models');
      return;
    }
    if (!privacy) {
      toast.error('Please accept the privacy policy first.');
      return;
    }

    const rawMessageContent = messageStr || message;

    // Use the active mentionTarget state (rendered as a tag in the input).
    // Fall back to parsing @mention from text for backwards compat.
    let activeMentionTarget = mentionTarget;
    let tempMessageContent = rawMessageContent;
    if (!activeMentionTarget) {
      const mentionMatch = rawMessageContent.match(/^@(\w+)\s+([\s\S]*)/);
      if (mentionMatch) {
        activeMentionTarget = mentionMatch[1];
        tempMessageContent = mentionMatch[2];
      }
    }

    // Build display content: embed mention as {{@agentId}} so it
    // survives in the message text and gets rendered like skill tags.
    const displayContent = activeMentionTarget
      ? `{{@${activeMentionTarget}}} ${tempMessageContent}`
      : tempMessageContent;

    // Persist the mention target so the tag stays for the next turn
    if (activeMentionTarget && activeMentionTarget !== mentionTarget) {
      setMentionTarget(activeMentionTarget);
    }

    chatStore.setHasMessages(_taskId as string, true);
    if (!_taskId) return;

    // Multi-turn support: Check if task is running or planning (splitting/confirm)
    const task = chatStore.tasks[_taskId];
    const requiresHumanReply = Boolean(task?.activeAsk);
    const isTaskBusy =
      // running or paused counts as busy
      (task.status === ChatTaskStatus.RUNNING && task.hasMessages) ||
      task.status === ChatTaskStatus.PAUSE ||
      // splitting phase: has to_sub_tasks not confirmed OR skeleton computing
      task.messages.some(
        (m) => m.step === AgentStep.TO_SUB_TASKS && !m.isConfirm
      ) ||
      (!task.messages.find((m) => m.step === AgentStep.TO_SUB_TASKS) &&
        !task.hasWaitComfirm &&
        task.messages.length > 0 &&
        task.status !== ChatTaskStatus.FINISHED) ||
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
          content: displayContent,
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
          chatStore.tasks[_taskId as string].status === ChatTaskStatus.FINISHED;
        const hasWaitComfirm =
          chatStore.tasks[_taskId as string]?.hasWaitComfirm;

        // Check if this task was manually stopped (finished but without natural completion)
        const wasTaskStopped =
          isFinished &&
          !chatStore.tasks[_taskId as string].messages.some(
            (m) => m.step === AgentStep.END // Natural completion has an "end" step message
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
          ].messages.some((m) => m.step === AgentStep.WAIT_CONFIRM);
          const hasComplexTask = chatStore.tasks[
            _taskId as string
          ].messages.some((m) => m.step === AgentStep.TO_SUB_TASKS);
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
                activeMentionTarget ?? undefined,
                displayContent
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

            // Use improve endpoint (POST /chat/{id}) - {id} is project_id
            fetchPost(`/chat/${projectStore.activeProjectId}`, {
              question: tempMessageContent,
              task_id: nextTaskId,
              attaches: improveAttaches,
              target: activeMentionTarget,
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
              activeMentionTarget ?? undefined,
              displayContent
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

  // Update ref so useEffect before early return can access handleSend
  handleSendRef.current = handleSend;

  const _handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && e.ctrlKey && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };
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
  const handleReplay = async () => {
    setIsReplayLoading(true);
    await replayActiveTask(chatStore, projectStore, navigate);
    setIsReplayLoading(false);
  };

  // Pause/Resume handler
  const handlePauseResume = () => {
    const taskId = chatStore.activeTaskId as string;
    const task = chatStore.tasks[taskId];
    const type = task.status === ChatTaskStatus.RUNNING ? 'pause' : 'resume';

    setIsPauseResumeLoading(true);
    if (type === 'pause') {
      let { taskTime, elapsed } = task;
      const now = Date.now();
      elapsed += now - taskTime;
      chatStore.setElapsed(taskId, elapsed);
      chatStore.setTaskTime(taskId, 0);
      chatStore.setStatus(taskId, ChatTaskStatus.PAUSE);
    } else {
      chatStore.setTaskTime(taskId, Date.now());
      chatStore.setStatus(taskId, ChatTaskStatus.RUNNING);
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
      (item) => item.step === AgentStep.TO_SUB_TASKS
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

  // Task time tracking useEffect is defined before early return

  // Determine BottomBox state
  const getBottomBoxState = () => {
    if (!chatStore.activeTaskId) return 'input';
    const task = chatStore.tasks[chatStore.activeTaskId];

    // Queued messages no longer change BottomBox state; QueuedBox renders independently

    // Check for any to_sub_tasks message (confirmed or not)
    const anyToSubTasksMessage = task.messages.find(
      (m) => m.step === AgentStep.TO_SUB_TASKS
    );
    const toSubTasksMessage = task.messages.find(
      (m) => m.step === AgentStep.TO_SUB_TASKS && !m.isConfirm
    );

    // Determine if we're in the "splitting in progress" phase (skeleton visible)
    // Only show splitting if there's NO to_sub_tasks message yet (not even confirmed)
    // Skip splitting phase when task is already RUNNING (e.g. direct @agent mode)
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

    // After splitting completes and TaskCard is awaiting user confirmation,
    // the Task becomes 'pending' and we show the confirm state.
    if (
      toSubTasksMessage &&
      !toSubTasksMessage.isConfirm &&
      task.status === ChatTaskStatus.PENDING
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

    if (task.status === ChatTaskStatus.FINISHED && task.type !== '') {
      return 'finished';
    }

    return 'input';
  };

  // hasSubTask useState and useEffect are defined before early return

  const handleRemoveTaskQueue = async (task_id: string) => {
    const project_id = projectStore.activeProjectId;
    if (!project_id) {
      console.error('No active project ID found');
      return;
    }

    // Store the original message before removal for potential restoration
    const project = projectStore.getProjectById(project_id);
    const originalMessage = project?.queuedMessages?.find(
      (m) => m.task_id === task_id
    );

    if (!originalMessage) {
      console.error(`Message with task_id ${task_id} not found`);
      return;
    }

    // Create a copy of the original message for restoration
    const messageBackup = {
      task_id: originalMessage.task_id,
      content: originalMessage.content,
      timestamp: originalMessage.timestamp,
      attaches: [...originalMessage.attaches],
    };

    try {
      //Optimistic Removal
      projectStore.removeQueuedMessage(project_id, task_id);

      // Always try to call the backend to remove the task
      // The backend will handle the error gracefully if workforce is not initialized
      // Note: Replay creates a new chatstore, so no conflicts
      const task = chatStore.tasks[chatStore.activeTaskId as string];
      // Only skip backend call if task is finished or hasn't started yet (no messages)
      if (
        task &&
        task.messages.length > 0 &&
        task.status !== ChatTaskStatus.FINISHED
      ) {
        try {
          await fetchDelete(`/chat/${project_id}/remove-task/${task_id}`, {
            project_id: project_id,
            task_id: task_id,
          });
        } catch (apiError) {
          // If backend returns an error, it's okay - the task might not be in the workforce queue yet
          console.log(
            `Backend remove call failed (expected if workforce not started): ${apiError}`
          );
        }
      }
    } catch (error) {
      // Revert the optimistic removal by restoring the original message
      projectStore.restoreQueuedMessage(project_id, messageBackup);
      console.error(`Can't remove ${task_id} due to ${error}`);
    }
  };

  // getAllChatStoresMemoized, hasAnyMessages, isTaskBusy, and isInputDisabled
  // are defined before early return

  return (
    <div className="h-full w-full flex-none items-center justify-center">
      {hasAnyMessages ? (
        <div className="flex h-full w-full flex-1 flex-col">
          {/* New Project Chat Container */}
          <ProjectChatContainer
            // onPauseResume={handlePauseResume}  // Commented out - temporary not needed
            onSkip={handleSkip}
            isPauseResumeLoading={isPauseResumeLoading}
          />
          {chatStore.activeTaskId && (
            <BottomBox
              state={getBottomBoxState()}
              queuedMessages={
                isTaskBusy
                  ? []
                  : projectStore
                      .getProjectById(projectStore.activeProjectId || '')
                      ?.queuedMessages?.map((m) => ({
                        id: m.task_id,
                        content: m.content,
                        timestamp: m.timestamp,
                      })) || []
              }
              onRemoveQueuedMessage={(id) => handleRemoveTaskQueue(id)}
              subtitle={
                getBottomBoxState() === 'confirm'
                  ? (() => {
                      // Find the last message where role is "user"
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
              tokens={chatStore.tasks[chatStore.activeTaskId]?.tokens || 0}
              taskTime={taskTime}
              taskStatus={chatStore.tasks[chatStore.activeTaskId]?.status}
              onReplay={handleReplay}
              replayDisabled={
                chatStore.tasks[chatStore.activeTaskId]?.status !==
                ChatTaskStatus.FINISHED
              }
              replayLoading={isReplayLoading}
              onPauseResume={handlePauseResume}
              pauseResumeLoading={isPauseResumeLoading}
              loading={loading}
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
                mentionTarget: mentionTarget,
                onMentionTargetChange: setMentionTarget,
              }}
            />
          )}
        </div>
      ) : (
        // Init ChatBox
        <div className="relative flex h-[calc(100vh-54px)] w-full items-center overflow-hidden py-2">
          <div className="pointer-events-none absolute inset-0"></div>
          <div className="relative z-10 flex w-full flex-col">
            <div className="flex h-[210px] flex-col items-center justify-end gap-1">
              <div className="text-center text-body-lg font-bold text-text-heading">
                {t('layout.welcome-to-eigent')}
              </div>
              <div className="mb-5 text-center text-body-lg leading-7 text-text-label">
                {t('layout.how-can-i-help-you')}
              </div>
            </div>

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
                  mentionTarget: mentionTarget,
                  onMentionTargetChange: setMentionTarget,
                }}
              />
            )}
            <div className="mt-3 flex h-[210px] items-start justify-center gap-2 pr-2">
              {!hasModel ? (
                <div className="flex items-center gap-2">
                  <div
                    onClick={() => {
                      navigate('/setting/models');
                    }}
                    className="flex cursor-pointer items-center gap-2 rounded-md bg-surface-warning px-sm py-xs"
                  >
                    <TriangleAlert size={20} className="text-icon-warning" />
                    <span className="flex-1 text-xs font-medium leading-[20px] text-text-warning">
                      {t('layout.please-select-model')}
                    </span>
                  </div>
                </div>
              ) : null}
              {hasModel && !privacy ? (
                <div className="flex items-center gap-2">
                  <div
                    onClick={(e) => {
                      // Check if the click target is an anchor tag
                      const target = e.target as HTMLElement;
                      if (target.tagName === 'A') {
                        // Let the anchor tag handle the click naturally
                        return;
                      }
                      // Toggle privacy if not already enabled
                      if (!privacy) {
                        // Enable privacy permissions
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
                    }}
                    className="group flex max-w-64 cursor-pointer items-center justify-center gap-2 rounded-xl bg-surface-information px-md py-xs transition-all duration-200 hover:bg-surface-tertiary"
                  >
                    <div className="shrink-0">
                      {privacy ? (
                        <SquareCheckBig
                          size={20}
                          className="shrink-0 text-icon-success"
                        />
                      ) : (
                        <div className="relative flex shrink-0 items-center justify-center">
                          <Square
                            size={20}
                            className="text-icon-information transition-opacity group-hover:opacity-0"
                          />
                          <SquareCheckBig
                            size={20}
                            className="absolute inset-0 text-icon-information opacity-0 transition-opacity group-hover:opacity-50"
                          />
                        </div>
                      )}
                    </div>
                    <span className="flex-1 cursor-pointer text-label-xs font-medium leading-normal text-text-information">
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
              ) : null}
              {privacy && hasModel && (
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
                      className="cursor-pointer rounded-md bg-input-bg-default px-sm py-xs text-xs font-medium leading-none text-button-tertiery-text-default opacity-70 transition-all duration-300 hover:opacity-100"
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
      )}
    </div>
  );
}
