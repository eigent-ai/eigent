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

import { useSessionProjectId } from '@/hooks/useSessionProjectId';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useCallback, useState } from 'react';

/** True while the Session's history is being reloaded. */
export function useHistoryLoading(): boolean {
  const projectId = useSessionProjectId();
  return useProjectRuntimeStore((state) =>
    projectId ? Boolean(state.historyLoadingProjectIds[projectId]) : false
  );
}

/**
 * True when this component first rendered while the Session's history was
 * still loading, so it shows reloaded history rather than new activity.
 * Reloaded history appears where it ended; only new activity animates in.
 */
export function useLoadedFromHistory(): boolean {
  const historyLoading = useHistoryLoading();
  // Decided once, at mount: a reloaded group stays still when loading ends.
  const [loadedFromHistory] = useState(historyLoading);
  return loadedFromHistory;
}

/**
 * Returns the `initial` value for a Motion entrance: the given start state
 * for new activity, or `false` (start at rest) for reloaded history.
 */
export function useHistoryEntrance() {
  const loadedFromHistory = useLoadedFromHistory();
  return useCallback(
    <T>(initial: T): T | false => (loadedFromHistory ? false : initial),
    [loadedFromHistory]
  );
}
