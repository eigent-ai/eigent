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

import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { collectTerminalSources, type TerminalSource } from './terminalSources';

interface SessionTerminalSourceOptions {
  /**
   * The read-only terminal needs a render for appended output. The chooser
   * only needs stream identity/status and can ignore token-only changes.
   */
  trackOutput?: boolean;
}

function sameSourceMetadata(
  previous: TerminalSource[],
  next: TerminalSource[]
): boolean {
  return (
    previous.length === next.length &&
    previous.every((source, index) => {
      const candidate = next[index];
      return (
        source.id === candidate.id &&
        source.agentName === candidate.agentName &&
        source.taskLabel === candidate.taskLabel &&
        source.status === candidate.status &&
        source.lines === candidate.lines
      );
    })
  );
}

/**
 * Live terminal streams for the project currently owning the preview panel,
 * across every turn's chat store.
 */
export function useSessionTerminalSources(
  options: SessionTerminalSourceOptions = {}
): TerminalSource[] {
  const { trackOutput = true } = options;
  const projectId = usePageTabStore((state) => state.sessionPreviewProjectId);
  const projectChatStores = useProjectRuntimeStore((state) =>
    projectId ? state.projects[projectId]?.chatStores : undefined
  );
  const chatStoreTimestamps = useProjectRuntimeStore((state) =>
    projectId ? state.projects[projectId]?.chatStoreTimestamps : undefined
  );

  const chatEntries = useMemo(() => {
    if (!projectChatStores) return [];
    return Object.entries(projectChatStores)
      .map(([chatId, chatStore]) => ({
        chatId,
        chatStore,
        createdAt: chatStoreTimestamps?.[chatId] ?? 0,
      }))
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [chatStoreTimestamps, projectChatStores]);

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
      chatStore.subscribe(() => {
        const next = computeSources();
        setSources((previous) =>
          !trackOutput && sameSourceMetadata(previous, next) ? previous : next
        );
      })
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [chatEntries, computeSources, trackOutput]);

  return sources;
}
