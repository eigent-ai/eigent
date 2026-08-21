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
import { type CloseIntent } from '@/shared/windowClose';
import { hasAnyActiveRun } from '@/store/chatStore';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/** Keeps Close Window and Quit guarded on every route, including auth pages. */
export function WindowCloseProvider({ children }: { children: ReactNode }) {
  const host = useHost();
  const appShellElectronAPI = host?.electronAPI as
    AppShellElectronAPI | undefined;
  const { chatStore } = useChatStoreAdapter();
  const [pendingIntent, setPendingIntent] = useState<CloseIntent | null>(null);
  const pendingIntentRef = useRef<CloseIntent | null>(null);
  const chatStoreRef = useRef(chatStore);

  useEffect(() => {
    chatStoreRef.current = chatStore;
  }, [chatStore]);

  const respondToCloseRequest = useCallback(
    (action: 'confirm' | 'cancel') => {
      const intent = pendingIntentRef.current;
      if (!intent) return;

      pendingIntentRef.current = null;
      setPendingIntent(null);
      appShellElectronAPI?.respondToCloseRequest?.({ intent, action });
    },
    [appShellElectronAPI]
  );

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open && pendingIntentRef.current) {
        respondToCloseRequest('cancel');
      }
    },
    [respondToCloseRequest]
  );

  useEffect(() => {
    const onCloseRequest = appShellElectronAPI?.onCloseRequest;
    const respond = appShellElectronAPI?.respondToCloseRequest;
    if (!onCloseRequest || !respond) return;

    return onCloseRequest((request) => {
      const currentChatStore = chatStoreRef.current;
      const currentStatus = currentChatStore?.activeTaskId
        ? currentChatStore.tasks[currentChatStore.activeTaskId]?.status
        : undefined;
      const activeTaskBusy = Boolean(
        currentStatus && ['running', 'pause'].includes(currentStatus)
      );

      if (activeTaskBusy || hasAnyActiveRun()) {
        respond({ intent: request.intent, action: 'acknowledge' });
        pendingIntentRef.current = request.intent;
        setPendingIntent(request.intent);
        return;
      }

      respond({ intent: request.intent, action: 'confirm' });
    });
  }, [appShellElectronAPI]);

  return (
    <>
      {children}
      <CloseNoticeDialog
        onOpenChange={handleOpenChange}
        onConfirm={() => respondToCloseRequest('confirm')}
        open={pendingIntent !== null}
      />
    </>
  );
}
