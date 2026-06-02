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

import eigentAppIconBlack from '@/assets/logo/icon_black.svg';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  applyRemoteControlProjectRun,
  createRemoteControlProject,
  discardRemoteControlProjectOverlays,
  extendRemoteControlSession,
  getRemoteControlEventSocketUrl,
  getRemoteControlSession,
  getRemoteControlTarget,
  isRemoteControlTargetReady,
  listRemoteControlOverlays,
  listRemoteControlProjects,
  listRemoteControlSteps,
  patchRemoteControlTarget,
  refreshRemoteControlProject,
  RemoteControlError,
  RemoteControlProject,
  RemoteControlSession,
  RemoteControlSpace,
  RemoteControlStep,
  RemoteControlTarget,
  revokeRemoteControlSession,
  sendRemoteControlCommand,
} from '@web/api/remoteControl';
import { ConversationTurnCard } from '@web/components/remote/ConversationTurnCard';
import { RemoteInputBox } from '@web/components/remote/RemoteInputBox';
import { RemoteSettingsPanel } from '@web/components/remote/RemoteSettingsPanel';
import { RemoteSidePanel } from '@web/components/remote/RemoteSidePanel';
import { parseRemoteControlToken } from '@web/lib/remoteControlToken';
import { buildTurns } from '@web/lib/remoteControlTurns';
import {
  Loader2,
  Menu,
  MessageSquareText,
  RefreshCw,
  Settings,
} from 'lucide-react';
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';

type CommandStatus = {
  id: string;
  content: string;
  type: string;
  status: string;
  error?: string;
};

type RemotePageError = {
  message: string;
  status?: number;
  code?: string | null;
};

const MAX_STEPS_IN_MEMORY = 500;
const WS_PING_INTERVAL_MS = 30_000;
const WS_PONG_TIMEOUT_MS = 75_000;
const SWITCH_TARGET_TIMEOUT_MS = 60_000;

function appendStep(
  list: RemoteControlStep[],
  step: RemoteControlStep
): RemoteControlStep[] {
  if (list.some((existing) => existing.step_id === step.step_id)) {
    return list;
  }
  const next = [...list, step];
  return next.length > MAX_STEPS_IN_MEMORY
    ? next.slice(next.length - MAX_STEPS_IN_MEMORY)
    : next;
}

function mergeSteps(
  current: RemoteControlStep[],
  incoming: RemoteControlStep[],
  replace: boolean
): RemoteControlStep[] {
  const base = replace ? [] : current;
  const existing = new Set(base.map((step) => step.step_id));
  const merged = [...base];
  for (const step of incoming) {
    if (!existing.has(step.step_id)) {
      existing.add(step.step_id);
      merged.push(step);
    }
  }
  if (merged.length > MAX_STEPS_IN_MEMORY) {
    return merged.slice(merged.length - MAX_STEPS_IN_MEMORY);
  }
  return merged;
}

function toPageError(err: unknown, fallback: string): RemotePageError {
  if (err instanceof RemoteControlError) {
    return {
      message: err.message || fallback,
      status: err.status,
      code: err.code,
    };
  }
  if (err instanceof Error) {
    return { message: err.message || fallback };
  }
  return { message: fallback };
}

function errorHint(error: RemotePageError): string {
  if (error.status === 403 || error.status === 404) {
    return 'The link is invalid or has expired. Ask the desktop owner to generate a new one.';
  }
  if (error.status === 410) {
    return 'This remote session has been revoked or has expired.';
  }
  if (error.code === 'BRIDGE_OFFLINE') {
    return 'The desktop bridge is offline. Keep Eigent running on the original computer.';
  }
  if (error.status && error.status >= 500) {
    return 'The Eigent server is having trouble. Try again in a moment.';
  }
  return 'Check your network connection and try again.';
}

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

