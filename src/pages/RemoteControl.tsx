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

import { Button } from '@/components/ui/button';
import {
  completeProjectViewResync,
  importLegacyChatSteps,
  projectRawEvents,
  projectSnapshot,
  selectPendingLegacyAsk,
  type ProjectedLegacyStep,
  type ProjectViewState,
} from '@/lib/projector';
import {
  mergeLocalRemoteCommandStatus,
  remoteControlErrorText,
  type LocalRemoteCommandStatus,
} from '@/lib/remoteCommandStatus';
import {
  extendRemoteControlSession,
  getRemoteControlSession,
  getRemoteControlSnapshot,
  getRemoteControlWebSocketUrl,
  listRemoteControlEvents,
  listRemoteControlSteps,
  RemoteControlSession,
  RemoteControlStep,
  revokeRemoteControlSession,
  sendRemoteControlCommand,
} from '@/lib/remoteControl';
import {
  Ban,
  Clock3,
  Loader2,
  RefreshCw,
  SendHorizontal,
  ShieldX,
  SkipForward,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

type CommandStatus = LocalRemoteCommandStatus;

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object'
    ? (value as Record<string, any>)
    : {};
}

function getAskAgent(step: RemoteControlStep | null): string {
  return String(asRecord(step?.data).agent || '');
}

function getAskText(step: RemoteControlStep | null): string {
  const data = asRecord(step?.data);
  return String(
    data.content ||
      data.notice ||
      data.answer ||
      data.question ||
      (typeof step?.data === 'string' ? step.data : '')
  );
}

