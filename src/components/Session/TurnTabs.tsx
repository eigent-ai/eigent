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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { ChatTaskStatus } from '@/types/constants';
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useReducer } from 'react';

function LiveDot() {
  return (
    <span
      className="h-2 w-2 bg-ds-bg-brand-default-default animate-pulse inline-flex shrink-0 rounded-full"
      aria-hidden
    />
  );
}

function StatusDot({ status }: { status: string }) {
  const cls =
    status === ChatTaskStatus.FINISHED
      ? 'bg-ds-bg-success-default-default'
      : status === 'failed'
        ? 'bg-ds-bg-error-default-default'
        : 'bg-ds-border-neutral-default-default';
  return (
    <span
      className={cn('h-2 w-2 inline-flex shrink-0 rounded-full', cls)}
      aria-hidden
    />
  );
}

interface TurnEntry {
  taskId: string;
  status: string;
  prompt: string;
  createdAt: number;
}

/**
 * Dropdown button showing "Run N ▼" next to the fold button.
 * Hidden when the project has ≤ 1 turn.
 */
export function TurnTabs() {
  const projectStore = useProjectRuntimeStore();
  const activeProjectId = projectStore.activeProjectId;

  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (!activeProjectId) return;
    const stores = projectStore.getAllChatStores(activeProjectId);
    if (!stores.length) return;
    const unsubs = stores.map(({ chatStore }) =>
      chatStore.subscribe(forceUpdate)
    );
    return () => unsubs.forEach((fn) => fn());
  }, [activeProjectId, projectStore]);

  // Collect all visible turns, sorted oldest-first for chronological numbering
  const turns: TurnEntry[] = (() => {
    if (!activeProjectId) return [];
    const stores = projectStore.getAllChatStores(activeProjectId);
    const seen = new Set<string>();
    const result: TurnEntry[] = [];
    for (const { chatStore } of stores) {
      const state = chatStore.getState();
      for (const [taskId, task] of Object.entries(state.tasks)) {
        if (seen.has(taskId)) continue;
        const userMsg = (task.messages ?? []).find(
          (m: any) => m.role === 'user' && m.content
        );
        if (!userMsg) continue;
        seen.add(taskId);
        result.push({
          taskId,
          status: task.status ?? ChatTaskStatus.PENDING,
          prompt: String(userMsg.content ?? ''),
          createdAt: task.createdAt ?? 0,
        });
      }
    }
    result.sort((a, b) => a.createdAt - b.createdAt);
    return result;
  })();

  const activeChatStore = projectStore.getActiveChatStore(
    activeProjectId ?? undefined
  );
  const activeTaskId = activeChatStore?.getState().activeTaskId ?? null;

  const selectedByProject = usePageTabStore(
    (s) => s.sidePanelSelectedTurnByProject
  );
  const setSidePanelSelectedTurn = usePageTabStore(
    (s) => s.setSidePanelSelectedTurn
  );
  const setScrollToTurnRequest = usePageTabStore(
    (s) => s.setScrollToTurnRequest
  );

  const projectId = activeProjectId ?? '';
  // Both tab clicks and (post-manual-window) viewport scrolls write here,
  // so there is no Date.now() needed at render time.
  const effectiveSelectedId = selectedByProject[projectId] ?? activeTaskId;

  if (turns.length <= 1) return null;

  // 1-based turn number of the currently selected turn
  const selectedIndex = turns.findIndex(
    (t) => t.taskId === effectiveSelectedId
  );
  const selectedTurnNumber =
    selectedIndex >= 0 ? selectedIndex + 1 : turns.length;

  const handleSelect = (taskId: string) => {
    if (!projectId) return;
    setSidePanelSelectedTurn(projectId, taskId, 5000);
    setScrollToTurnRequest({ projectId, taskId });
  };

  // Display newest-first in the dropdown
  const displayTurns = [...turns].reverse();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          buttonRadius="lg"
          className="opacity-60"
          aria-label={`Run ${selectedTurnNumber}, click to switch turn`}
        >
          Run {selectedTurnNumber}
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        {displayTurns.map((turn, displayIdx) => {
          const turnNumber = turns.length - displayIdx;
          const isSelected = turn.taskId === effectiveSelectedId;
          const isLive =
            turn.status === ChatTaskStatus.RUNNING ||
            turn.status === ChatTaskStatus.PENDING;
          const preview =
            turn.prompt.length > 28
              ? turn.prompt.slice(0, 28) + '…'
              : turn.prompt;

          return (
            <DropdownMenuItem
              key={turn.taskId}
              onSelect={() => handleSelect(turn.taskId)}
              className="gap-2"
            >
              {isLive ? <LiveDot /> : <StatusDot status={turn.status} />}
              <span className="text-ds-text-neutral-muted-default text-label-xs font-semibold shrink-0">
                Run {turnNumber}
              </span>
              <span className="text-ds-text-neutral-subtle-default text-label-xs min-w-0 flex-1 truncate">
                {preview}
              </span>
              {isSelected && (
                <Check className="size-3 text-ds-icon-brand-default-default ml-auto shrink-0" />
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
