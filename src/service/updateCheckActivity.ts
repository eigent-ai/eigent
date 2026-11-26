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

import { hasUnfinishedLegacyTask } from '@/lib/unfinishedLegacyTask';
import { fetchActiveLocalExecution } from '@/service/runCloseGuard';
import { hasAnyActiveLegacySSEConnection } from '@/store/chatStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';

const ACTIVE_RUN_LOOKUP_TIMEOUT_MS = 2_500;

/**
 * Whether a task is running anywhere in this app, so a background update
 * check can wait for it to finish.
 *
 * Unlike the close guard, an unreachable Run registry counts as idle: a
 * background check never stops work, it only keeps the update button from
 * appearing mid-task, and a Brain that does not answer is not running one.
 */
export async function isLocalTaskRunning({
  fetchActive = fetchActiveLocalExecution,
  timeoutMs = ACTIVE_RUN_LOOKUP_TIMEOUT_MS,
}: {
  fetchActive?: typeof fetchActiveLocalExecution;
  timeoutMs?: number;
} = {}): Promise<boolean> {
  const chatStates = Object.values(
    useProjectRuntimeStore.getState().projects
  ).flatMap((runtime) =>
    Object.values(runtime.chatStores ?? {}).map((store) => store.getState())
  );
  if (
    hasAnyActiveLegacySSEConnection() ||
    hasUnfinishedLegacyTask(chatStates)
  ) {
    return true;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchActive(controller.signal);
    return response?.active === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
