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
 * Session channel store — **one vanilla store instance per project**, holding
 * that project's entire conversation as a single ordered `ChannelItem[]`.
 *
 * Stage 1: the store is populated by deriving from the live per-turn chatStore
 * tasks (`rebuildFromTurns`), so it runs in shadow alongside the existing
 * rendering with no UI change. The pure append/update actions
 * (`appendItem`/`updateItem`/work-log section helpers) are present so later
 * stages can drive the channel directly from an `ingest(event)` reducer without
 * reshaping the store API.
 */

import {
  buildProjectChannel,
  type TurnInput,
} from '@/store/sessionChannelReducer';
import type { SessionModeType } from '@/types/constants';
import { SessionMode } from '@/types/constants';
import type { ChannelItem, WorkLogItem } from '@/types/sessionChannel';
import { createStore } from 'zustand';

export interface SessionChannelState {
  projectId: string;
  /** The whole conversation, ordered by `seq`. */
  items: ChannelItem[];
  /** id → index in `items`, for O(1) updates without rebuilding the array. */
  itemsById: Record<string, number>;
  /** Turn ids oldest→newest — the `TurnTabs` source. */
  turnOrder: string[];
  /** Index of the newest turn (turnOrder.length - 1, or -1 when empty). */
  turnIndex: number;
  /** The turn currently receiving events. */
  currentTurnId: string | null;
  /** The head unanswered ask, if any (replaces the per-task `activeAsk`). */
  activeAskId: string | null;
  /** Session mode of the newest turn (per-turn mode lives on TurnBoundaryItem). */
  sessionMode: SessionModeType;

  // ---- derivation (Stage 1 shadow) ----
  /** Replace the channel from the live per-turn tasks (idempotent). */
  rebuildFromTurns: (turns: TurnInput[]) => void;

  // ---- pure mutations (used directly from Stage 2+) ----
  appendItem: (item: ChannelItem) => void;
  updateItem: (id: string, patch: Partial<ChannelItem>) => void;
  beginTurn: (turnId: string, boundary: ChannelItem) => void;
  openWorkLogSection: (
    turnId: string,
    opts?: { reopenedBySkip?: boolean }
  ) => string;
  closeCurrentWorkLogSection: (turnId: string) => void;
  openAsk: (item: ChannelItem) => void;
  answerAsk: (
    askId: string,
    answer: { text?: string; selected?: string[] }
  ) => void;
  reset: () => void;
}

function indexItems(items: ChannelItem[]): Record<string, number> {
  const byId: Record<string, number> = {};
  for (let i = 0; i < items.length; i++) byId[items[i]!.id] = i;
  return byId;
}

function deriveTurnOrder(items: ChannelItem[]): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (it.kind === 'turn-boundary' && !seen.has(it.turnId)) {
      seen.add(it.turnId);
      order.push(it.turnId);
    }
  }
  return order;
}

function headUnansweredAsk(items: ChannelItem[]): string | null {
  for (const it of items) {
    if (it.kind === 'ask' && !it.answered) return it.id;
  }
  return null;
}

/** Highest existing work-log `sectionIndex` for a turn (−1 if none). */
function maxSectionIndex(items: ChannelItem[], turnId: string): number {
  let max = -1;
  for (const it of items) {
    if (it.kind === 'work-log' && it.turnId === turnId) {
      max = Math.max(max, it.sectionIndex);
    }
  }
  return max;
}

export type VanillaSessionChannelStore = ReturnType<
  typeof createSessionChannelStore
>;

