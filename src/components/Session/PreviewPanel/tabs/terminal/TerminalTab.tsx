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
import { TooltipSimple } from '@/components/ui/tooltip';
import { useHost } from '@/host';
import { createElectronTerminalTransport } from '@/lib/terminalTransport';
import { cn } from '@/lib/utils';
import {
  fetchWorkspaceCapabilities,
  fetchWorkspaceEffectiveDirectory,
} from '@/service/workspaceApi';
import { useAuthStore } from '@/store/authStore';
import { usePageTabStore, type SessionTerminalTab } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import { Check, Copy, SquareTerminal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShellTerminal } from './ShellTerminal';
import type { TerminalSource } from './terminalSources';
import { useSessionTerminalSources } from './useSessionTerminalSources';
import { XtermViewer } from './XtermViewer';

export interface TerminalTabProps {
  tab: SessionTerminalTab;
}

/**
 * Terminal surface router. Project terminals use a Brain-authoritative cwd;
 * explicitly local shells retain the Desktop login-shell experience. A tab
 * opened from the chooser's project section shows that agent stream read-only.
 */
export function TerminalTab({ tab }: TerminalTabProps) {
  if (tab.agentSourceId) {
    return <AgentStreamTerminal sourceId={tab.agentSourceId} />;
  }
  return (tab.surface ?? 'project') === 'local' ? (
    <LocalShellTerminal tab={tab} />
  ) : (
    <ProjectShellTerminal tab={tab} />
  );
}

/** One-line label for a stream: agent name, then the subtask it ran for. */
export function terminalSourceLabel(source: TerminalSource): string {
  return source.taskLabel
    ? `${source.agentName} · ${source.taskLabel}`
    : source.agentName;
}

function TerminalUnavailable({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-2 px-6 text-center">
      <SquareTerminal
        className="h-8 w-8 text-ds-icon-neutral-muted-default"
        aria-hidden
      />
      <p className="max-w-[420px] text-sm text-ds-text-neutral-muted-default">
        {message}
      </p>
    </div>
  );
}

function useProjectActiveTaskId(projectId: string | null): string | null {
  const chatStore = useProjectRuntimeStore((state) => {
    if (!projectId) return null;
    const project = state.projects[projectId];
    if (!project) return null;
    return project.activeChatId
      ? (project.chatStores[project.activeChatId] ?? null)
      : (Object.values(project.chatStores)[0] ?? null);
  });
  const [taskId, setTaskId] = useState<string | null>(
    () => chatStore?.getState().activeTaskId ?? null
  );
  useEffect(() => {
    const update = () => setTaskId(chatStore?.getState().activeTaskId ?? null);
    update();
    return chatStore?.subscribe(update);
  }, [chatStore]);
  return taskId;
}

