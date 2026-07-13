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

import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { collectTerminalSources, type TerminalSource } from './terminalSources';

/**
 * Live terminal streams for the active project, across every turn's chat
 * store. Each store is a vanilla zustand store, so this subscribes to all of
 * them and recomputes on any change — `collectTerminalSources` is a cheap
 * flatten, and terminal writes arrive with the same cadence anyway.
 */
export function useSessionTerminalSources(): TerminalSource[] {
  const projectStore = useProjectRuntimeStore();
  const projectId = projectStore.activeProjectId;

  const chatEntries = useMemo(
    () => (projectId ? projectStore.getAllChatStores(projectId) : []),
    [projectStore, projectId]
  );

  const computeSources = useCallback(
    () =>
      collectTerminalSources(
        chatEntries.map(({ chatId, chatStore }) => ({
          chatId,
          tasks: chatStore.getState().tasks,
        }))
      ),
    [chatEntries]
  );

  const [sources, setSources] = useState<TerminalSource[]>(computeSources);
  useEffect(() => {
    setSources(computeSources());
    const unsubscribes = chatEntries.map(({ chatStore }) =>
      chatStore.subscribe(() => setSources(computeSources()))
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [chatEntries, computeSources]);

  return sources;
}
