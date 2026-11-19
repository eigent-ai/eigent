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

export interface WorkspaceConfigurationNavigationGuard {
  hasPendingChanges: () => boolean;
  flushSave: () => Promise<boolean>;
}

let activeGuard: WorkspaceConfigurationNavigationGuard | null = null;
let activeFlush: Promise<boolean> | null = null;

export function registerWorkspaceConfigurationNavigationGuard(
  guard: WorkspaceConfigurationNavigationGuard
): () => void {
  activeGuard = guard;
  return () => {
    if (activeGuard === guard) activeGuard = null;
  };
}

export function hasPendingWorkspaceConfigurationChanges(): boolean {
  return activeGuard?.hasPendingChanges() ?? false;
}

export async function flushWorkspaceConfigurationBeforeNavigation(): Promise<boolean> {
  const guard = activeGuard;
  if (!guard || !guard.hasPendingChanges()) return true;
  if (activeFlush) return activeFlush;

  const flush = guard.flushSave();
  activeFlush = flush;
  try {
    return await flush;
  } finally {
    if (activeFlush === flush) activeFlush = null;
  }
}

export async function runAfterWorkspaceConfigurationSave(
  action: () => void | Promise<void>
): Promise<boolean> {
  if (!(await flushWorkspaceConfigurationBeforeNavigation())) return false;
  await action();
  return true;
}