export function createSessionChannelStore(projectId: string) {
  return createStore<SessionChannelState>()((set, get) => ({
    projectId,
    items: [],
    itemsById: {},
    turnOrder: [],
    turnIndex: -1,
    currentTurnId: null,
    activeAskId: null,
    sessionMode: SessionMode.WORKFORCE,

    rebuildFromTurns: (turns) => {
      const items = buildProjectChannel(turns);
      const turnOrder = deriveTurnOrder(items);
      const lastTurn = turnOrder[turnOrder.length - 1] ?? null;
      const lastBoundary = [...items]
        .reverse()
        .find((i) => i.kind === 'turn-boundary');
      set({
        items,
        itemsById: indexItems(items),
        turnOrder,
        turnIndex: turnOrder.length - 1,
        currentTurnId: lastTurn,
        activeAskId: headUnansweredAsk(items),
        sessionMode:
          lastBoundary && lastBoundary.kind === 'turn-boundary'
            ? lastBoundary.sessionMode
            : get().sessionMode,
      });
    },

    appendItem: (item) =>
      set((state) => {
        const items = [...state.items, item];
        return {
          items,
          itemsById: { ...state.itemsById, [item.id]: items.length - 1 },
        };
      }),

    updateItem: (id, patch) =>
      set((state) => {
        const idx = state.itemsById[id];
        if (idx === undefined) return {};
        const items = state.items.slice();
        items[idx] = { ...items[idx]!, ...patch } as ChannelItem;
        return { items };
      }),

    beginTurn: (turnId, boundary) =>
      set((state) => {
        const items = [...state.items, boundary];
        return {
          items,
          itemsById: { ...state.itemsById, [boundary.id]: items.length - 1 },
          turnOrder: state.turnOrder.includes(turnId)
            ? state.turnOrder
            : [...state.turnOrder, turnId],
          turnIndex: state.turnOrder.includes(turnId)
            ? state.turnIndex
            : state.turnOrder.length,
          currentTurnId: turnId,
        };
      }),

    openWorkLogSection: (turnId, opts) => {
      const state = get();
      const sectionIndex = maxSectionIndex(state.items, turnId) + 1;
      const id = `wl-${turnId}-${sectionIndex}`;
      const item: WorkLogItem = {
        id,
        kind: 'work-log',
        turnId,
        seq: state.items.length,
        createdAt: Date.now(),
        sectionIndex,
        blocks: [],
        status: 'running',
        reopenedBySkip: opts?.reopenedBySkip,
      };
      get().appendItem(item);
      return id;
    },

    closeCurrentWorkLogSection: (turnId) =>
      set((state) => {
        const items = state.items.slice();
        for (let i = items.length - 1; i >= 0; i--) {
          const it = items[i]!;
          if (
            it.kind === 'work-log' &&
            it.turnId === turnId &&
            it.status === 'running'
          ) {
            items[i] = { ...it, status: 'done' };
            break;
          }
        }
        return { items };
      }),

    openAsk: (item) => {
      get().appendItem(item);
      set((state) => ({ activeAskId: state.activeAskId ?? item.id }));
    },

    answerAsk: (askId, answer) =>
      set((state) => {
        const idx = state.itemsById[askId];
        if (idx === undefined) return {};
        const items = state.items.slice();
        const ask = items[idx]!;
        if (ask.kind !== 'ask') return {};
        items[idx] = { ...ask, answered: true, answer };
        return { items, activeAskId: headUnansweredAsk(items) };
      }),

    reset: () =>
      set({
        items: [],
        itemsById: {},
        turnOrder: [],
        turnIndex: -1,
        currentTurnId: null,
        activeAskId: null,
      }),
  }));
}

// ----------------------------------------------------------------------------
// Per-project registry. Stage 1 keeps this module-local to avoid reshaping the
// large projectStore; it migrates into `projectStore.channelStores` at cut-over.
// ----------------------------------------------------------------------------
const channelStores = new Map<string, VanillaSessionChannelStore>();

export function getSessionChannelStore(
  projectId: string
): VanillaSessionChannelStore {
  let store = channelStores.get(projectId);
  if (!store) {
    store = createSessionChannelStore(projectId);
    channelStores.set(projectId, store);
  }
  return store;
}

export function peekSessionChannelStore(
  projectId: string
): VanillaSessionChannelStore | undefined {
  return channelStores.get(projectId);
}
