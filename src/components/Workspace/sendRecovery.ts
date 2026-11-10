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

import type { FileAttachment } from '@/components/ChatBox/BottomBox';
import type { WorkspaceTabId } from '@/store/pageTabStore';

/**
 * A draft handed back to the composer after Send opened its Session and the
 * server then rejected that Session, so there is no Session to stay in. The
 * composer has unmounted by then, so the draft waits here for the composer
 * that mounts on the same Space and tab.
 */
export interface WorkspaceSendRecovery {
  spaceId: string;
  tab: WorkspaceTabId;
  message: string;
  files: FileAttachment[];
}

let pendingRecovery: WorkspaceSendRecovery | null = null;

export function setWorkspaceSendRecovery(
  recovery: WorkspaceSendRecovery | null
): void {
  pendingRecovery = recovery;
}

export function peekWorkspaceSendRecovery(
  spaceId: string | null,
  tab: WorkspaceTabId
): WorkspaceSendRecovery | null {
  return pendingRecovery &&
    pendingRecovery.spaceId === spaceId &&
    pendingRecovery.tab === tab
    ? pendingRecovery
    : null;
}

export function clearWorkspaceSendRecovery(
  recovery: WorkspaceSendRecovery
): void {
  if (pendingRecovery === recovery) pendingRecovery = null;
}
