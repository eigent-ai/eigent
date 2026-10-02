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

import { useHost } from '@/host';
import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import { DURABLE_RUN_STATUS_CHANGED_EVENT } from '@/lib/events/durableRunEvents';
import { refreshSessionNavStatuses } from '@/service/sessionNavStatus';
import { useAuthStore } from '@/store/authStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useEffect } from 'react';

/** Scope list reconciliation to the mounted Space and its visible Sessions. */
export function useSessionNavStatuses(
  projectIds: readonly string[],
  spaceId: string | null
) {
  const accountKey = useAuthStore(getAccountEnvironmentKey);
  const ipcRenderer = useHost()?.ipcRenderer;
  const idsKey = JSON.stringify([...new Set(projectIds)].sort());
  useEffect(() => {
    const lifetime = new AbortController();
    const ids = JSON.parse(idsKey) as string[];
    const refreshIds = (targets: string[]) =>
      void refreshSessionNavStatuses(
        targets,
        accountKey,
        (projectId) =>
          useSpaceStore.getState().getProjectMeta(projectId)?.spaceId ===
          spaceId,
        lifetime.signal
      );
    const refresh = () => refreshIds(ids);
    const onStatusChanged = (event: Event) => {
      const projectId = (event as CustomEvent<{ projectId?: string }>).detail
        ?.projectId;
      if (projectId && ids.includes(projectId)) refreshIds([projectId]);
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener(DURABLE_RUN_STATUS_CHANGED_EVENT, onStatusChanged);
    ipcRenderer?.on('backend-ready', refresh);
    return () => {
      lifetime.abort();
      window.removeEventListener('focus', refresh);
      window.removeEventListener(
        DURABLE_RUN_STATUS_CHANGED_EVENT,
        onStatusChanged
      );
      ipcRenderer?.off('backend-ready', refresh);
    };
  }, [accountKey, spaceId, idsKey, ipcRenderer]);
}
