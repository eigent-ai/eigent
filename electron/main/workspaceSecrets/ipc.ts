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

import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import type { WorkspaceSecretLookup, WorkspaceSecretPutRequest } from './types';
import type { WorkspaceSecretVault } from './vault';

export type WorkspaceSecretIpcGuard = (event: IpcMainInvokeEvent) => void;

export function registerWorkspaceSecretIpcHandlers(
  ipcMain: IpcMain,
  vault: WorkspaceSecretVault,
  guard: WorkspaceSecretIpcGuard
): void {
  ipcMain.handle(
    'workspace-secret:put',
    (event, request: WorkspaceSecretPutRequest) => {
      guard(event);
      return vault.put(request);
    }
  );
  ipcMain.handle(
    'workspace-secret:status',
    (event, request: WorkspaceSecretLookup) => {
      guard(event);
      return vault.status(request);
    }
  );
  ipcMain.handle(
    'workspace-secret:delete',
    (event, request: WorkspaceSecretLookup) => {
      guard(event);
      return vault.delete(request);
    }
  );
}
