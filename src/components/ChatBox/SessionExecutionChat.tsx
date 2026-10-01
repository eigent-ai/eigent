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

import BottomBox from '@/components/ChatBox/BottomBox';
import { EventNativeProjectTimeline } from '@/components/ChatBox/EventNativeProjectTimeline';
import { SessionArtifactPreview } from '@/components/ChatBox/SessionArtifactPreview';
import { Button } from '@/components/ui/button';
import { DsText } from '@/components/ui/ds-text';
import { useProjectEventRuntime } from '@/hooks/useProjectEventRuntime';
import { useSessionExecution } from '@/hooks/useSessionExecution';
import {
  assertExecutionScope,
  cancelSessionExecution,
  createSessionMessageIntent,
  sendSessionExecutionNow,
  type SessionMessageIntent,
} from '@/service/executionApi';
import {
  sessionMessageConfiguration,
  submitSessionMessage,
} from '@/service/sessionMessage';
import { usePageTabStore } from '@/store/pageTabStore';
import {
  loadMoreSessionExecutions,
  refreshSessionExecution,
} from '@/store/sessionExecutionStore';
import { SessionMode } from '@/types/constants';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export function SessionExecutionStatus({ projectId }: { projectId: string }) {
  const { scope, state } = useSessionExecution(projectId);
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 p-4" role="status">
      <DsText>
        {t(
          state.error ? 'chat.parallel-request-failed' : 'chat.parallel-loading'
        )}
      </DsText>
      {Boolean(state.error) && (
        <Button
          variant="secondary"
          onClick={() => refreshSessionExecution(scope)}
        >
          {t('chat.parallel-retry')}
        </Button>
      )}
    </div>
  );
}

