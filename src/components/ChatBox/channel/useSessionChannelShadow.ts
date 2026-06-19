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
 * Channel sync: keeps the per-project session channel derived from the live
 * per-turn chatStore tasks. Mounted inside `SessionChannel`, it re-derives the
 * channel whenever the visible turns change and (in dev) logs a fidelity diff
 * (turn count, per-turn user-message count) so drift between the live tasks and
 * the channel surfaces immediately.
 *
 * (Named "shadow" from when it ran alongside the legacy renderer; it is now the
 * primary derivation path. The true `ingest(event)` reducer that would replace
 * this fold is deferred to a later effort.)
 */

import type { VanillaChatStore } from '@/store/chatStore';
import type { TurnInput } from '@/store/sessionChannelReducer';
import { getSessionChannelStore } from '@/store/sessionChannelStore';
import { useEffect, useMemo } from 'react';

export interface ShadowTurnSection {
  chatId: string;
  chatStore: VanillaChatStore;
  taskId: string;
}

/** Cheap signature so the effect only re-runs when the channel could change. */
function turnsSignature(sections: ShadowTurnSection[]): string {
  return sections
    .map(({ taskId, chatStore }) => {
      const task = chatStore.getState().tasks[taskId];
      const msgCount = task?.messages?.length ?? 0;
      const logCount = (task?.taskAssigning ?? []).reduce(
        (n, a) => n + (a.log?.length ?? 0),
        0
      );
      const subCount = task?.taskInfo?.length ?? 0;
      return `${taskId}:${task?.status}:${msgCount}:${logCount}:${subCount}:${task?.activeAsk ? 1 : 0}`;
    })
    .join('|');
}

export function useSessionChannelShadow(
  projectId: string | null | undefined,
  sections: ShadowTurnSection[]
): void {
  const signature = useMemo(() => turnsSignature(sections), [sections]);

  useEffect(() => {
    if (!projectId) return;

    const turns: TurnInput[] = sections
      .map(({ taskId, chatStore }) => {
        const task = chatStore.getState().tasks[taskId];
        return task ? { turnId: taskId, task } : null;
      })
      .filter((t): t is TurnInput => t !== null);

    const store = getSessionChannelStore(projectId);
    store.getState().rebuildFromTurns(turns);

    if (import.meta.env.DEV) {
      const { items, turnOrder } = store.getState();
      const turnMismatch = turnOrder.length !== turns.length;
      if (turnMismatch) {
        console.warn(
          `[session-channel:shadow] turn count mismatch for ${projectId}: ` +
            `channel=${turnOrder.length} live=${turns.length}`
        );
      }
      // Per-turn message fidelity: channel user-messages should equal the live
      // user messages, and every non-user/non-sync message should surface as
      // some agent-side item (agent-message / ask / error / skip / plan).
      for (const { turnId, task } of turns) {
        const liveUsers = (task.messages ?? []).filter(
          (m) => m.role === 'user' && m.content
        ).length;
        const channelUsers = items.filter(
          (i) => i.turnId === turnId && i.kind === 'user-message'
        ).length;
        if (liveUsers !== channelUsers) {
          console.warn(
            `[session-channel:shadow] user-message mismatch in turn ${turnId}: ` +
              `channel=${channelUsers} live=${liveUsers}`
          );
        }
      }
    }
    // `signature` is the real dependency; `sections`/`projectId` are read inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, signature]);
}
