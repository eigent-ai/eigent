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

import { getAccountEnvironmentKey } from '@/lib/authEnvironment';

/** Keep a confirmed deletion pending until Brain accepts its unbind. */
export async function scheduleWorkspaceUnbind(
  spaceId: string,
  owner: { email: string; userId: number | null; accountKey: string }
): Promise<void> {
  const [
    { unbindWorkspaceFromBrain },
    { useInstallationStore },
    { getAuthStore },
  ] = await Promise.all([
    import('@/service/workspaceApi'),
    import('@/store/installationStore'),
    import('@/store/authStore'),
  ]);
  let stopped = false;
  let inFlight: AbortController | undefined;
  let retryRequested = false;
  let unsubscribe = () => {};

  const attempt = async () => {
    if (stopped) return;
    if (getAccountEnvironmentKey(getAuthStore()) !== owner.accountKey) {
      stopped = true;
      unsubscribe();
      inFlight?.abort();
      return;
    }
    if (!useInstallationStore.getState().isBackendReady) return;
    if (inFlight) {
      retryRequested = true;
      return;
    }
    const controller = new AbortController();
    inFlight = controller;
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      await unbindWorkspaceFromBrain(spaceId, owner.email, owner.userId, {
        signal: controller.signal,
        expectedAccountKey: owner.accountKey,
      });
      stopped = true;
      unsubscribe();
    } catch (error) {
      if (!stopped) {
        console.warn(
          `[spaceStore] Failed to unbind deleted Space ${spaceId} from Brain; will retry when the backend is ready again:`,
          error
        );
      }
    } finally {
      clearTimeout(timeout);
      inFlight = undefined;
      if (retryRequested) {
        retryRequested = false;
        void attempt();
      }
    }
  };

  // Subscribe before checking readiness so recovery cannot fall between the
  // initial attempt and registration. A failure retains this subscription;
  // success (or a different owner) releases it. No polling or tight retry loop.
  unsubscribe = useInstallationStore.subscribe(
    (state) => state.isBackendReady,
    (ready) => {
      if (ready) void attempt();
      else inFlight?.abort();
    }
  );
  void attempt();
}
