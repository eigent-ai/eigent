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
import type { ModelConfigurationStore } from './store';
import type {
  ModelConfigurationDefaultRequest,
  ModelConfigurationImportRequest,
  ModelConfigurationLookup,
  ModelConfigurationSaveRequest,
  ModelConfigurationServerLinkRequest,
} from './types';

export type ModelConfigurationIpcGuard = (event: IpcMainInvokeEvent) => void;

/**
 * The app window can list, save and remove configurations and choose the
 * default. No handler returns a secret value: reading one is available only
 * to the local backend, through the private loopback channel.
 */
export function registerModelConfigurationIpcHandlers(
  ipcMain: IpcMain,
  store: ModelConfigurationStore,
  guard: ModelConfigurationIpcGuard
): void {
  ipcMain.handle(
    'model-configuration:list',
    (event, request: { account_scope: string }) => {
      guard(event);
      return store.list(request?.account_scope);
    }
  );
  ipcMain.handle(
    'model-configuration:save',
    (event, request: ModelConfigurationSaveRequest) => {
      guard(event);
      return store.save(request);
    }
  );
  ipcMain.handle(
    'model-configuration:set-default',
    (event, request: ModelConfigurationDefaultRequest) => {
      guard(event);
      store.setDefault(request);
    }
  );
  ipcMain.handle(
    'model-configuration:import',
    (event, request: ModelConfigurationImportRequest) => {
      guard(event);
      store.importRecords(request);
    }
  );
  ipcMain.handle(
    'model-configuration:set-server-id',
    (event, request: ModelConfigurationServerLinkRequest) => {
      guard(event);
      store.setServerId(request);
    }
  );
  ipcMain.handle(
    'model-configuration:delete',
    (event, request: ModelConfigurationLookup) => {
      guard(event);
      store.delete(request);
    }
  );
}
