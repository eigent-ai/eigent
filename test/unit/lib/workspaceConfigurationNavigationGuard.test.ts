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

import {
  registerWorkspaceConfigurationNavigationGuard,
  runAfterWorkspaceConfigurationSave,
} from '@/lib/workspaceConfigurationNavigationGuard';
import { expect, it, vi } from 'vitest';

it('blocks navigation when the pending Workspace Configuration cannot save', async () => {
  const action = vi.fn();
  const unregister = registerWorkspaceConfigurationNavigationGuard({
    hasPendingChanges: () => true,
    flushSave: vi.fn().mockResolvedValue(false),
  });

  await expect(runAfterWorkspaceConfigurationSave(action)).resolves.toBe(false);
  expect(action).not.toHaveBeenCalled();
  unregister();
});

it('coalesces concurrent navigation attempts behind one flush', async () => {
  let resolveFlush!: (saved: boolean) => void;
  const flushSave = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        resolveFlush = resolve;
      })
  );
  const firstAction = vi.fn();
  const secondAction = vi.fn();
  const unregister = registerWorkspaceConfigurationNavigationGuard({
    hasPendingChanges: () => true,
    flushSave,
  });

  const first = runAfterWorkspaceConfigurationSave(firstAction);
  const second = runAfterWorkspaceConfigurationSave(secondAction);
  expect(flushSave).toHaveBeenCalledTimes(1);

  resolveFlush(true);
  await expect(first).resolves.toBe(true);
  await expect(second).resolves.toBe(true);
  expect(firstAction).toHaveBeenCalledTimes(1);
  expect(secondAction).toHaveBeenCalledTimes(1);
  unregister();
});
