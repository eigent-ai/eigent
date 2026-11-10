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

import { retainSessionPane } from '@/lib/sessionPaneLifetime';
import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  type ReactNode,
} from 'react';

interface SessionPaneScope {
  projectId: string | null;
  previewScopeId: string | null;
  overlaySlotId: string;
}

const SessionPaneContext = createContext<SessionPaneScope | undefined>(
  undefined
);

/** Explicit pane identity. An absent provider preserves single-Session callers. */
export function SessionPaneProvider({
  projectId,
  previewScopeId = projectId,
  retain = true,
  children,
}: {
  projectId: string | null;
  previewScopeId?: string | null;
  /**
   * Keep the runtime alive while mounted. A pane that follows the active
   * Session must not retain: its old id is still held when the next
   * `setActiveProject` evicts, which would always spare the outgoing Session.
   */
  retain?: boolean;
  children: ReactNode;
}) {
  const overlaySlotId = useId();
  useLayoutEffect(
    () => (retain && projectId ? retainSessionPane(projectId) : undefined),
    [retain, projectId]
  );
  return (
    <SessionPaneContext.Provider
      value={{ projectId, previewScopeId, overlaySlotId }}
    >
      {children}
    </SessionPaneContext.Provider>
  );
}

export function useSessionPane() {
  return useContext(SessionPaneContext);
}
