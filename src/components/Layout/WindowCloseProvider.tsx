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

import CloseNoticeDialog from '@/components/Dialog/CloseNotice';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { useHost, type AppShellElectronAPI } from '@/host';
import { assessCloseRunState } from '@/service/runCloseGuard';
import {
  type CloseExecutionClass,
  type CloseIntent,
} from '@/shared/windowClose';
import { hasAnyActiveLegacySSEConnection } from '@/store/chatStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

const CLOSE_RUN_LOOKUP_TIMEOUT_MS = 2_500;

interface ClosePrompt {
  executionClass: CloseExecutionClass;
  intent: CloseIntent;
}

function getKnownLocalProjectIds(): string[] {
  const projectIds = new Set(
    useSpaceStore
      .getState()
      .getProjectsForSpace()
      .map((project) => project.id)
  );
  Object.keys(useProjectRuntimeStore.getState().projects).forEach((projectId) =>
    projectIds.add(projectId)
  );
  return [...projectIds];
}

/** Keeps Close Window and Quit guarded on every route, including auth pages. */
export function WindowCloseProvider({ children }: { children: ReactNode }) {
  const host = useHost();
  const appShellElectronAPI = host?.electronAPI as
    AppShellElectronAPI | undefined;
  const { chatStore } = useChatStoreAdapter();
  const [pendingPrompt, setPendingPrompt] = useState<ClosePrompt | null>(null);
  const pendingPromptRef = useRef<ClosePrompt | null>(null);
  const assessmentGenerationRef = useRef(0);
  const assessmentAbortRef = useRef<AbortController | null>(null);
  const chatStoreRef = useRef(chatStore);

  useEffect(() => {
    chatStoreRef.current = chatStore;
  }, [chatStore]);

  const respondToCloseRequest = useCallback(
    (action: 'confirm' | 'cancel') => {
      const prompt = pendingPromptRef.current;
      if (!prompt) return;

      pendingPromptRef.current = null;
      setPendingPrompt(null);
      appShellElectronAPI?.respondToCloseRequest?.({
        intent: prompt.intent,
        action,
      });
    },
    [appShellElectronAPI]
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open && pendingPromptRef.current) {
        respondToCloseRequest('cancel');
      }
    },
    [respondToCloseRequest]
  );

  useEffect(() => {
    const onCloseRequest = appShellElectronAPI?.onCloseRequest;
    const respond = appShellElectronAPI?.respondToCloseRequest;
    if (!onCloseRequest || !respond) return;

    let disposed = false;
    const unsubscribe = onCloseRequest((request) => {
      const generation = assessmentGenerationRef.current + 1;
      assessmentGenerationRef.current = generation;
      assessmentAbortRef.current?.abort();
      const controller = new AbortController();
      assessmentAbortRef.current = controller;

      pendingPromptRef.current = null;
      setPendingPrompt(null);
      respond({ intent: request.intent, action: 'acknowledge' });

      const currentChatStore = chatStoreRef.current;
      const currentStatus = currentChatStore?.activeTaskId
        ? currentChatStore.tasks[currentChatStore.activeTaskId]?.status
        : undefined;
      const activeTaskBusy = Boolean(
        currentStatus && ['running', 'pause'].includes(currentStatus)
      );
      const legacyActive = activeTaskBusy || hasAnyActiveLegacySSEConnection();
      const timeout = window.setTimeout(
        () =>
          controller.abort(
            new DOMException('Canonical Run lookup timed out', 'TimeoutError')
          ),
        CLOSE_RUN_LOOKUP_TIMEOUT_MS
      );

      void Promise.resolve()
        .then(() =>
          assessCloseRunState({
            projectIds: getKnownLocalProjectIds(),
            legacyActive,
            signal: controller.signal,
          })
        )
        .then((assessment) => {
          if (
            disposed ||
            controller.signal.aborted ||
            assessmentGenerationRef.current !== generation
          ) {
            return;
          }
          if (assessment === 'idle') {
            respond({ intent: request.intent, action: 'confirm' });
            return;
          }
          const prompt = {
            intent: request.intent,
            executionClass: assessment,
          } satisfies ClosePrompt;
          pendingPromptRef.current = prompt;
          setPendingPrompt(prompt);
        })
        .catch((error: unknown) => {
          if (disposed || assessmentGenerationRef.current !== generation) {
            return;
          }
          console.warn(
            '[WINDOW CLOSE] Could not verify durable Run state',
            error
          );
          const prompt = {
            intent: request.intent,
            executionClass: 'unknown',
          } satisfies ClosePrompt;
          pendingPromptRef.current = prompt;
          setPendingPrompt(prompt);
        })
        .finally(() => {
          window.clearTimeout(timeout);
          if (assessmentAbortRef.current === controller) {
            assessmentAbortRef.current = null;
          }
        });
    });

    return () => {
      disposed = true;
      assessmentGenerationRef.current += 1;
      assessmentAbortRef.current?.abort();
      assessmentAbortRef.current = null;
      unsubscribe();
    };
  }, [appShellElectronAPI]);

  return (
    <>
      {children}
      <CloseNoticeDialog
        onOpenChange={handleOpenChange}
        onConfirm={() => respondToCloseRequest('confirm')}
        open={pendingPrompt !== null}
        intent={pendingPrompt?.intent ?? 'close-window'}
        executionClass={pendingPrompt?.executionClass ?? 'unknown'}
      />
    </>
  );
}
