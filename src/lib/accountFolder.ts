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

import { createHost } from '@/host/createHost';

const registered = new Set<string>();

/**
 * Tell the desktop app which account is signed in, so it keeps that account's
 * keys, MCP sign-ins and Codex sign-in in the account's own `user_<id>` folder
 * (copying them from the old shared folder the first time). Does nothing on the
 * web, or without an email and user id. Failures are retried on the next call.
 */
export async function registerAccountFolder(
  email: string | null | undefined,
  userId: string | number | null | undefined
): Promise<void> {
  const address = typeof email === 'string' ? email.trim() : '';
  if (!address || userId === null || userId === undefined || userId === '') {
    return;
  }
  const register = createHost().electronAPI?.registerAccountFolder;
  if (typeof register !== 'function') return;

  const key = `${address}\u0000${userId}`;
  if (registered.has(key)) return;
  registered.add(key);
  try {
    await register(address, userId);
  } catch (error) {
    registered.delete(key);
    console.warn(
      '[accountFolder] could not register the account folder',
      error
    );
  }
}

/** Test helper: forget which accounts were registered in this window. */
export function resetRegisteredAccountFolders(): void {
  registered.clear();
}
