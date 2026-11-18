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

import { runProjectionStore } from '@/lib/runEvents/projectionStore';
import { markSessionOutcomeSeen } from '@/lib/sessionOutcome';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useEffect } from 'react';

/**
 * A result that lands while its Session is on screen is read already. In a
 * window that isn't focused, it counts once the person comes back.
 */
export function useMarkSessionOutcomeSeen(projectId: string | null) {
  const leadKind = useProjectRuntimeStore((state) =>
    projectId ? state.navLeadByProjectId[projectId]?.kind : undefined
  );
  useEffect(() => {
    if (!projectId) return;
    const mark = () => {
      if (document.hasFocus()) markSessionOutcomeSeen(projectId);
    };
    mark();
    window.addEventListener('focus', mark);
    const unsubscribe = runProjectionStore.subscribeProject(projectId, mark);
    return () => {
      window.removeEventListener('focus', mark);
      unsubscribe();
    };
  }, [projectId, leadKind]);
}
