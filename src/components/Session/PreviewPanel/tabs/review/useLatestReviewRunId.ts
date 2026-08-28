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
import { selectLatestReviewRunId } from './reviewSources';

/** Live latest task id for the project that owns the Session preview panel. */
export function useLatestReviewRunId(): string | undefined {
  const projectId = usePageTabStore((state) => state.sessionPreviewProjectId);
  const projectChatStores = useProjectRuntimeStore((state) =>
    projectId ? state.projects[projectId]?.chatStores : undefined
  );
  const chatStores = useMemo(
    () => Object.values(projectChatStores ?? {}),
    [projectChatStores]
  );
  const computeLatestRunId = useCallback(
    () =>
      selectLatestReviewRunId(
        chatStores.map((chatStore) => {
          const state = chatStore.getState();
          return {
            tasks: state.tasks,
          };
        })
      ) ?? undefined,
    [chatStores]
  );
  const [latestRunId, setLatestRunId] = useState<string | undefined>(
    computeLatestRunId
  );

  useEffect(() => {
    const update = () => {
      const next = computeLatestRunId();
      setLatestRunId((current) => (current === next ? current : next));
    };
    update();
    const unsubscribes = chatStores.map((chatStore) =>
      chatStore.subscribe(update)
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [chatStores, computeLatestRunId]);

  return latestRunId;
}
