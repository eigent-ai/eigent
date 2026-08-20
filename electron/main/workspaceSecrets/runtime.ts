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

import { WorkspaceSecretBroker } from './broker';
import type { WorkspaceSecretBrokerRuntime } from './types';
import { WorkspaceSecretVault } from './vault';

let defaultVault: WorkspaceSecretVault | null = null;
let defaultBroker: WorkspaceSecretBroker | null = null;
let brokerStart: Promise<WorkspaceSecretBrokerRuntime> | null = null;

export function getDefaultWorkspaceSecretVault(): WorkspaceSecretVault {
  defaultVault ??= new WorkspaceSecretVault();
  return defaultVault;
}

export function ensureWorkspaceSecretBroker(): Promise<WorkspaceSecretBrokerRuntime> {
  if (!brokerStart) {
    defaultBroker = new WorkspaceSecretBroker(getDefaultWorkspaceSecretVault());
    brokerStart = defaultBroker.start().catch((error) => {
      defaultBroker = null;
      brokerStart = null;
      throw error;
    });
  }
  return brokerStart;
}

export async function closeWorkspaceSecretBroker(): Promise<void> {
  const broker = defaultBroker;
  defaultBroker = null;
  brokerStart = null;
  await broker?.close();
}
