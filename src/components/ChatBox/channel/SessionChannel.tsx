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

/**
 * SessionChannel — the data-driven replacement for ProjectChatContainer +
 * ProjectSection + UserQueryGroup. It renders the per-project channel as a flat,
 * turn-grouped list: `turnOrder.map(turn → items.filter(turnId).map(renderer))`.
 *
 * Stage 2: rendered only when the `session-channel` flag is on. It keeps the
 * channel synced from the live per-turn tasks (same shadow hook) and bridges the
 * interactive cards to the live chatStore via `resolveTurn`.
 */

import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { getSessionChannelStore } from '@/store/sessionChannelStore';
import type { ChannelItem } from '@/types/sessionChannel';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { FloatingAction } from '../MessageItem/FloatingAction';
import { ChannelItemRenderer } from './ChannelItemRenderer';
import type { ChannelRenderContext, ResolvedTurn } from './context';
import {
  useSessionChannelShadow,
  type ShadowTurnSection,
} from './useSessionChannelShadow';

interface SessionChannelProps {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  scrollBottomInsetPx: number;
  onSkip: () => void;
  isPauseResumeLoading: boolean;
}

export const SessionChannel: React.FC<SessionChannelProps> = ({
  scrollContainerRef,
  scrollBottomInsetPx,
  onSkip,
  isPauseResumeLoading,
}) => {
  const { projectStore } = useChatStoreAdapter();
  const activeProjectId = projectStore.activeProjectId;
  const setActiveWorkspaceTab = usePageTabStore((s) => s.setActiveWorkspaceTab);
  const runtimeProjectId = useProjectRuntimeStore((s) => s.activeProjectId);

  // Deduped, ordered turn sections (mirrors ProjectChatContainer dedup).
  const chatStores = useMemo(
    () =>
      activeProjectId ? projectStore.getAllChatStores(activeProjectId) : [],
    [activeProjectId, projectStore]
  );
  const taskSections: ShadowTurnSection[] = [];
  const seenTaskIds = new Set<string>();
  for (const { chatId, chatStore } of chatStores) {
    for (const [taskId, task] of Object.entries(chatStore.getState().tasks)) {
      if (seenTaskIds.has(taskId)) continue;
      const hasUserMessage = (task.messages || []).some(
        (m) => m.role === 'user' && m.content
      );
      if (!hasUserMessage) continue;
      seenTaskIds.add(taskId);
      taskSections.push({ chatId, chatStore, taskId });
    }
  }

  // Keep the channel derived from live tasks (also the dev shadow-diff).
  useSessionChannelShadow(activeProjectId, taskSections);

  // Re-render whenever the channel changes.
  const channelStore = activeProjectId
    ? getSessionChannelStore(activeProjectId)
    : null;
  const emptyItems = useRef<ChannelItem[]>([]).current;
  const items = useSyncExternalStore(
    (cb) => (channelStore ? channelStore.subscribe(cb) : () => {}),
    () => (channelStore ? channelStore.getState().items : emptyItems)
  );
  const turnOrder = useSyncExternalStore(
    (cb) => (channelStore ? channelStore.subscribe(cb) : () => {}),
    () => (channelStore ? channelStore.getState().turnOrder : emptyTurnOrder)
  );

  // turnId → live chatStore handle, for interactive cards.
  const resolver = useMemo(() => {
    const map = new Map<string, ResolvedTurn>();
    for (const { chatStore, taskId } of taskSections) {
      map.set(taskId, { chatStore, taskId });
    }
    return map;
    // taskSections is rebuilt each render; key on the stable id list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskSections.map((s) => s.taskId).join('|')]);

  const openFilePreview = useCallback(
    (turnId: string, file: FileInfo) => {
      const resolved = resolver.get(turnId);
      if (!resolved) return;
      const state = resolved.chatStore.getState();
      state.setSelectedFile(resolved.taskId, file);
      state.setNuwFileNum(resolved.taskId, 0);
      state.setActiveWorkspace(resolved.taskId, 'documentWorkSpace');
      setActiveWorkspaceTab('inbox', {
        clearInboxForProjectId: runtimeProjectId,
      });
    },
    [resolver, setActiveWorkspaceTab, runtimeProjectId]
  );

  const ctx: ChannelRenderContext = useMemo(
    () => ({
      projectId: activeProjectId ?? '',
      resolveTurn: (turnId) => resolver.get(turnId) ?? null,
      openFilePreview,
    }),
    [activeProjectId, resolver, openFilePreview]
  );

  // Items grouped by turn (the channel is flat; group for per-turn DOM nodes).
  const itemsByTurn = useMemo(() => {
    const map = new Map<string, ChannelItem[]>();
    for (const it of items) {
      const arr = map.get(it.turnId);
      if (arr) arr.push(it);
      else map.set(it.turnId, [it]);
    }
    return map;
  }, [items]);

  // Turn viewport observer — drives side-panel TurnTabs (lifted from
  // ProjectChatContainer:204-251), keyed on turnId.
  const setSidePanelViewedTurn = usePageTabStore(
    (s) => s.setSidePanelViewedTurn
  );
  const turnIdsKey = turnOrder.join('|');
  useEffect(() => {
    const root = scrollContainerRef.current;
    if (!root || !activeProjectId) return;
    const scores = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const turnId = entry.target.getAttribute('data-turn-id');
          if (!turnId) continue;
          if (!entry.isIntersecting) {
            scores.delete(turnId);
            continue;
          }
          const visibleHeight = entry.intersectionRect.height;
          const availableHeight = Math.min(
            entry.boundingClientRect.height,
            root.clientHeight
          );
          scores.set(
            turnId,
            availableHeight > 0 ? visibleHeight / availableHeight : 0
          );
        }
        let bestTurnId: string | null = null;
        let bestScore = 0;
        for (const [turnId, score] of scores) {
          if (score > bestScore) {
            bestTurnId = turnId;
            bestScore = score;
          }
        }
        if (bestTurnId) setSidePanelViewedTurn(activeProjectId, bestTurnId);
      },
      { root, threshold: [0, 0.01, 0.25, 0.5, 0.75, 1] }
    );
    root
      .querySelectorAll('[data-turn-id]')
      .forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [turnIdsKey, scrollContainerRef, activeProjectId, setSidePanelViewedTurn]);

  // Scroll to a turn when requested from TurnTabs.
  const scrollToTurnRequest = usePageTabStore((s) => s.scrollToTurnRequest);
  const setScrollToTurnRequest = usePageTabStore(
    (s) => s.setScrollToTurnRequest
  );
  useEffect(() => {
    const root = scrollContainerRef.current;
    if (
      !scrollToTurnRequest ||
      scrollToTurnRequest.projectId !== activeProjectId ||
      !root
    ) {
      return;
    }
    const el = root.querySelector(
      `[data-turn-id="${scrollToTurnRequest.taskId}"]`
    );
    if (el) {
      const containerRect = root.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      root.scrollTo({
        top: elRect.top - containerRect.top + root.scrollTop,
        behavior: 'smooth',
      });
    }
    setScrollToTurnRequest(null);
  }, [
    scrollToTurnRequest,
    setScrollToTurnRequest,
    scrollContainerRef,
    activeProjectId,
  ]);

  // Auto-scroll to bottom as the channel grows.
  const itemCountRef = useRef(0);
  useEffect(() => {
    if (items.length > itemCountRef.current) {
      const root = scrollContainerRef.current;
      if (root) {
        setTimeout(() => {
          root.scrollTo({ top: root.scrollHeight, behavior: 'smooth' });
        }, 100);
      }
    }
    itemCountRef.current = items.length;
  }, [items.length, scrollContainerRef]);

  // Floating pause/skip/stop control for the current (running) turn — rendered
  // once at project level (mirrors ProjectSection's FloatingAction). It hides
  // itself unless the resolved status is RUNNING.
  const currentTurnId = channelStore?.getState().currentTurnId ?? null;
  const currentTurn = currentTurnId ? resolver.get(currentTurnId) : null;
  const currentStatus = currentTurn
    ? currentTurn.chatStore.getState().tasks[currentTurn.taskId]?.status
    : undefined;

  return (
    <div style={{ paddingBottom: scrollBottomInsetPx }} className="relative">
      {turnOrder.map((turnId) => (
        <div key={turnId} data-turn-id={turnId} data-query-id={turnId}>
          {(itemsByTurn.get(turnId) ?? []).map((item) => (
            <ChannelItemRenderer key={item.id} item={item} ctx={ctx} />
          ))}
        </div>
      ))}
      {currentStatus && (
        <FloatingAction
          status={currentStatus}
          onSkip={onSkip}
          loading={isPauseResumeLoading}
          hideStop={false}
        />
      )}
    </div>
  );
};

const emptyTurnOrder: string[] = [];
