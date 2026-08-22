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
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { usePageTabStore, type SessionTerminalTab } from '@/store/pageTabStore';
import { useSpaceStore } from '@/store/spaceStore';
import { Check, Copy, SquareTerminal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShellTerminal } from './ShellTerminal';
import type { TerminalSource } from './terminalSources';
import { useSessionTerminalSources } from './useSessionTerminalSources';
import { XtermViewer } from './XtermViewer';

export interface TerminalTabProps {
  tab: SessionTerminalTab;
}

/**
 * Terminal surface router. A plain terminal tab is a real interactive local
 * shell (a main-process PTY running the user's login shell). A tab opened
 * from the chooser's project section shows that agent stream read-only.
 */
export function TerminalTab({ tab }: TerminalTabProps) {
  if (tab.agentSourceId) {
    return <AgentStreamTerminal sourceId={tab.agentSourceId} />;
  }
  return <LocalShellTerminal tab={tab} />;
}

/** One-line label for a stream: agent name, then the subtask it ran for. */
export function terminalSourceLabel(source: TerminalSource): string {
  return source.taskLabel
    ? `${source.agentName} · ${source.taskLabel}`
    : source.agentName;
}

/** Interactive local shell, started in the project's working folder. */
function LocalShellTerminal({ tab }: { tab: SessionTerminalTab }) {
  const { t } = useTranslation();
  const host = useHost();
  const openBrowserPreview = usePageTabStore(
    (state) => state.openBrowserPreview
  );
  const projectId = usePageTabStore((state) => state.sessionPreviewProjectId);
  const email = useAuthStore((state) => state.email);
  const userId = useAuthStore((state) => state.user_id);
  const isDesktop = Boolean(host?.electronAPI?.terminalCreate);

  // A folder-backed Space works directly in the user's chosen local folder,
  // so the shell must open there — not in the generated per-project output
  // folder used by legacy/blank Spaces.
  const spaceRootPath = useSpaceStore((state) => {
    const spaceId =
      (projectId ? state.getProjectMeta(projectId)?.spaceId : null) ??
      state.activeSpaceId;
    return (spaceId ? state.spaces[spaceId]?.rootPath : null) ?? null;
  });

  // Resolve the working folder before spawning so the shell opens there
  // (falls back to the home directory when unavailable).
  const [cwd, setCwd] = useState<string | undefined>(undefined);
  const [cwdResolved, setCwdResolved] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (spaceRootPath) {
      setCwd(spaceRootPath);
      setCwdResolved(true);
      return;
    }
    const api = host?.electronAPI;
    if (!api?.getProjectFolderPath || !email || !projectId) {
      setCwdResolved(true);
      return;
    }
    api
      .getProjectFolderPath(email, projectId, userId)
      .then((folderPath: string) => {
        if (cancelled) return;
        setCwd(folderPath || undefined);
        setCwdResolved(true);
      })
      .catch(() => {
        if (!cancelled) setCwdResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, [host, email, userId, projectId, spaceRootPath]);

  if (!isDesktop) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-2 px-6 text-center">
        <SquareTerminal
          className="h-8 w-8 text-ds-ink-muted-default"
          aria-hidden
        />
        <p className="max-w-[360px] text-sm text-ds-ink-muted-default">
          {t('layout.terminal-desktop-only', {
            defaultValue: 'The terminal is available in the desktop app.',
          })}
        </p>
      </div>
    );
  }
  if (!cwdResolved) {
    // One frame at most; avoids spawning in $HOME then "jumping" folders.
    return <div className="h-full w-full" />;
  }
  return (
    <ShellTerminal
      shellId={tab.shellId ?? `session-shell:fallback:${tab.id}`}
      cwd={cwd}
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
          className="h-8 w-8 text-ds-ink-muted-default"
          aria-hidden
        />
        <p className="max-w-[360px] text-sm text-ds-ink-muted-default">
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
      <div className="flex h-ds-layout-row-header shrink-0 items-center gap-2 overflow-visible px-3">
        <span
          aria-hidden
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            source.status === 'running'
              ? 'animate-pulse bg-ds-bg-status-running-default-default'
              : 'bg-ds-neutral-muted-default'
          )}
        />
        <span className="truncate text-sm text-ds-ink-muted-default">
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
