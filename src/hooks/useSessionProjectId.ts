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

import { useSessionPane } from '@/hooks/useSessionPane';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';

/** Pane-owned identity, with the active Session as the standalone fallback. */
export function useSessionProjectId() {
  const pane = useSessionPane();
  const activeProjectId = useProjectRuntimeStore((s) => s.activeProjectId);
  return pane ? pane.projectId : activeProjectId;
}

/** Whether this pane owns focus; standalone callers are always focused. */
export function useIsFocusedSessionPane() {
  const pane = useSessionPane();
  const focused = useProjectRuntimeStore(
    (s) => s.activeProjectId === pane?.projectId
  );
  return !pane || Boolean(focused);
}
