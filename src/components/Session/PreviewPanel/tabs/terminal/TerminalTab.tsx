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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TooltipSimple } from '@/components/ui/tooltip';
import { usePageTabStore } from '@/store/pageTabStore';
import { Check, Copy, SquareTerminal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TerminalSource } from './terminalSources';
import { useSessionTerminalSources } from './useSessionTerminalSources';
import { XtermViewer } from './XtermViewer';

/** One-line label for a stream: agent name, then the subtask it ran for. */
function sourceLabel(source: TerminalSource): string {
  return source.taskLabel
    ? `${source.agentName} · ${source.taskLabel}`
    : source.agentName;
}

/**
 * Live terminal output from the session's agents. Every subtask that ran
 * commands is a selectable stream; by default the tab follows the newest
 * stream as agents keep working, and picking an older one pins it (picking
 * the newest again resumes following).
 */
export function TerminalTab() {
  const { t } = useTranslation();
  const sources = useSessionTerminalSources();
  const openBrowserPreview = usePageTabStore(
    (state) => state.openBrowserPreview
  );

  // null = follow the latest stream; a source id = pinned by the user.
  const [pinnedSourceId, setPinnedSourceId] = useState<string | null>(null);
  const latestSource = sources[sources.length - 1] ?? null;
  const activeSource =
    (pinnedSourceId
      ? sources.find((source) => source.id === pinnedSourceId)
      : undefined) ?? latestSource;

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

  const handleCopyAll = () => {
    if (!activeSource) return;
    void navigator.clipboard?.writeText(activeSource.lines.join('\n'));
    setCopied(true);
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
  };

  if (!activeSource) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col items-center justify-center gap-2 px-6 text-center">
        <SquareTerminal
          className="h-8 w-8 text-ds-icon-neutral-muted-default"
          aria-hidden
        />
        <p className="text-sm font-medium text-ds-text-neutral-default-default">
          {t('layout.preview-terminal-empty', {
            defaultValue: 'No terminal output yet',
          })}
        </p>
        <p className="max-w-[360px] text-xs text-ds-text-neutral-muted-default">
          {t('layout.preview-terminal-empty-desc', {
            defaultValue:
              'Commands run by agents in this session will stream here as they execute.',
          })}
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <div className="flex h-[44px] shrink-0 items-center gap-1.5 px-2">
        {sources.length > 1 ? (
          <Select
            value={activeSource.id}
            onValueChange={(id) =>
              // Re-picking the newest stream resumes follow-latest.
              setPinnedSourceId(id === latestSource?.id ? null : id)
            }
          >
            <SelectTrigger
              size="sm"
              variant="secondary"
              className="w-auto min-w-0 max-w-[360px]"
              aria-label={t('layout.preview-terminal-source', {
                defaultValue: 'Terminal stream',
              })}
            >
              <span className="truncate">
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent>
              {sources.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  <span className="block max-w-[340px] truncate">
                    {sourceLabel(source)}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="truncate px-1 text-sm text-ds-text-neutral-muted-default">
            {sourceLabel(activeSource)}
          </span>
        )}
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
          sourceId={activeSource.id}
          lines={activeSource.lines}
          onOpenLink={openBrowserPreview}
        />
      </div>
    </div>
  );
}

export default TerminalTab;
