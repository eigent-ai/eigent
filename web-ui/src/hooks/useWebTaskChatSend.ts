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

import { fetchPost, uploadFileToBrain } from '@/api/http';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useModelConfigCheck } from '@/hooks/useModelConfigCheck';
import { generateUniqueId } from '@/lib';
import { inferSessionModeFromTask } from '@/lib/sessionMode';
import { usePageTabStore } from '@/store/pageTabStore';
import { AgentStep, ChatTaskStatus, SessionMode } from '@/types/constants';
import { isWebUiMock } from '@web/lib/mockMode';
import { injectWebMockAgentReply } from '@web/lib/webMockAgentResponse';
import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

export function useWebTaskChatSend({
  message,
  setMessage,
  onSent,
}: {
  message: string;
  setMessage: (value: string) => void;
  onSent?: () => void;
}) {
  const { chatStore, projectStore } = useChatStoreAdapter();
  const { hasModel, cloudUsageLimitReached } = useModelConfigCheck();
  const sessionSidePanelMode = usePageTabStore(
    (state) => state.sessionSidePanelMode ?? SessionMode.SINGLE_AGENT
  );
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLDivElement>(null);

  const isTaskBusy = useMemo(() => {
    if (!chatStore?.activeTaskId || !chatStore.tasks[chatStore.activeTaskId]) {
      return false;
    }

    const task = chatStore.tasks[chatStore.activeTaskId];
    return (
      (task.status === ChatTaskStatus.RUNNING && task.hasMessages) ||
      task.status === ChatTaskStatus.PAUSE ||
      task.messages.some(
        (entry) => entry.step === AgentStep.TO_SUB_TASKS && !entry.isConfirm
      ) ||
      ((!task.messages.find((entry) => entry.step === AgentStep.TO_SUB_TASKS) &&
        !task.hasWaitComfirm &&
        task.messages.length > 0 &&
        task.status !== ChatTaskStatus.FINISHED) as boolean) ||
      task.isTakeControl
    );
  }, [chatStore]);

  const isInputDisabled = useMemo(() => {
    if (!chatStore?.activeTaskId || !chatStore.tasks[chatStore.activeTaskId]) {
      return true;
    }

    const task = chatStore.tasks[chatStore.activeTaskId];
    if (task.activeAsk) return false;
    if (isTaskBusy) return true;
    if (cloudUsageLimitReached) return true;
    if (!hasModel) return true;
    if (task.isContextExceeded) return true;
    return false;
  }, [chatStore, cloudUsageLimitReached, hasModel, isTaskBusy]);

  const handleFileSelect = useCallback(async () => {
    if (!chatStore?.activeTaskId) return;

    const taskId = chatStore.activeTaskId;
    const existingFiles = chatStore.tasks[taskId]?.attaches || [];
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = async () => {
      if (!input.files?.length) return;

      const uploadedFiles: File[] = [];
      for (const selectedFile of Array.from(input.files)) {
        try {
          const result = await uploadFileToBrain(selectedFile);
          uploadedFiles.push({
            fileName: result.filename,
            filePath: result.file_id,
            fileId: result.file_id,
            source: 'upload',
          } as File);
        } catch (error) {
          console.error('Select File Upload Error:', error);
          toast.error(`Failed to upload ${selectedFile.name}`);
        }
      }

      if (uploadedFiles.length === 0) return;

      chatStore.setAttaches(taskId, [
        ...existingFiles,
        ...uploadedFiles.filter(
          (uploaded) =>
            !existingFiles.some(
              (existing) => existing.filePath === uploaded.filePath
            )
        ),
      ]);
    };
    input.click();
  }, [chatStore]);

  const handleSend = useCallback(async () => {
    if (!chatStore?.activeTaskId || message.trim() === '') return;

    if (!hasModel) {
      toast.error(
        t('layout.please-select-model-first', {
          defaultValue: 'Please select a model first.',
        })
      );
      return;
    }

    const taskId = chatStore.activeTaskId;
    const task = chatStore.tasks[taskId];
    const displayContent = message.trim();
    const sessionMode =
      inferSessionModeFromTask(task, null) ?? sessionSidePanelMode;

    if (task.activeAsk) {
      chatStore.addMessages(taskId, {
        id: generateUniqueId(),
        role: 'user',
        content: displayContent,
        attaches: JSON.parse(JSON.stringify(task.attaches || [])),
      });
      setMessage('');
      chatStore.setIsPending(taskId, true);
      await fetchPost(`/chat/${projectStore.activeProjectId}/human-reply`, {
        agent: task.activeAsk,
        reply: displayContent,
      });
      chatStore.setAttaches(taskId, []);
      onSent?.();
      return;
    }

    if (isTaskBusy) {
      toast.error(
        t('layout.web-task-busy', {
          defaultValue:
            'Current task is in progress. Please wait for it to finish before sending a new request.',
        })
      );
      return;
    }

    chatStore.setHasMessages(taskId, true);
    const attachesToSend =
      JSON.parse(JSON.stringify(chatStore.tasks[taskId]?.attaches)) || [];

    if (isWebUiMock()) {
      chatStore.addMessages(taskId, {
        id: generateUniqueId(),
        role: 'user',
        content: displayContent,
        attaches: attachesToSend,
      });
      setMessage('');
      chatStore.setAttaches(taskId, []);
      chatStore.setHasWaitComfirm(taskId, true);
      injectWebMockAgentReply(chatStore, taskId, displayContent);
      onSent?.();
      return;
    }

    const hasMessages = task.messages.length > 0;
    const isFinished = task.status === ChatTaskStatus.FINISHED;
    const wasTaskStopped =
      isFinished &&
      !task.messages.some((entry) => entry.step === AgentStep.END);
    const shouldContinueConversation =
      (task.hasWaitComfirm && !wasTaskStopped) ||
      (isFinished && !wasTaskStopped) ||
      (hasMessages && task.status === ChatTaskStatus.PENDING);

    if (textareaRef.current) {
      textareaRef.current.style.height = '60px';
    }

    try {
      if (shouldContinueConversation) {
        const hasSimpleResponse = task.messages.some(
          (entry) => entry.step === AgentStep.WAIT_CONFIRM
        );
        const hasComplexTask = task.messages.some(
          (entry) => entry.step === AgentStep.TO_SUB_TASKS
        );
        const hasErrorMessage = task.messages.some(
          (entry) =>
            entry.role === 'agent' && entry.content.startsWith('❌ **Error**:')
        );

        if (
          (task.status === ChatTaskStatus.PENDING &&
            !hasSimpleResponse &&
            !hasComplexTask &&
            !isFinished) ||
          task.type === 'replay' ||
          hasErrorMessage
        ) {
          setMessage('');
          await chatStore.startTask(
            taskId,
            undefined,
            undefined,
            undefined,
            displayContent,
            attachesToSend,
            undefined,
            undefined,
            sessionMode
          );
          chatStore.setAttaches(taskId, []);
        } else {
          const nextTaskId = generateUniqueId();
          chatStore.setNextTaskId(nextTaskId);
          fetchPost(`/chat/${projectStore.activeProjectId}`, {
            question: displayContent,
            task_id: nextTaskId,
            attaches:
              attachesToSend.map(
                (file: { filePath: string }) => file.filePath
              ) || [],
            target: undefined,
          });
          chatStore.setIsPending(taskId, true);
          chatStore.addMessages(taskId, {
            id: generateUniqueId(),
            role: 'user',
            content: displayContent,
            attaches: attachesToSend,
          });
          chatStore.setAttaches(taskId, []);
          setMessage('');
        }
      } else {
        setMessage('');
        await chatStore.startTask(
          taskId,
          undefined,
          undefined,
          undefined,
          displayContent,
          attachesToSend,
          undefined,
          undefined,
          sessionMode
        );
        chatStore.setHasWaitComfirm(taskId, true);
        chatStore.setAttaches(taskId, []);
      }
      onSent?.();
    } catch (error) {
      console.error('Failed to send web task message:', error);
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to start task. Please check your model configuration.'
      );

      const replyTaskId = chatStore.activeTaskId ?? taskId;
      const replyTask = chatStore.tasks[replyTaskId];
      const hasMatchingUserMessage = replyTask?.messages.some(
        (entry) => entry.role === 'user' && entry.content === displayContent
      );

      if (!hasMatchingUserMessage) {
        chatStore.addMessages(replyTaskId, {
          id: generateUniqueId(),
          role: 'user',
          content: displayContent,
          attaches: attachesToSend,
        });
      }

      injectWebMockAgentReply(chatStore, replyTaskId, displayContent, 500);
    }
  }, [
    chatStore,
    hasModel,
    isTaskBusy,
    message,
    onSent,
    projectStore.activeProjectId,
    sessionSidePanelMode,
    setMessage,
    t,
  ]);

  return {
    textareaRef,
    isInputDisabled,
    handleSend,
    handleFileSelect,
    hasModel,
    cloudUsageLimitReached,
  };
}
