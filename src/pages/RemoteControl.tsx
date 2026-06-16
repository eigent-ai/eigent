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
  extendRemoteControlSession,
  getRemoteControlSession,
  getRemoteControlWebSocketUrl,
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
import { useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

type CommandStatus = {
  id: string;
  content: string;
  type: string;
  status: string;
  error?: string;
};

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

function getRemoteLinkToken(searchParams: URLSearchParams): string {
  const hash = window.location.hash.replace(/^#/, '');
  const fragmentToken = new URLSearchParams(hash).get('t');
  if (fragmentToken) {
    return fragmentToken;
  }
  return searchParams.get('t') || '';
}

export default function RemoteControlPage() {
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
  const [answeredAskStepIds, setAnsweredAskStepIds] = useState<Set<number>>(
    () => new Set()
  );
  const nextSinceRef = useRef(0);

  const bridgeOnline =
    session?.status === 'active' && session?.bridge_status === 'online';

  const lastCommand = useMemo(() => commands.slice().reverse()[0], [commands]);
  const pendingAsk = useMemo(() => {
    const latest = steps[steps.length - 1] || null;
    if (latest?.step === 'ask' && !answeredAskStepIds.has(latest.step_id)) {
      return latest;
    }
    return null;
  }, [answeredAskStepIds, steps]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!sessionId || !linkToken) {
        setError('Remote control link is missing a token.');
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
          200
        );
        if (cancelled) {
          return;
        }
        setSession(loadedSession);
        setSteps(history.items || []);
        nextSinceRef.current = history.next_since || 0;
      } catch (err: any) {
        setError(err?.message || 'Failed to open remote control session.');
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
  }, [linkToken, sessionId]);

  useEffect(() => {
    if (!sessionId || !linkToken) {
      return;
    }
    let ws: WebSocket | null = null;
    let pingTimer: number | null = null;
    let stopped = false;

    async function connect() {
      const url = await getRemoteControlWebSocketUrl(
        `/api/v1/remote-control/sessions/${sessionId}/events/subscribe`
      );
      if (stopped) {
        return;
      }
      ws = new WebSocket(url);
      ws.onopen = () => {
        ws?.send(
          JSON.stringify({
            type: 'subscribe',
            link_token: linkToken,
          })
        );
        pingTimer = window.setInterval(() => {
          ws?.send(JSON.stringify({ type: 'ping' }));
        }, 30000);
      };
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'step') {
            setSteps((current) => {
              if (current.some((step) => step.step_id === payload.step_id)) {
                return current;
              }
              nextSinceRef.current = Math.max(
                nextSinceRef.current,
                payload.step_id
              );
              return [...current, payload];
            });
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
              current.map((command) =>
                command.id === payload.command_id
                  ? {
                      ...command,
                      status: payload.status,
                      error: payload.error,
                    }
                  : command
              )
            );
          }
        } catch (err) {
          console.warn('[RemoteControl] invalid ws message', err);
        }
      };
      ws.onclose = () => {
        if (pingTimer) {
          window.clearInterval(pingTimer);
        }
      };
    }

    void connect();
    return () => {
      stopped = true;
      if (pingTimer) {
        window.clearInterval(pingTimer);
      }
      ws?.close();
    };
  }, [linkToken, sessionId]);

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
        toast.error('This question is missing an agent name.');
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
      toast.error(err?.message || 'Failed to send remote command.');
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
      toast.success(`${label} command sent`);
    } catch (err: any) {
      toast.error(err?.message || `Failed to send ${label.toLowerCase()}.`);
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
      toast.success('Remote control link extended');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to extend remote control link.');
    } finally {
      setControlLoading(null);
    }
  };

  const revokeSession = async () => {
    if (controlLoading || !window.confirm('Revoke this remote control link?')) {
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
      toast.success('Remote control link revoked');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to revoke remote control link.');
    } finally {
      setControlLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="bg-background text-foreground flex min-h-screen items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="bg-background text-foreground flex min-h-screen items-center justify-center px-4">
        <div className="border-border bg-card w-full max-w-md rounded-md border p-5">
          <h1 className="text-lg font-semibold">Remote control unavailable</h1>
          <p className="text-muted-foreground mt-2 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <main className="bg-background text-foreground flex min-h-screen">
      <section className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 py-4 sm:px-6">
        <header className="border-border flex flex-col gap-3 border-b pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">
                {session.title || 'Remote control'}
              </h1>
              <p className="text-muted-foreground mt-1 text-xs">
                {bridgeOnline
                  ? 'Desktop is online'
                  : 'Desktop is offline. Keep Eigent open on the original computer and stay on the chat view.'}
              </p>
            </div>
            <div
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                bridgeOnline ? 'bg-emerald-500' : 'bg-destructive'
              }`}
              aria-label={bridgeOnline ? 'online' : 'offline'}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="border-border bg-background inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!bridgeOnline || !!controlLoading}
              onClick={() =>
                sendControlCommand(
                  'skip_task',
                  'Stop task',
                  'Stop the current desktop task gracefully?'
                )
              }
            >
              <SkipForward className="h-4 w-4" />
              Stop task
            </button>
            <button
              className="border-border bg-background inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!bridgeOnline || !!controlLoading}
              onClick={() =>
                sendControlCommand(
                  'stop',
                  'Force stop',
                  'Force stop the current desktop task?'
                )
              }
            >
              <Ban className="h-4 w-4" />
              Force stop
            </button>
            <button
              className="border-border bg-background inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!!controlLoading || session.status !== 'active'}
              onClick={extendSession}
            >
              <Clock3 className="h-4 w-4" />
              Extend link
            </button>
            <button
              className="border-border bg-background inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!!controlLoading || session.status !== 'active'}
              onClick={revokeSession}
            >
              <ShieldX className="h-4 w-4" />
              Revoke link
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto py-4">
          <div className="space-y-3">
            {steps.length === 0 ? (
              <div className="border-border bg-card text-muted-foreground rounded-md border p-4 text-sm">
                No remote events yet.
              </div>
            ) : (
              steps.map((step) => (
                <article
                  key={step.step_id}
                  className="border-border bg-card rounded-md border p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground text-xs font-medium uppercase">
                      {step.step}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      #{step.step_id}
                    </span>
                  </div>
                  <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-sm leading-6">
                    {renderStepData(step.data)}
                  </pre>
                </article>
              ))
            )}
          </div>
        </div>

        {lastCommand?.status === 'failed' &&
          lastCommand.type === 'user_message' && (
            <div className="border-destructive/30 bg-destructive/10 mb-3 flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
              <span className="min-w-0 truncate">
                Send failed: {lastCommand.error || lastCommand.content}
              </span>
              <button
                className="border-border bg-background inline-flex h-8 shrink-0 items-center gap-2 rounded-md border px-3 text-sm"
                onClick={() => submit(lastCommand.content)}
              >
                <RefreshCw className="h-4 w-4" />
                Resend
              </button>
            </div>
          )}

        <form
          className="border-border flex items-end gap-2 border-t pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(message);
          }}
        >
          <textarea
            className="border-border bg-card focus:border-primary min-h-12 flex-1 resize-none rounded-md border px-3 py-2 text-sm outline-none"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={
              bridgeOnline
                ? pendingAsk
                  ? getAskText(pendingAsk) || 'Reply to the desktop question'
                  : 'Send a follow-up to the desktop task'
                : 'Desktop is offline'
            }
            disabled={!bridgeOnline || sending}
            rows={2}
          />
          <button
            className="bg-primary text-primary-foreground inline-flex h-12 w-12 items-center justify-center rounded-md disabled:cursor-not-allowed disabled:opacity-50"
            type="submit"
            disabled={!bridgeOnline || sending || !message.trim()}
            aria-label="Send"
          >
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SendHorizontal className="h-4 w-4" />
            )}
          </button>
        </form>
      </section>
    </main>
  );
}