export default function RemoteControlPage() {
  const { sessionId = '' } = useParams();
  const linkToken = useMemo(
    () => parseRemoteControlToken(window.location.search, window.location.hash),
    []
  );
  const [session, setSession] = useState<RemoteControlSession | null>(null);
  const [space, setSpace] = useState<RemoteControlSpace | null>(null);
  const [projects, setProjects] = useState<RemoteControlProject[]>([]);
  const [steps, setSteps] = useState<RemoteControlStep[]>([]);
  const [commands, setCommands] = useState<CommandStatus[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [projectLoading, setProjectLoading] = useState(false);
  const [controlLoading, setControlLoading] = useState<string | null>(null);
  const [error, setError] = useState<RemotePageError | null>(null);
  const [reloading, setReloading] = useState(false);
  const [answeredAskStepIds, setAnsweredAskStepIds] = useState<Set<number>>(
    () => new Set()
  );
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);

  const nextSinceRef = useRef(0);
  const targetRef = useRef<RemoteControlTarget | null>(null);
  const eventSocketRef = useRef<WebSocket | null>(null);
  const switchTimeoutRef = useRef<number | null>(null);

  const clearSwitchTimeout = useCallback(() => {
    if (switchTimeoutRef.current !== null) {
      window.clearTimeout(switchTimeoutRef.current);
      switchTimeoutRef.current = null;
    }
  }, []);

  const target = useMemo(
    () => (session ? getRemoteControlTarget(session) : null),
    [session]
  );
  targetRef.current = target;

  const bridgeOnline =
    session?.status === 'active' && session?.bridge_status === 'online';
  const ready =
    bridgeOnline && !projectLoading && isRemoteControlTargetReady(target);
  const activeProject = useMemo(
    () => projects.find((project) => project.id === target?.project_id) || null,
    [projects, target?.project_id]
  );
  const folderBacked = space?.source_type === 'folder';
  const lastCommand = useMemo(() => commands.slice().reverse()[0], [commands]);
  const pendingAsk = useMemo(() => {
    const latest = steps[steps.length - 1] || null;
    if (latest?.step === 'ask' && !answeredAskStepIds.has(latest.step_id)) {
      return latest;
    }
    return null;
  }, [answeredAskStepIds, steps]);

  const turns = useMemo(() => buildTurns(steps, commands), [steps, commands]);

  const loadSteps = useCallback(
    async (historyTarget: RemoteControlTarget | null, since = 0) => {
      if (!sessionId || !linkToken || !historyTarget?.project_id) return;
      try {
        const history = await listRemoteControlSteps(
          sessionId,
          linkToken,
          historyTarget.project_id,
          since,
          200
        );
        setSteps((current) =>
          mergeSteps(current, history.items || [], since === 0)
        );
        nextSinceRef.current = history.next_since || since;
      } catch (err) {
        const pageError = toPageError(err, 'Failed to load project history');
        toast.error(pageError.message, { description: errorHint(pageError) });
      }
    },
    [linkToken, sessionId]
  );

  const reloadSession = useCallback(async () => {
    if (!sessionId || !linkToken) {
      setError({ message: 'Remote control link is missing a token.' });
      setLoading(false);
      return;
    }
    setError(null);
    const [loadedSession, projectList] = await Promise.all([
      getRemoteControlSession(sessionId, linkToken),
      listRemoteControlProjects(sessionId, linkToken),
    ]);
    const loadedTarget = getRemoteControlTarget(loadedSession);
    setSession(loadedSession);
    setSpace(projectList.space);
    setProjects(projectList.items || []);
    if (loadedTarget.project_id) {
      await loadSteps(loadedTarget, 0);
    } else {
      setSteps([]);
      nextSinceRef.current = 0;
    }
  }, [linkToken, loadSteps, sessionId]);

  const retryLoad = useCallback(async () => {
    if (reloading) return;
    setReloading(true);
    setLoading(true);
    try {
      await reloadSession();
    } catch (err) {
      setError(toPageError(err, 'Failed to open remote control session.'));
    } finally {
      setReloading(false);
      setLoading(false);
    }
  }, [reloadSession, reloading]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        await reloadSession();
      } catch (err) {
        if (!cancelled) {
          setError(toPageError(err, 'Failed to open remote control session.'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [reloadSession]);

  useEffect(() => {
    if (!sessionId || !linkToken) return;
    let ws: WebSocket | null = null;
    let pingTimer: number | null = null;
    let watchdogTimer: number | null = null;
    let reconnectTimer: number | null = null;
    let reconnectAttempt = 0;
    let stopped = false;
    let lastPongAt = Date.now();
    let isReconnect = false;

    const armWatchdog = () => {
      if (watchdogTimer) window.clearInterval(watchdogTimer);
      watchdogTimer = window.setInterval(() => {
        if (Date.now() - lastPongAt > WS_PONG_TIMEOUT_MS) ws?.close();
      }, WS_PING_INTERVAL_MS);
    };

    const connect = () => {
      ws = new WebSocket(getRemoteControlEventSocketUrl(sessionId));
      eventSocketRef.current = ws;
      ws.onopen = () => {
        reconnectAttempt = 0;
        lastPongAt = Date.now();
        ws?.send(
          JSON.stringify({
            type: 'subscribe',
            link_token: linkToken,
            subscribed_project_id: targetRef.current?.project_id || null,
          })
        );
        if (isReconnect) {
          void reloadSession().catch(() => {});
        }
        void loadSteps(targetRef.current, nextSinceRef.current);
        pingTimer = window.setInterval(() => {
          ws?.send(JSON.stringify({ type: 'ping' }));
        }, WS_PING_INTERVAL_MS);
        armWatchdog();
      };
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          lastPongAt = Date.now();
          if (payload.type === 'connected') {
            setSession((current) =>
              current
                ? {
                    ...current,
                    bridge_status: payload.bridge_status,
                    current_project_id:
                      payload.current_project_id ?? current.current_project_id,
                    current_task_id:
                      payload.current_task_id ?? current.current_task_id,
                    current_history_id:
                      payload.current_history_id ?? current.current_history_id,
                    current_brain_session_id:
                      payload.current_brain_session_id ??
                      current.current_brain_session_id,
                  }
                : current
            );
          }
          if (payload.type === 'step') {
            nextSinceRef.current = Math.max(
              nextSinceRef.current,
              Number(payload.step_id) || 0
            );
            setSteps((current) => appendStep(current, payload));
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
          if (payload.type === 'target_changed') {
            setSession((current) =>
              current
                ? {
                    ...current,
                    current_project_id: payload.current_project_id ?? null,
                    current_task_id: payload.current_task_id ?? null,
                    current_history_id: payload.current_history_id ?? null,
                    current_brain_session_id:
                      payload.current_brain_session_id ?? null,
                  }
                : current
            );
            nextSinceRef.current = 0;
            setSteps([]);
            setAnsweredAskStepIds(new Set());
            const nextTarget = {
              project_id: (payload.current_project_id ?? null) as string | null,
              task_id: (payload.current_task_id ?? null) as string | null,
              brain_session_id: (payload.current_brain_session_id ?? null) as
                | string
                | null,
            };
            targetRef.current = nextTarget;
            if (
              nextTarget.project_id &&
              eventSocketRef.current?.readyState === WebSocket.OPEN
            ) {
              eventSocketRef.current.send(
                JSON.stringify({
                  type: 'subscribe_project',
                  project_id: nextTarget.project_id,
                })
              );
            }
            if (nextTarget.project_id) void loadSteps(nextTarget, 0);
          }
          if (payload.type === 'space_project_upserted' && payload.project) {
            setProjects((current) => [
              payload.project,
              ...current.filter((project) => project.id !== payload.project.id),
            ]);
          }
          if (payload.type === 'desktop_target_ready') {
            clearSwitchTimeout();
            setProjectLoading(false);
            setSession((current) =>
              current
                ? {
                    ...current,
                    current_project_id:
                      payload.current_project_id ?? current.current_project_id,
                    current_task_id:
                      payload.current_task_id ?? current.current_task_id,
                    current_brain_session_id:
                      payload.current_brain_session_id ??
                      current.current_brain_session_id,
                  }
                : current
            );
          }
          if (payload.type === 'desktop_target_failed') {
            clearSwitchTimeout();
            setProjectLoading(false);
            toast.error('Desktop project switch failed', {
              description:
                payload.error || payload.error_code || 'Try switching again.',
            });
            void reloadSession().catch(() => {});
          }
          if (payload.type === 'command_status') {
            setCommands((current) =>
              current.map((command) =>
                command.id === payload.command_id
                  ? {
                      ...command,
                      status: payload.status,
                      error: payload.error || payload.error_code,
                    }
                  : command
              )
            );
          }
        } catch (err) {
          console.warn('[RemoteControlPage] invalid ws message', err);
        }
      };
      ws.onclose = () => {
        if (eventSocketRef.current === ws) eventSocketRef.current = null;
        if (pingTimer) {
          window.clearInterval(pingTimer);
          pingTimer = null;
        }
        if (watchdogTimer) {
          window.clearInterval(watchdogTimer);
          watchdogTimer = null;
        }
        if (!stopped) {
          const base = Math.min(30_000, 3_000 * 2 ** reconnectAttempt);
          const delay = base + Math.floor(Math.random() * 1_000);
          reconnectAttempt += 1;
          isReconnect = true;
          reconnectTimer = window.setTimeout(connect, delay);
        }
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    return () => {
      stopped = true;
      if (pingTimer) window.clearInterval(pingTimer);
      if (watchdogTimer) window.clearInterval(watchdogTimer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      ws?.close();
      if (eventSocketRef.current === ws) eventSocketRef.current = null;
    };
  }, [clearSwitchTimeout, linkToken, loadSteps, reloadSession, sessionId]);

  useEffect(
    () => () => {
      clearSwitchTimeout();
    },
    [clearSwitchTimeout]
  );

  const selectProject = async (
    project: RemoteControlProject,
    force = false
  ) => {
    if (
      !bridgeOnline ||
      (!force && projectLoading) ||
      project.id === target?.project_id
    )
      return;
    setProjectLoading(true);
    clearSwitchTimeout();
    switchTimeoutRef.current = window.setTimeout(() => {
      switchTimeoutRef.current = null;
      setProjectLoading(false);
      toast.error('Desktop project switch timed out', {
        description:
          'The desktop did not confirm the new project in time. Try switching again.',
      });
      void reloadSession().catch(() => {});
    }, SWITCH_TARGET_TIMEOUT_MS);
    try {
      const response = await patchRemoteControlTarget(sessionId, linkToken, {
        project_id: project.id,
      });
      setSession((current) =>
        current
          ? {
              ...current,
              current_project_id: response.current_project_id,
              current_task_id: response.current_task_id ?? null,
              current_history_id: response.current_history_id ?? null,
              current_brain_session_id: response.current_brain_session_id,
            }
          : current
      );
      targetRef.current = {
        project_id: response.current_project_id,
        task_id: response.current_task_id ?? null,
        brain_session_id: response.current_brain_session_id,
      };
      if (eventSocketRef.current?.readyState === WebSocket.OPEN) {
        eventSocketRef.current.send(
          JSON.stringify({
            type: 'subscribe_project',
            project_id: response.current_project_id,
          })
        );
      }
      nextSinceRef.current = 0;
      setSteps([]);
      await loadSteps(targetRef.current, 0);
    } catch (err) {
      clearSwitchTimeout();
      setProjectLoading(false);
      const pageError = toPageError(err, 'Failed to switch project');
      toast.error(pageError.message, { description: errorHint(pageError) });
    }
  };

  const createProject = async (name: string) => {
    if (!name || projectLoading || !bridgeOnline) return;
    setProjectLoading(true);
    try {
      const project = await createRemoteControlProject(sessionId, linkToken, {
        name,
        mode: 'single-agent',
      });
      setProjects((current) => [
        project,
        ...current.filter((item) => item.id !== project.id),
      ]);
      await selectProject(project, true);
      toast.success('Project created');
    } catch (err) {
      clearSwitchTimeout();
      setProjectLoading(false);
      const pageError = toPageError(err, 'Failed to create project');
      toast.error(pageError.message, { description: errorHint(pageError) });
    }
  };

  const sendFolderOperation = async (type: 'refresh' | 'apply' | 'discard') => {
    if (!activeProject || controlLoading || !folderBacked) return;
    setControlLoading(type);
    try {
      let response;
      if (type === 'refresh') {
        response = await refreshRemoteControlProject(
          sessionId,
          linkToken,
          activeProject.id,
          { force: window.confirm('Force refresh if pending overlays exist?') }
        );
      } else if (type === 'apply') {
        const runId = window.prompt('Run ID to apply');
        if (!runId) return;
        if (!window.confirm('Apply this run to the desktop folder?')) return;
        response = await applyRemoteControlProjectRun(
          sessionId,
          linkToken,
          activeProject.id,
          { run_id: runId, confirm: true }
        );
      } else {
        if (!window.confirm('Discard pending overlays for this project?'))
          return;
        response = await discardRemoteControlProjectOverlays(
          sessionId,
          linkToken,
          activeProject.id,
          { confirm: true }
        );
      }
      if (response) {
        setCommands((current) => [
          ...current,
          {
            id: response.command_id,
            content: type,
            type: `space_${type}`,
            status: response.status,
          },
        ]);
      }
      toast.success(`${type} command sent`);
    } catch (err) {
      const pageError = toPageError(err, `Failed to ${type} project`);
      toast.error(pageError.message, { description: errorHint(pageError) });
    } finally {
      setControlLoading(null);
    }
  };

  const refreshOverlaySummary = async () => {
    if (!activeProject || !folderBacked) return;
    try {
      const response = await listRemoteControlOverlays(
        sessionId,
        linkToken,
        activeProject.id
      );
      toast.info(`${response.overlays.length} pending overlay(s)`);
    } catch (err) {
      const pageError = toPageError(err, 'Failed to load overlays');
      toast.error(pageError.message, { description: errorHint(pageError) });
    }
  };
  void refreshOverlaySummary; // referenced only via side panel

  const submit = async (content: string) => {
    const trimmed = content.trim();
    if (!trimmed || sending || !ready) return;
    setSending(true);
    try {
      const ask = pendingAsk;
      const type = ask ? 'human_reply' : 'user_message';
      const payload = ask
        ? { agent: getAskAgent(ask), reply: trimmed }
        : { content: trimmed, attachments: [] };
      if (ask && !payload.agent) {
        toast.error('Missing agent name');
        return;
      }
      const response = await sendRemoteControlCommand(
        sessionId,
        linkToken,
        type,
        payload,
        target
      );
      setCommands((current) => [
        ...current,
        {
          id: response.command_id,
          content: trimmed,
          type,
          status: response.status,
        },
      ]);
      if (ask) {
        setAnsweredAskStepIds((current) => {
          const next = new Set(current);
          next.add(ask.step_id);
          return next;
        });
      }
      setMessage('');
    } catch (err) {
      const pageError = toPageError(err, 'Failed to send remote command');
      toast.error(pageError.message, { description: errorHint(pageError) });
    } finally {
      setSending(false);
    }
  };

  const sendControlCommand = async (
    type: 'stop' | 'skip_task',
    label: string
  ) => {
    if (!ready || controlLoading) return;
    if (!window.confirm(`${label} this desktop task?`)) return;
    setControlLoading(type);
    try {
      const response = await sendRemoteControlCommand(
        sessionId,
        linkToken,
        type,
        {},
        target
      );
      setCommands((current) => [
        ...current,
        {
          id: response.command_id,
          content: label,
          type,
          status: response.status,
        },
      ]);
      toast.success(`${label} command sent`);
    } catch (err) {
      const pageError = toPageError(
        err,
        `Failed to send ${label.toLowerCase()}`
      );
      toast.error(pageError.message, { description: errorHint(pageError) });
    } finally {
      setControlLoading(null);
    }
  };

  const extendSession = async () => {
    if (!session || controlLoading) return;
    setControlLoading('extend');
    try {
      const response = await extendRemoteControlSession(
        sessionId,
        linkToken,
        86400
      );
      setSession((current) =>
        current ? { ...current, expires_at: response.expires_at } : current
      );
      toast.success('Remote link extended');
    } catch (err) {
      const pageError = toPageError(err, 'Failed to extend remote link');
      toast.error(pageError.message, { description: errorHint(pageError) });
    } finally {
      setControlLoading(null);
    }
  };

  const revokeSession = async () => {
    if (
      !session ||
      controlLoading ||
      !window.confirm('Revoke this remote link?')
    )
      return;
    setControlLoading('revoke');
    try {
      await revokeRemoteControlSession(sessionId, linkToken);
      setSession((current) =>
        current
          ? { ...current, status: 'revoked', bridge_status: 'offline' }
          : current
      );
      toast.success('Remote link revoked');
    } catch (err) {
      const pageError = toPageError(err, 'Failed to revoke remote link');
      toast.error(pageError.message, { description: errorHint(pageError) });
    } finally {
      setControlLoading(null);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit(message);
  };
  void onSubmit; // submit is called directly from RemoteInputBox

  // ── Loading state ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <main className="bg-ds-bg-neutral-strong-default text-ds-text-neutral-default-default flex h-screen w-screen items-center justify-center overflow-hidden">
        <section className="bg-ds-bg-neutral-subtle-default flex h-[calc(100vh-4px)] w-[calc(100vw-4px)] items-center justify-center rounded-[20px]">
          <Loader2 className="h-5 w-5 animate-spin text-ds-icon-neutral-muted-default" />
        </section>
      </main>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────────────
  if (error || !session) {
    const pageError = error ?? { message: 'Unable to open this remote link.' };
    const isRetryable =
      !pageError.status ||
      pageError.status >= 500 ||
      pageError.status === 409 ||
      pageError.status === 429;
    return (
      <main className="bg-ds-bg-neutral-strong-default p-0.5 text-ds-text-neutral-default-default flex h-screen w-screen items-center justify-center overflow-hidden">
        <section className="bg-ds-bg-neutral-subtle-default px-4 flex h-full w-full items-center justify-center rounded-[20px]">
          <div className="max-w-md rounded-2xl border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default p-5 shadow-sm w-full border border-solid">
            <div className="gap-3 flex items-center">
              <img src={eigentAppIconBlack} alt="" className="h-8 w-8" />
              <h1 className="text-heading-sm font-semibold">
                Remote control unavailable
              </h1>
            </div>
            <p className="mt-3 text-body-sm font-medium text-ds-text-neutral-default-default">
              {pageError.message}
            </p>
            <p className="mt-2 text-body-sm text-ds-text-neutral-muted-default">
              {errorHint(pageError)}
            </p>
            {(pageError.status || pageError.code) && (
              <p className="mt-3 text-label-xs text-ds-text-neutral-muted-default">
                {pageError.status ? `HTTP ${pageError.status}` : ''}
                {pageError.status && pageError.code ? ' · ' : ''}
                {pageError.code || ''}
              </p>
            )}
            {isRetryable && (
              <Button
                type="button"
                variant="outline"
                size="md"
                buttonContent="text"
                buttonRadius="full"
                className="mt-4"
                onClick={() => void retryLoad()}
                disabled={reloading}
              >
                {reloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Try again
              </Button>
            )}
          </div>
        </section>
      </main>
    );
  }

  // ── Main UI ──────────────────────────────────────────────────────────────────
  const inputPlaceholder = ready
    ? pendingAsk
      ? getAskText(pendingAsk) || 'Reply to the desktop question'
      : 'Send a follow-up to the desktop task'
    : 'Select a project to start';

  return (
    <main className="bg-ds-bg-neutral-strong-default p-0.5 text-ds-text-neutral-default-default flex h-screen w-screen overflow-hidden">
      <section className="min-h-0 min-w-0 bg-ds-bg-neutral-subtle-default flex flex-1 flex-col overflow-hidden rounded-[20px]">
        {/* Header */}
        <header className="h-12 px-2 shrink-0">
          <div className="flex h-full items-center">
            <img
              src={eigentAppIconBlack}
              alt=""
              className="h-7 w-7 mt-0.5 shrink-0 select-none"
              aria-hidden
            />
            <Button
              variant="ghost"
              size="md"
              buttonContent="icon-only"
              buttonRadius="full"
              aria-label="Open remote control panel"
              onClick={() => {
                setSettingsPanelOpen(false);
                setSidePanelOpen(true);
              }}
            >
              <Menu className="h-4 w-4" />
            </Button>

            <div className="flex-1" />

            {/* Bridge status pill tag */}
            <span
              className={cn(
                'gap-1.5 px-2 py-0.5 !text-label-xs font-semibold inline-flex shrink-0 items-center rounded-full',
                bridgeOnline
                  ? 'bg-ds-bg-status-completed-subtle-default text-ds-text-status-completed-default-default'
                  : 'bg-ds-bg-neutral-default-default text-ds-text-neutral-muted-default'
              )}
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  bridgeOnline
                    ? 'bg-ds-bg-status-completed-default-default'
                    : 'bg-ds-icon-neutral-muted-default'
                )}
              />
              {bridgeOnline ? 'Connected' : 'Offline'}
            </span>

            {/* Settings */}
            <Button
              variant="ghost"
              size="md"
              buttonContent="icon-only"
              buttonRadius="full"
              aria-label="Open settings panel"
              onClick={() => {
                setSidePanelOpen(false);
                setSettingsPanelOpen(true);
              }}
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Main content */}
        <div className="min-h-0 pl-2 relative flex flex-1 flex-col overflow-hidden">
          <div className="scrollbar scrollbar-always-visible min-h-0 px-2 flex-1 overflow-x-hidden overflow-y-auto">
            <div className="gap-3 pb-36 pt-4 mx-auto flex min-h-full w-full max-w-[560px] flex-col">
              {/* No target selected */}
              {!isRemoteControlTargetReady(target) ? (
                <section className="rounded-2xl bg-ds-bg-neutral-subtle-default p-6 text-center">
                  <p className="text-body-sm font-semibold text-ds-text-neutral-default-default">
                    No project selected
                  </p>
                  <p className="mt-1 text-body-sm text-ds-text-neutral-muted-default">
                    Open the menu to select a project in this Space.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    buttonContent="text"
                    buttonRadius="full"
                    className="mt-4"
                    onClick={() => setSidePanelOpen(true)}
                  >
                    <Menu className="h-4 w-4" />
                    Open panel
                  </Button>
                </section>
              ) : steps.length === 0 ? (
                /* Target ready, no steps yet */
                <section className="rounded-2xl bg-ds-bg-neutral-subtle-default p-8 flex min-h-[280px] flex-col items-center justify-center text-center">
                  <div className="h-10 w-10 rounded-xl bg-ds-bg-neutral-subtle-default text-ds-icon-neutral-muted-default flex items-center justify-center">
                    <MessageSquareText className="h-5 w-5" />
                  </div>
                  <p className="mt-3 text-body-sm font-semibold text-ds-text-neutral-default-default">
                    Waiting for desktop activity
                  </p>
                  <p className="mt-1 max-w-sm text-body-sm text-ds-text-neutral-muted-default">
                    New task updates will appear here as a clean event stream.
                  </p>
                </section>
              ) : (
                /* Conversation turns */
                <div className="gap-6 flex flex-col">
                  {turns.map((turn) => (
                    <ConversationTurnCard key={turn.id} turn={turn} />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Sticky bottom input */}
          <div className="inset-x-0 bottom-0 px-2 pb-1 bg-ds-bg-neutral-subtle-default rounded-t-2xl pointer-events-none absolute z-30 mx-auto flex max-w-[600px] justify-center">
            <div className="pointer-events-auto w-full">
              {/* Send-failed banner */}
              {lastCommand?.status === 'failed' &&
                lastCommand.type === 'user_message' && (
                  <div className="mb-2 gap-3 rounded-2xl border-ds-border-error-subtle-default bg-ds-bg-error-subtle-default p-3 text-body-sm text-ds-text-error-default-default flex items-center justify-between border border-solid">
                    <span className="min-w-0 truncate">
                      Send failed: {lastCommand.error || lastCommand.content}
                    </span>
                    <Button
                      variant="outline"
                      tone="error"
                      size="sm"
                      buttonContent="text"
                      buttonRadius="full"
                      className="shrink-0"
                      onClick={() => void submit(lastCommand.content)}
                    >
                      <RefreshCw className="h-4 w-4" />
                      Resend
                    </Button>
                  </div>
                )}

              <RemoteInputBox
                value={message}
                onChange={setMessage}
                onSend={() => void submit(message)}
                placeholder={inputPlaceholder}
                disabled={!ready || sending}
                agentMode={activeProject?.mode}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Left panel — project selector */}
      <RemoteSidePanel
        open={sidePanelOpen}
        onOpenChange={setSidePanelOpen}
        session={session}
        target={target}
        space={space}
        projects={projects}
        projectLoading={projectLoading}
        controlLoading={controlLoading}
        onSelectProject={(project) => void selectProject(project)}
        onCreateProject={(name) => void createProject(name)}
        folderBacked={folderBacked}
        activeProject={activeProject}
        onRefresh={() => void sendFolderOperation('refresh')}
        onApply={() => void sendFolderOperation('apply')}
        onDiscard={() => void sendFolderOperation('discard')}
        bridgeOnline={bridgeOnline}
      />

      {/* Right panel — connection status + controls */}
      <RemoteSettingsPanel
        open={settingsPanelOpen}
        onOpenChange={setSettingsPanelOpen}
        session={session}
        target={target}
        controlLoading={controlLoading}
        onSkip={() => void sendControlCommand('skip_task', 'Skip')}
        onStop={() => void sendControlCommand('stop', 'Stop')}
        onExtend={() => void extendSession()}
        onRevoke={() => void revokeSession()}
        ready={ready}
        bridgeOnline={bridgeOnline}
      />
    </main>
  );
}
