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

import { renameGeneratedAutomationSessions } from '@/lib/automationSessionName';
import { proxyFetchSpaceTriggers } from '@/service/triggerApi';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useTriggerStore } from '@/store/triggerStore';
import type { Trigger } from '@/types';
import { useEffect, useMemo, useState } from 'react';

/** One Automation list request per Space for the app's lifetime. */
const automationsBySpace = new Map<string, Promise<Trigger[]>>();

function loadSpaceAutomations(spaceId: string): Promise<Trigger[]> {
  let pending = automationsBySpace.get(spaceId);
  if (!pending) {
    pending = proxyFetchSpaceTriggers(spaceId).then(
      async ({ items }) => {
        // Sessions made by earlier versions are named "Automation: <name>".
        await renameGeneratedAutomationSessions(items, {
          projectStore: useProjectRuntimeStore.getState(),
          spaceStore: useSpaceStore.getState(),
        });
        return items;
      },
      (error) => {
        // Let a later Session open retry.
        automationsBySpace.delete(spaceId);
        throw error;
      }
    );
    automationsBySpace.set(spaceId, pending);
  }
  return pending;
}

/** Test hook: forget the per-Space lists. */
export function resetSessionAutomationCache(): void {
  automationsBySpace.clear();
}

/**
 * The Automation that owns this Session, if any. The Automations page keeps
 * the store current for the Space it shows; otherwise the Space's list is
 * fetched once.
 */
export function useSessionAutomation(
  projectId: string | null | undefined,
  spaceId: string | null | undefined
): Trigger | null {
  const storedTriggers = useTriggerStore((state) => state.triggers);
  const [spaceAutomations, setSpaceAutomations] = useState<Trigger[]>([]);

  useEffect(() => {
    if (!projectId || !spaceId) {
      setSpaceAutomations([]);
      return;
    }
    let cancelled = false;
    loadSpaceAutomations(spaceId)
      .then((items) => {
        if (!cancelled) setSpaceAutomations(items);
      })
      .catch((error) => {
        console.warn(
          '[useSessionAutomation] Failed to load Automations',
          error
        );
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, spaceId]);

  return useMemo(() => {
    if (!projectId) return null;
    // Once the Automations page has loaded this Space, its list is the live
    // one: it already reflects Automations created or deleted since.
    const source = storedTriggers.some(
      (trigger) => trigger.space_id === spaceId
    )
      ? storedTriggers
      : spaceAutomations;
    return source.find((trigger) => trigger.project_id === projectId) ?? null;
  }, [projectId, spaceAutomations, spaceId, storedTriggers]);
}