function renderStepData(data: unknown): string {
  if (typeof data === 'string') {
    return data;
  }
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function remoteControlStep(step: ProjectedLegacyStep): RemoteControlStep {
  return {
    step_id: step.stepId,
    task_id: step.taskId,
    project_id: step.projectId,
    step: step.step,
    data: step.data,
    timestamp: step.timestamp,
  };
}

function projectedSteps(view: ProjectViewState): RemoteControlStep[] {
  return view.legacySteps.map(remoteControlStep);
}

function getRemoteLinkToken(searchParams: URLSearchParams): string {
  const hash = window.location.hash.replace(/^#/, '');
  const fragmentToken = new URLSearchParams(hash).get('t');
  if (fragmentToken) {
    return fragmentToken;
  }
  return searchParams.get('t') || '';
}

export default function RemoteControlPage() {
  const { t, i18n } = useTranslation();
  const { sessionId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const linkToken = getRemoteLinkToken(searchParams);
  const [session, setSession] = useState<RemoteControlSession | null>(null);
  const [steps, setSteps] = useState<RemoteControlStep[]>([]);
  const [commands, setCommands] = useState<CommandStatus[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [controlLoading, setControlLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answeredAskStepIds, setAnsweredAskStepIds] = useState<
    Set<number | string>
  >(() => new Set());
  const nextSinceRef = useRef(0);
  const projectorRef = useRef<ProjectViewState | null>(null);
  const [projectView, setProjectView] = useState<ProjectViewState | null>(null);
  const syncInFlightRef = useRef<Promise<void> | null>(null);

  const bridgeOnline =
    session?.status === 'active' && session?.bridge_status === 'online';

  const lastCommand = useMemo(() => commands.slice().reverse()[0], [commands]);
  const freshnessLabel = useMemo(() => {
    if (!projectView)
      return t('layout.remote-control-history-loading', {
        defaultValue: 'Cloud history is loading',
      });
    if (projectView.needsResync)
      return t('layout.remote-control-history-resync-required', {
        defaultValue: 'History resync required',
      });
    const syncedAt = projectView.lastSyncedAt
      ? new Date(projectView.lastSyncedAt).toLocaleTimeString(
          i18n.resolvedLanguage || i18n.language
        )
      : t('layout.remote-control-not-synced', {
          defaultValue: 'not synced',
        });
    const coverage = projectView.eventsTruncated
      ? t('layout.remote-control-partial-history', {
          defaultValue: 'partial history',
        })
      : t('layout.remote-control-full-history', {
          defaultValue: 'full history',
        });
    return t('layout.remote-control-history-status', {
      defaultValue: 'Cursor {{cursor}} · {{coverage}} · synced {{time}}',
      cursor: projectView.currentCursor,
      coverage,
      time: syncedAt,
    });
  }, [i18n.language, i18n.resolvedLanguage, projectView, t]);
  const pendingAsk = useMemo(() => {
    if (!projectView) return null;
    const ask = selectPendingLegacyAsk(projectView, answeredAskStepIds);
    return ask ? remoteControlStep(ask) : null;
  }, [answeredAskStepIds, projectView]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!sessionId || !linkToken) {
        setError(
          i18n.t('layout.remote-control-missing-token', {
            defaultValue: 'Remote control link is missing a token.',
          })
        );
        setLoading(false);
        return;
      }
      try {
        const loadedSession = await getRemoteControlSession(
          sessionId,
          linkToken
        );
        const history = await listRemoteControlSteps(
          sessionId,
          linkToken,
          0,
          1000
        );
        let projected: ProjectViewState;
        try {
          const snapshot = await getRemoteControlSnapshot(
            sessionId,
            linkToken,
            loadedSession.current_project_id || loadedSession.project_id,
            5000
          );
          const projectedSnapshot = projectSnapshot(snapshot);
          projected = {
            ...projectRawEvents(
              snapshot.project_id,
              importLegacyChatSteps(history.items || []),
              'rehydrate',
              projectedSnapshot
            ).state,
            eventsTruncated:
              snapshot.events_truncated || Boolean(history.has_more),
          };
        } catch (snapshotError) {
          // Rolling upgrades may briefly serve the legacy ChatStep endpoint
          // before snapshot/cursor APIs are available. The same pure reducer
          // keeps that compatibility path side-effect free.
          console.warn(
            '[RemoteControl] canonical snapshot unavailable; using legacy importer',
            snapshotError
          );
          const projectId =
            loadedSession.current_project_id ||
            loadedSession.project_id ||
            history.items?.[0]?.project_id ||
            'legacy-project';
          projected = projectRawEvents(
            projectId,
            importLegacyChatSteps(history.items || []),
            'rehydrate'
          ).state;
        }
        if (cancelled) {
          return;
        }
        setSession(loadedSession);
        const syncedProjection = {
          ...projected,
          lastSyncedAt: new Date().toISOString(),
        };
        projectorRef.current = syncedProjection;
        setProjectView(syncedProjection);
        setSteps(projectedSteps(syncedProjection));
        nextSinceRef.current = history.next_since || 0;
      } catch (err: any) {
        setError(
          remoteControlErrorText(
            err?.message ||
              i18n.t('layout.remote-control-open-failed', {
                defaultValue: 'Failed to open remote control session.',
              }),
            i18n.t.bind(i18n)
          )
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [i18n, linkToken, sessionId]);

  useEffect(() => {
    if (!sessionId || !linkToken) {
      return;
    }
    let ws: WebSocket | null = null;
    let pingTimer: number | null = null;
    let reconnectTimer: number | null = null;
    let reconnectAttempts = 0;
    let stopped = false;

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer !== null) return;
      const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000);
      reconnectAttempts += 1;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    };

    const publishProjection = (next: ProjectViewState) => {
      projectorRef.current = next;
      setProjectView(next);
      setSteps(projectedSteps(next));
    };

    const applyCanonicalEvents = (events: unknown[]) => {
      const current = projectorRef.current;
      if (!current || !events.length) {
        return;
      }
      const projected = projectRawEvents(current.projectId, events, 'live', {
        ...current,
        mode: 'live',
      });
      publishProjection({
        ...projected.state,
        lastSyncedAt: new Date().toISOString(),
      });
      if (
        projected.effects.some((effect) => effect.type === 'request_resync')
      ) {
        void syncDeltas().catch((error) => {
          console.warn('[RemoteControl] cursor recovery failed', error);
        });
      }
    };

    const rehydrateSnapshot = async () => {
      const current = projectorRef.current;
      const snapshot = await getRemoteControlSnapshot(
        sessionId,
        linkToken,
        current?.projectId,
        5000
      );
      if (!stopped) {
        publishProjection({
          ...projectSnapshot(snapshot, current),
          lastSyncedAt: new Date().toISOString(),
        });
      }
    };

    const syncDeltas = async () => {
      if (syncInFlightRef.current) {
        return syncInFlightRef.current;
      }
      const operation = (async () => {
        let cursor = projectorRef.current?.currentCursor || 0;
        let authoritativeCursor = cursor;
        for (;;) {
          const page = await listRemoteControlEvents(
            sessionId,
            linkToken,
            cursor,
            1000,
            projectorRef.current?.projectId
          );
          if (stopped) return;
          applyCanonicalEvents(page.items || []);
          const nextCursor = page.next_cursor;
          authoritativeCursor = page.current_cursor;
          if (!page.has_more) break;
          if (nextCursor <= cursor) {
            console.warn(
              '[RemoteControl] event page did not advance; rehydrating snapshot'
            );
            await rehydrateSnapshot();
            return;
          }
          cursor = nextCursor;
        }
        const view = projectorRef.current;
        if (view?.needsResync) {
          const recovered = completeProjectViewResync(
            view,
            authoritativeCursor
          );
          if (recovered === view) {
            await rehydrateSnapshot();
          } else {
            publishProjection(recovered);
          }
        }
      })().finally(() => {
        syncInFlightRef.current = null;
      });
      syncInFlightRef.current = operation;
      return operation;
    };

    async function connect() {
      let url: string;
      try {
        url = await getRemoteControlWebSocketUrl(
          `/api/v1/remote-control/sessions/${sessionId}/events/subscribe`
        );
      } catch (error) {
        console.warn('[RemoteControl] websocket setup failed', error);
        scheduleReconnect();
        return;
      }
      if (stopped) return;
      ws = new WebSocket(url);
      ws.onopen = () => {
        reconnectAttempts = 0;
        ws?.send(
          JSON.stringify({
            type: 'subscribe',
            link_token: linkToken,
            subscribed_project_id: projectorRef.current?.projectId,
            after_cursor: projectorRef.current?.currentCursor || 0,
          })
        );
        pingTimer = window.setInterval(() => {
          ws?.send(JSON.stringify({ type: 'ping' }));
        }, 30000);
      };
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'connected') {
            if (
              typeof payload.current_cursor === 'number' &&
              payload.current_cursor >
                (projectorRef.current?.currentCursor || 0)
            ) {
              void syncDeltas().catch((error) => {
                console.warn('[RemoteControl] cursor recovery failed', error);
              });
            }
          }
          if (payload.type === 'canonical_event') {
            applyCanonicalEvents([payload]);
          }
          if (payload.type === 'canonical_event_available') {
            void syncDeltas().catch((error) => {
              console.warn('[RemoteControl] cursor recovery failed', error);
            });
          }
          if (payload.type === 'snapshot_required') {
            void rehydrateSnapshot().catch((error) => {
              console.warn('[RemoteControl] snapshot rehydrate failed', error);
            });
          }
          if (
            (payload.type === 'pong' || payload.type === 'watermark') &&
            typeof payload.current_cursor === 'number' &&
            payload.current_cursor > (projectorRef.current?.currentCursor || 0)
          ) {
            void syncDeltas().catch((error) => {
              console.warn('[RemoteControl] cursor recovery failed', error);
            });
          }
          if (payload.type === 'step') {
            applyCanonicalEvents(importLegacyChatSteps([payload]));
            if (typeof payload.step_id === 'number') {
              nextSinceRef.current = Math.max(
                nextSinceRef.current,
                payload.step_id
              );
            }
          }
          if (payload.type === 'bridge_status') {
            setSession((current) =>
              current ? { ...current, bridge_status: payload.status } : current
            );
          }
          if (payload.type === 'session_revoked') {
            setSession((current) =>
              current
                ? { ...current, status: 'revoked', bridge_status: 'offline' }
                : current
            );
          }
          if (payload.type === 'command_status') {
            setCommands((current) =>
              mergeLocalRemoteCommandStatus(current, {
                id: payload.command_id,
                content: i18n.t('layout.remote-control-command', {
                  defaultValue: 'Remote command',
                }),
                type: 'unknown',
                status: payload.status,
                error: payload.error,
              })
            );
          }
          if (payload.type === 'command_event' && payload.projection) {
            const projection = payload.projection;
            const status =
              projection.execution_state !== 'not_started'
                ? projection.execution_state
                : projection.admission_state !== 'unknown'
                  ? projection.admission_state
                  : projection.receipt_state;
            setCommands((current) =>
              mergeLocalRemoteCommandStatus(current, {
                id: payload.command_id,
                content: i18n.t('layout.remote-control-command', {
                  defaultValue: 'Remote command',
                }),
                type: 'unknown',
                status,
                error: projection.integrity_alert || undefined,
              })
            );
          }
        } catch (err) {
          console.warn('[RemoteControl] invalid ws message', err);
        }
      };
      ws.onclose = () => {
        if (pingTimer) {
          window.clearInterval(pingTimer);
          pingTimer = null;
        }
        scheduleReconnect();
      };
    }

    void connect();
    return () => {
      stopped = true;
      if (pingTimer) {
        window.clearInterval(pingTimer);
      }
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      ws?.close();
    };
  }, [i18n, linkToken, sessionId]);

  const submit = async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || sending || !bridgeOnline) {
      return;
    }
    setSending(true);
    try {
      const ask = pendingAsk;
      const type = ask ? 'human_reply' : 'user_message';
      const payload = ask
        ? { agent: getAskAgent(ask), reply: trimmed }
        : { content: trimmed, attachments: [] };
      if (ask && !payload.agent) {
        toast.error(
          t('layout.remote-control-question-missing-agent', {
            defaultValue: 'This question is missing an agent name.',
          })
        );
        return;
      }
      const res = await sendRemoteControlCommand(
        sessionId,
        type,
        payload,
        undefined,
        linkToken
      );
      setCommands((current) => [
        ...current,
        { id: res.command_id, content: trimmed, type, status: res.status },
      ]);
      if (ask) {
        setAnsweredAskStepIds((current) => {
          const next = new Set(current);
          next.add(ask.step_id);
          return next;
        });
      }
      setMessage('');
    } catch (err: any) {
      toast.error(
        remoteControlErrorText(
          err?.message ||
            t('layout.remote-control-send-failed', {
              defaultValue: 'Failed to send remote command.',
            }),
          t
        )
      );
    } finally {
      setSending(false);
    }
  };

  const sendControlCommand = async (
    type: 'stop' | 'skip_task',
    label: string,
    confirmText: string
  ) => {
    if (!bridgeOnline || controlLoading) {
      return;
    }
    if (!window.confirm(confirmText)) {
      return;
    }
    setControlLoading(type);
    try {
      const res = await sendRemoteControlCommand(
        sessionId,
        type,
        {},
        undefined,
        linkToken
      );
      setCommands((current) => [
        ...current,
        { id: res.command_id, content: label, type, status: res.status },
      ]);
      toast.success(
        t('layout.remote-control-command-sent', {
          defaultValue: '{{label}} command sent',
          label,
        })
      );
    } catch (err: any) {
      toast.error(
        remoteControlErrorText(
          err?.message ||
            t('layout.remote-control-control-command-failed', {
              defaultValue: 'Failed to send {{label}}.',
              label: label.toLocaleLowerCase(
                i18n.resolvedLanguage || i18n.language
              ),
            }),
          t
        )
      );
    } finally {
      setControlLoading(null);
    }
  };

  const extendSession = async () => {
    if (controlLoading) {
      return;
    }
    setControlLoading('extend');
    try {
      const res = await extendRemoteControlSession(sessionId, 86400, linkToken);
      setSession((current) =>
        current ? { ...current, expires_at: res.expires_at } : current
      );
      toast.success(
        t('layout.remote-control-link-extended', {
          defaultValue: 'Remote control link extended',
        })
      );
    } catch (err: any) {
      toast.error(
        remoteControlErrorText(
          err?.message ||
            t('layout.remote-control-extend-failed', {
              defaultValue: 'Failed to extend remote control link.',
            }),
          t
        )
      );
    } finally {
      setControlLoading(null);
    }
  };

  const revokeSession = async () => {
    if (
      controlLoading ||
      !window.confirm(
        t('layout.remote-control-revoke-confirm', {
          defaultValue: 'Revoke this remote control link?',
        })
      )
    ) {
      return;
    }
    setControlLoading('revoke');
    try {
      await revokeRemoteControlSession(sessionId, linkToken);
      setSession((current) =>
        current
          ? { ...current, status: 'revoked', bridge_status: 'offline' }
          : current
      );
      toast.success(
        t('layout.remote-control-link-revoked', {
          defaultValue: 'Remote control link revoked',
        })
      );
    } catch (err: any) {
      toast.error(
        remoteControlErrorText(
          err?.message ||
            t('layout.remote-control-revoke-failed', {
              defaultValue: 'Failed to revoke remote control link.',
            }),
          t
        )
      );
    } finally {
      setControlLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ds-neutral-subtle-default text-ds-ink-default-default">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ds-neutral-subtle-default px-4 text-ds-ink-default-default">
        <div className="w-full max-w-md rounded-xl border border-x border-y border-solid border-ds-hairline-default-default bg-ds-neutral-default-default p-5">
          <h1 className="!text-ds-text-title font-semibold text-ds-ink-default-default">
            {t('layout.remote-control-unavailable', {
              defaultValue: 'Remote control unavailable',
            })}
          </h1>
          <p className="mt-2 !text-ds-text-base text-ds-ink-muted-default">
            {error}
          </p>
        </div>
      </div>
    );
  }

  return (
    <main className="flex min-h-screen bg-ds-neutral-subtle-default text-ds-ink-default-default">
      <section className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-4 sm:px-6">
        <header className="flex flex-col gap-3 border-x-0 border-t-0 border-b border-solid border-ds-hairline-default-default pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate !text-ds-text-body-large font-semibold text-ds-ink-default-default">
                {session.title ||
                  t('layout.remote-control-title', {
                    defaultValue: 'Remote control',
                  })}
              </h1>
              <p className="mt-1 !text-ds-text-meta text-ds-ink-muted-default">
                {bridgeOnline
                  ? t('layout.remote-control-desktop-online', {
                      defaultValue: 'Desktop is online',
                    })
                  : t('layout.remote-control-desktop-offline-description', {
                      defaultValue:
                        'Desktop is offline. Keep Eigent open on the original computer and stay on the chat view.',
                    })}
              </p>
              <p
                className={`mt-1 !text-ds-text-meta ${
                  projectView?.needsResync
                    ? 'text-ds-text-warning-strong-default'
                    : 'text-ds-ink-muted-default'
                }`}
              >
                {freshnessLabel}
              </p>
            </div>
            <div
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                bridgeOnline
                  ? 'bg-ds-bg-success-default-default'
                  : 'bg-ds-bg-error-default-default'
              }`}
              aria-label={
                bridgeOnline
                  ? t('layout.online', { defaultValue: 'online' })
                  : t('layout.offline', { defaultValue: 'offline' })
              }
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!bridgeOnline || !!controlLoading}
              onClick={() =>
                sendControlCommand(
                  'skip_task',
                  t('layout.remote-control-stop-task', {
                    defaultValue: 'Stop task',
                  }),
                  t('layout.remote-control-stop-task-confirm', {
                    defaultValue: 'Stop the current desktop task gracefully?',
                  })
                )
              }
            >
              <SkipForward className="h-4 w-4" />
              {t('layout.remote-control-stop-task', {
                defaultValue: 'Stop task',
              })}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!bridgeOnline || !!controlLoading}
              onClick={() =>
                sendControlCommand(
                  'stop',
                  t('layout.remote-control-force-stop', {
                    defaultValue: 'Force stop',
                  }),
                  t('layout.remote-control-force-stop-confirm', {
                    defaultValue: 'Force stop the current desktop task?',
                  })
                )
              }
            >
              <Ban className="h-4 w-4" />
              {t('layout.remote-control-force-stop', {
                defaultValue: 'Force stop',
              })}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!!controlLoading || session.status !== 'active'}
              onClick={extendSession}
            >
              <Clock3 className="h-4 w-4" />
              {t('layout.remote-control-extend-link', {
                defaultValue: 'Extend link',
              })}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!!controlLoading || session.status !== 'active'}
              onClick={revokeSession}
            >
              <ShieldX className="h-4 w-4" />
              {t('layout.remote-control-revoke-link', {
                defaultValue: 'Revoke link',
              })}
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto py-4">
          <div className="space-y-3">
            {steps.length === 0 ? (
              <div className="rounded-xl border border-x border-y border-solid border-ds-hairline-default-default bg-ds-neutral-default-default p-4 !text-ds-text-base text-ds-ink-muted-default">
                {t('layout.remote-control-events-empty', {
                  defaultValue: 'No remote events yet.',
                })}
              </div>
            ) : (
              steps.map((step) => (
                <article
                  key={step.step_id}
                  className="rounded-xl border border-x border-y border-solid border-ds-hairline-default-default bg-ds-neutral-default-default p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="!text-ds-text-meta font-medium text-ds-ink-muted-default uppercase">
                      {step.step}
                    </span>
                    <span className="!text-ds-text-meta text-ds-ink-muted-default">
                      #{step.step_id}
                    </span>
                  </div>
                  <pre className="mt-2 max-h-72 overflow-auto !text-ds-text-base leading-6 break-words whitespace-pre-wrap text-ds-ink-default-default">
                    {renderStepData(step.data)}
                  </pre>
                </article>
              ))
            )}
          </div>
        </div>

        {lastCommand?.status === 'failed' &&
          lastCommand.type === 'user_message' && (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-x border-y border-solid border-ds-border-error-default-default bg-ds-bg-error-subtle-default p-3 !text-ds-text-base text-ds-text-error-strong-default">
              <span className="min-w-0 truncate">
                {t('layout.remote-control-send-error', {
                  defaultValue: 'Send failed: {{error}}',
                  error: lastCommand.error
                    ? remoteControlErrorText(lastCommand.error, t)
                    : lastCommand.content,
                })}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => submit(lastCommand.content)}
              >
                <RefreshCw className="h-4 w-4" />
                {t('layout.remote-control-resend', {
                  defaultValue: 'Resend',
                })}
              </Button>
            </div>
          )}

        <form
          className="flex items-end gap-2 border-x-0 border-t border-b-0 border-solid border-ds-hairline-default-default pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(message);
          }}
        >
          <textarea
            className="min-h-12 flex-1 resize-none rounded-xl border border-x border-y border-solid border-ds-hairline-default-default bg-ds-neutral-default-default px-3 py-2 !text-ds-text-base text-ds-ink-default-default outline-none focus:border-ds-ring-focus"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={
              bridgeOnline
                ? pendingAsk
                  ? getAskText(pendingAsk) ||
                    t('layout.remote-control-reply-placeholder', {
                      defaultValue: 'Reply to the desktop question',
                    })
                  : t('layout.remote-control-follow-up-placeholder', {
                      defaultValue: 'Send a follow-up to the desktop task',
                    })
                : t('layout.remote-control-desktop-offline', {
                    defaultValue: 'Desktop is offline',
                  })
            }
            disabled={!bridgeOnline || sending}
            rows={2}
          />
          <Button
            variant="primary"
            size="md"
            buttonContent="icon-only"
            type="submit"
            disabled={!bridgeOnline || sending || !message.trim()}
            aria-label={t('layout.send', { defaultValue: 'Send' })}
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SendHorizontal className="h-4 w-4" />
            )}
          </Button>
        </form>
      </section>
    </main>
  );
}
