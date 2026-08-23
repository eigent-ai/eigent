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
import {
  FoldedAgentCard,
  isBaseWorkflowAgent,
} from '@/components/Workspace/FoldedAgentCard';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface WorkforceAgentListProps {
  sortedAgents: Agent[];
  activeAgentId: string | undefined;
  onSelectAgent: (agentId: string) => void;
  onEditWorkerFromMenu: (agent: Agent) => void;
  onDuplicateUserAgent: (agent: Agent) => void;
  onDeleteUserAgent: (agentId: string) => void;
  onAddWorker: () => void;
  alignment?: 'center' | 'start';
}

/**
 * Workspace workforce mode: centered horizontal row of agents with add-worker.
 */
export function WorkforceAgentList({
  sortedAgents,
  activeAgentId,
  onSelectAgent,
  onEditWorkerFromMenu,
  onDuplicateUserAgent,
  onDeleteUserAgent,
  onAddWorker,
  alignment = 'center',
}: WorkforceAgentListProps) {
  const { t } = useTranslation();
  const agentViewportRef = useRef<HTMLDivElement>(null);
  const agentTrackRef = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState({
    overflow: false,
    left: false,
    right: false,
  });

  const updateScrollControls = useCallback(() => {
    const viewport = agentViewportRef.current;
    if (!viewport) return;

    const maxScrollLeft = Math.max(
      0,
      viewport.scrollWidth - viewport.clientWidth
    );
    setCanScroll({
      overflow: maxScrollLeft > 1,
      left: viewport.scrollLeft > 1,
      right: viewport.scrollLeft < maxScrollLeft - 1,
    });
  }, []);

  useEffect(() => {
    const viewport = agentViewportRef.current;
    const track = agentTrackRef.current;
    if (!viewport) return;

    updateScrollControls();
    const resizeObserver = new ResizeObserver(updateScrollControls);
    resizeObserver.observe(viewport);
    if (track) resizeObserver.observe(track);
    viewport.addEventListener('scroll', updateScrollControls, {
      passive: true,
    });

    return () => {
      resizeObserver.disconnect();
      viewport.removeEventListener('scroll', updateScrollControls);
    };
  }, [sortedAgents.length, updateScrollControls]);

  const scrollOneAgent = useCallback((direction: -1 | 1) => {
    const viewport = agentViewportRef.current;
    const track = agentTrackRef.current;
    if (!viewport || !track) return;

    const agentItems = track.querySelectorAll<HTMLElement>(
      '[data-workforce-agent-item]'
    );
    const measuredStep =
      agentItems.length > 1
        ? agentItems[1].offsetLeft - agentItems[0].offsetLeft
        : 0;
    const firstAgentWidth = agentItems[0]?.getBoundingClientRect().width ?? 0;
    const trackStyles = window.getComputedStyle(track);
    const gap =
      Number.parseFloat(trackStyles.columnGap || trackStyles.gap) || 8;
    const agentStep =
      measuredStep > 0
        ? measuredStep
        : firstAgentWidth > 0
          ? firstAgentWidth + gap
          : 48;

    viewport.scrollBy({
      left: direction * agentStep,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
    });
  }, []);

  const scrollLeftLabel = t('layout.workspace-agents-scroll-left', {
    defaultValue: 'Scroll agents left',
  });
  const scrollRightLabel = t('layout.workspace-agents-scroll-right', {
    defaultValue: 'Scroll agents right',
  });

  return (
    <div
      className={cn(
        'flex w-full min-w-0',
        alignment === 'start' ? 'justify-start' : 'justify-center'
      )}
    >
      <div
        data-workforce-agent-controls
        className="flex w-full max-w-full min-w-0 items-center gap-2"
      >
        <div className="flex shrink-0 flex-col justify-center">
          <TooltipSimple content={t('triggers.add')} side="top" sideOffset={8}>
            <button
              data-workforce-add-button
              type="button"
              className={cn(
                'rounded-xl border-0 border-x-0 border-y-0 bg-ds-neutral-default-default',
                'inline-flex items-center justify-center p-2',
                'text-ds-ink-muted-default transition-[color,opacity,box-shadow] duration-200',
                'opacity-80 hover:text-ds-ink-default-default hover:opacity-100',
                'focus-visible:ring-2 focus-visible:ring-ds-ring-focus focus-visible:outline-none'
              )}
              onClick={onAddWorker}
              aria-label={t('triggers.add')}
            >
              <Plus className="h-6 w-6 shrink-0" strokeWidth={2} aria-hidden />
            </button>
          </TooltipSimple>
        </div>
        <div
          data-workforce-agent-viewport-shell
          className="relative min-w-0 flex-1"
        >
          {canScroll.overflow ? (
            <div
              data-workforce-scroll-controls
              className="pointer-events-none absolute inset-x-1 top-0 z-10 flex -translate-y-full items-center justify-between"
            >
              <TooltipSimple
                content={scrollLeftLabel}
                side="top"
                sideOffset={6}
                variant="instant"
              >
                <Button
                  data-workforce-scroll-left
                  type="button"
                  variant="secondary"
                  size="xs"
                  buttonContent="icon-only"
                  buttonRadius="full"
                  className="pointer-events-auto shadow-md"
                  disabled={!canScroll.left}
                  onClick={() => scrollOneAgent(-1)}
                  aria-label={scrollLeftLabel}
                >
                  <ChevronLeft className="h-3 w-3" aria-hidden />
                </Button>
              </TooltipSimple>
              <TooltipSimple
                content={scrollRightLabel}
                side="top"
                sideOffset={6}
                variant="instant"
              >
                <Button
                  data-workforce-scroll-right
                  type="button"
                  variant="secondary"
                  size="xs"
                  buttonContent="icon-only"
                  buttonRadius="full"
                  className="pointer-events-auto shadow-md"
                  disabled={!canScroll.right}
                  onClick={() => scrollOneAgent(1)}
                  aria-label={scrollRightLabel}
                >
                  <ChevronRight className="h-3 w-3" aria-hidden />
                </Button>
              </TooltipSimple>
            </div>
          ) : null}
          <div
            ref={agentViewportRef}
            role="list"
            aria-label={t('layout.aiWorkforce')}
            className="scrollbar-hide max-w-[min(100%,calc(100vw-3rem))] min-w-0 overflow-x-auto overflow-y-hidden"
          >
            <div
              ref={agentTrackRef}
              data-workforce-agent-track
              className={cn(
                'flex w-max min-w-full flex-row flex-nowrap items-center gap-2',
                alignment === 'start' ? 'justify-start' : 'justify-center'
              )}
            >
              {sortedAgents.map((agent) => (
                <div
                  key={agent.agent_id}
                  data-workforce-agent-item
                  className="shrink-0"
                  role="listitem"
                >
                  <FoldedAgentCard
                    agent={agent}
                    isActive={activeAgentId === agent.agent_id}
                    dimmed={false}
                    compactMode
                    borderless
                    onSelect={() => onSelectAgent(agent.agent_id)}
                    showUserAgentOverflow={false}
                    compactContextMenu={{
                      onEdit: () => onEditWorkerFromMenu(agent),
                      onDuplicate: () => onDuplicateUserAgent(agent),
                      onDelete: () => onDeleteUserAgent(agent.agent_id),
                      editEnabled: !isBaseWorkflowAgent(agent),
                      duplicateEnabled: !isBaseWorkflowAgent(agent),
                      deleteEnabled: !isBaseWorkflowAgent(agent),
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