/** Interactive Project terminal, rooted at the Brain-resolved run directory. */
function ProjectShellTerminal({ tab }: { tab: SessionTerminalTab }) {
  const { t } = useTranslation();
  const host = useHost();
  const electronTransport = useMemo(
    () => createElectronTerminalTransport(host?.electronAPI),
    [host?.electronAPI]
  );
  const [transportState, setTransportState] = useState<{
    loading: boolean;
    transport: ReturnType<typeof createElectronTerminalTransport>;
  }>({ loading: true, transport: null });
  useEffect(() => {
    let cancelled = false;
    fetchWorkspaceCapabilities()
      .then((capabilities) => {
        if (cancelled) return;
        const canUseLocalProjectTransport =
          capabilities.terminal === true && capabilities.deployment === 'local';
        setTransportState({
          loading: false,
          transport: canUseLocalProjectTransport ? electronTransport : null,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setTransportState({ loading: false, transport: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [electronTransport]);
  const transport = transportState.transport;
  const openBrowserPreview = usePageTabStore(
    (state) => state.openBrowserPreview
  );
  const projectId = usePageTabStore((state) => state.sessionPreviewProjectId);
  const email = useAuthStore((state) => state.email);
  const userId = useAuthStore((state) => state.user_id);
  const indexedSpaceId = useSpaceStore((state) =>
    projectId ? (state.projectIdIndex[projectId] ?? null) : null
  );
  const runtimeSpaceId = useProjectRuntimeStore((state) =>
    projectId ? (state.projects[projectId]?.spaceId ?? null) : null
  );
  const indexedWorkdirMode = useSpaceStore((state) => {
    if (!projectId) return null;
    const indexedProjectSpaceId = state.projectIdIndex[projectId];
    return indexedProjectSpaceId
      ? (state.projectsBySpaceId[indexedProjectSpaceId]?.[projectId]
          ?.workdirMode ?? null)
      : null;
  });
  const runtimeWorkdirMode = useProjectRuntimeStore((state) =>
    projectId ? (state.projects[projectId]?.workdirMode ?? null) : null
  );
  const spaceId = indexedSpaceId ?? runtimeSpaceId;
  const workdirMode = indexedWorkdirMode ?? runtimeWorkdirMode;
  const taskId = useProjectActiveTaskId(projectId);
  const [resolution, setResolution] = useState<{
    cwd: string | null;
    loading: boolean;
    error: string | null;
  }>({ cwd: null, loading: true, error: null });
  const missingContextMessage = t('layout.terminal-project-context-missing', {
    defaultValue: 'The Project workspace context is unavailable.',
  });
  const unavailableWorkspaceMessage = t(
    'layout.terminal-project-workspace-unavailable',
    {
      defaultValue:
        'No Brain-resolved working directory is available for this Project.',
    }
  );

  useEffect(() => {
    let cancelled = false;
    if (!transport) return;
    if (!projectId || !spaceId || !email) {
      setResolution({
        cwd: null,
        loading: false,
        error: missingContextMessage,
      });
      return;
    }
    setResolution({ cwd: null, loading: true, error: null });
    fetchWorkspaceEffectiveDirectory(
      spaceId,
      projectId,
      email,
      userId,
      taskId,
      workdirMode
    )
      .then((result) => {
        if (cancelled) return;
        if (!result.working_directory) {
          throw new Error('Brain returned an empty working directory');
        }
        setResolution({
          cwd: result.working_directory,
          loading: false,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setResolution({
          cwd: null,
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : unavailableWorkspaceMessage,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [
    email,
    missingContextMessage,
    projectId,
    spaceId,
    taskId,
    unavailableWorkspaceMessage,
    transport,
    userId,
    workdirMode,
  ]);

  if (transportState.loading) {
    return <div className="h-full w-full" />;
  }
  if (!transport) {
    return (
      <TerminalUnavailable
        message={t('layout.terminal-brain-transport-unavailable', {
          defaultValue:
            'This client does not yet have a compatible terminal transport for the connected Brain.',
        })}
      />
    );
  }
  if (resolution.loading) {
    return <div className="h-full w-full" />;
  }
  if (!resolution.cwd || resolution.error) {
    return (
      <TerminalUnavailable
        message={resolution.error ?? unavailableWorkspaceMessage}
      />
    );
  }
  return (
    <ShellTerminal
      shellId={tab.shellId ?? `session-shell:fallback:${tab.id}`}
      cwd={resolution.cwd}
      allowHomeFallback={false}
      transport={transport}
      onOpenLink={openBrowserPreview}
    />
  );
}

/** Explicit Desktop-local login shell; it is not the Project workspace shell. */
function LocalShellTerminal({ tab }: { tab: SessionTerminalTab }) {
  const { t } = useTranslation();
  const host = useHost();
  const transport = useMemo(
    () => createElectronTerminalTransport(host?.electronAPI),
    [host?.electronAPI]
  );
  const openBrowserPreview = usePageTabStore(
    (state) => state.openBrowserPreview
  );
  if (!transport) {
    return (
      <TerminalUnavailable
        message={t('layout.terminal-local-desktop-only', {
          defaultValue: 'The local shell is available in the desktop app.',
        })}
      />
    );
  }
  return (
    <ShellTerminal
      shellId={tab.shellId ?? `local-shell:fallback:${tab.id}`}
      allowHomeFallback
      transport={transport}
      onOpenLink={openBrowserPreview}
    />
  );
}

/** Read-only viewer for one agent terminal stream (picked in the chooser). */
function AgentStreamTerminal({ sourceId }: { sourceId: string }) {
  const { t } = useTranslation();
  const sources = useSessionTerminalSources();
  const openBrowserPreview = usePageTabStore(
    (state) => state.openBrowserPreview
  );
  const source = sources.find((candidate) => candidate.id === sourceId);

  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    },
    []
  );

  if (!source) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-2 px-6 text-center">
        <SquareTerminal
          className="h-8 w-8 text-ds-icon-neutral-muted-default"
          aria-hidden
        />
        <p className="max-w-[360px] text-sm text-ds-text-neutral-muted-default">
          {t('layout.terminal-stream-gone', {
            defaultValue: 'This terminal stream is no longer available.',
          })}
        </p>
      </div>
    );
  }

  const handleCopyAll = () => {
    void navigator.clipboard?.writeText(source.lines.join('\n'));
    setCopied(true);
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="flex h-[44px] shrink-0 items-center gap-2 px-3">
        <span
          aria-hidden
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            source.status === 'running'
              ? 'animate-pulse bg-ds-bg-status-running-default-default'
              : 'bg-ds-bg-neutral-muted-default'
          )}
        />
        <span className="truncate text-sm text-ds-text-neutral-muted-default">
          {terminalSourceLabel(source)}
        </span>
        <div className="min-w-0 flex-1" />
        <TooltipSimple
          content={t('layout.preview-terminal-copy', {
            defaultValue: 'Copy output',
          })}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            buttonContent="icon-only"
            onClick={handleCopyAll}
            aria-label={t('layout.preview-terminal-copy', {
              defaultValue: 'Copy output',
            })}
          >
            {copied ? (
              <Check className="h-4 w-4" aria-hidden />
            ) : (
              <Copy className="h-4 w-4" aria-hidden />
            )}
          </Button>
        </TooltipSimple>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <XtermViewer
          sourceId={source.id}
          lines={source.lines}
          onOpenLink={openBrowserPreview}
        />
      </div>
    </div>
  );
}

export default TerminalTab;