export function SessionExecutionChat({ projectId }: { projectId: string }) {
  const { scope, state } = useSessionExecution(projectId);
  const { t } = useTranslation();
  const runtime = useProjectEventRuntime();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [unsupportedInput, setUnsupportedInput] = useState(false);
  const [controls, setControls] = useState<Set<string>>(new Set());
  const intent = useRef<SessionMessageIntent | null>(null);
  const accepted = useRef(false);
  const externalDraft = usePageTabStore(
    (store) => store.workspaceChatDraftRequest
  );
  const unsupportedHandoff = externalDraft?.projectId === projectId;
  const operations = useRef(new Map<string, string>());
  const lifetime = useRef(new AbortController());
  const lock = useRef(false);
  const scroll = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => controller.abort();
  }, [scope]);
  // New Run ids and missed terminal events are discovered by canonical reads.
  // The observer and hydration retry never submit, resume or retire a Run.
  const retryHydration = runtime.hydration.retry;
  useEffect(() => {
    retryHydration();
  }, [retryHydration, state.revision]);
  const active = state.requests.filter(
    (request) =>
      request.status !== 'cancelled' && request.settlement !== 'settled'
  );
  const queue = active.map((request) => ({
    id: request.request_id,
    content: request.content || t('chat.parallel-pending'),
    timestamp: request.created_at * 1000,
    processing: request.status === 'admitted' || request.status === 'preparing',
    stopping: request.cancel_requested,
    canSendNow:
      request.kind === 'follow_up' &&
      request.status === 'pending' &&
      request.delivery_mode === 'wait' &&
      !controls.has(request.request_id),
    canReorder: false,
  }));
  const send = async () => {
    if (
      unsupportedHandoff ||
      lock.current ||
      (!message.trim() && !intent.current)
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(false);
    const captured = { ...scope, signal: lifetime.current.signal };
    try {
      if (!intent.current)
        intent.current = createSessionMessageIntent(
          captured,
          message,
          accepted.current ||
            state.route?.has_requests ||
            state.requests.length > 0
            ? 'follow_up'
            : 'start'
        );
      await submitSessionMessage(
        intent.current,
        sessionMessageConfiguration(projectId)
      );
      assertExecutionScope(captured);
      accepted.current = true;
      intent.current = null;
      setMessage('');
    } catch {
      if (!captured.signal.aborted) {
        setError(true);
        // Before submission it is safe to fix an unsupported configuration.
        // Once sent, Retry keeps the exact original body and identity.
        if (!intent.current?.deliveryAttempted) intent.current = null;
      }
    } finally {
      lock.current = false;
      if (!captured.signal.aborted) setBusy(false);
    }
  };
  const control = async (requestId: string, action: 'cancel' | 'now') => {
    if (controls.has(requestId)) return;
    setControls((previous) => new Set(previous).add(requestId));
    setError(false);
    const captured = { ...scope, signal: lifetime.current.signal };
    try {
      if (action === 'cancel')
        await cancelSessionExecution(captured, requestId);
      else {
        const operation =
          operations.current.get(requestId) ?? crypto.randomUUID();
        operations.current.set(requestId, operation);
        await sendSessionExecutionNow(captured, requestId, operation);
      }
    } catch {
      if (!captured.signal.aborted) setError(true);
    } finally {
      if (!captured.signal.aborted) {
        refreshSessionExecution(scope);
        setControls((previous) => {
          const next = new Set(previous);
          next.delete(requestId);
          return next;
        });
      }
    }
  };
  return (
    <SessionArtifactPreview scope={scope}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          ref={scroll}
          className="scrollbar-always-visible min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        >
          <EventNativeProjectTimeline
            projectId={projectId}
            sessionMode={SessionMode.SINGLE_AGENT}
            scrollContainerRef={scroll}
            scrollBottomInsetPx={0}
          />
        </div>
        <div className="flex flex-col gap-3 p-4">
          {unsupportedInput && (
            <div role="alert">
              <DsText>{t('chat.parallel-unsupported')}</DsText>
            </div>
          )}
          {unsupportedHandoff && (
            <div role="alert">
              <DsText>{t('chat.parallel-handoff-unsupported')}</DsText>
              <DsText className="break-all whitespace-pre-wrap">
                {externalDraft.content}
              </DsText>
            </div>
          )}
          {state.route?.entry_enabled && !state.route.eligible && (
            <DsText>{t('chat.parallel-configuration-required')}</DsText>
          )}
          <div aria-live="polite" className="flex flex-wrap items-center gap-2">
            <DsText role="meta">
              {t(
                !state.route?.entry_enabled
                  ? 'chat.parallel-disabled'
                  : active.some((request) => request.cancel_requested)
                    ? 'chat.parallel-stopping'
                    : active.length
                      ? 'chat.parallel-active'
                      : 'chat.parallel-ready'
              )}
            </DsText>
            {active.some((request) => request.wait_reason) && (
              <DsText role="meta">{t('chat.parallel-waiting')}</DsText>
            )}
            {active
              .filter(
                (request) =>
                  request.status === 'admitted' ||
                  request.status === 'preparing'
              )
              .map((request) => (
                <Button
                  key={request.request_id}
                  variant="secondary"
                  disabled={
                    controls.has(request.request_id) || request.cancel_requested
                  }
                  onClick={() => {
                    void control(request.request_id, 'cancel');
                  }}
                >
                  {t('chat.parallel-stop')}
                </Button>
              ))}
          </div>
          {(error || Boolean(state.error)) && (
            <div role="alert" className="flex flex-wrap items-center gap-2">
              <DsText>{t('chat.parallel-request-failed')}</DsText>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  if (intent.current) void send();
                  else refreshSessionExecution(scope);
                }}
              >
                {t('chat.parallel-retry')}
              </Button>
            </div>
          )}
          {state.nextCursor !== null && (
            <Button
              variant="ghost"
              onClick={() => {
                void loadMoreSessionExecutions({
                  ...scope,
                  signal: lifetime.current.signal,
                }).catch(() => setError(true));
              }}
            >
              {t('chat.parallel-more')}
            </Button>
          )}
          <BottomBox
            state="input"
            resourcePickersEnabled={false}
            queuedMessages={queue}
            queueContext={{ sessionId: projectId, busy: active.length > 0 }}
            onRemoveQueuedMessage={(id) => control(id, 'cancel')}
            onSendQueuedMessageNow={(id) => {
              void control(id, 'now');
            }}
            sessionMode={SessionMode.SINGLE_AGENT}
            modelSelectProjectId={projectId}
            modelSelectDisabled={
              busy || Boolean(intent.current?.deliveryAttempted)
            }
            inputProps={{
              value: message,
              onChange: setMessage,
              onSend: () => {
                void send();
              },
              queuesFollowUp: active.length > 0,
              files: [],
              allowDragDrop: false,
              attachmentsEnabled: false,
              onUnsupportedAttachment: () => setUnsupportedInput(true),
              textareaRef: textarea,
              placeholder: t('chat.parallel-placeholder'),
              disabled:
                busy ||
                Boolean(unsupportedHandoff) ||
                Boolean(intent.current?.deliveryAttempted) ||
                !state.route?.entry_enabled,
            }}
          />
        </div>
      </div>
    </SessionArtifactPreview>
  );
}
