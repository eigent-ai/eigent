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

import type { FetchRequestOptions } from '@/api/http';
import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import { getAuthStore } from '@/store/authStore';
import { getBrainConnectionGeneration } from '@/store/connectionStore';

export const CONTROL_REQUEST_TIMEOUT_MS = 15_000;

export function controlOwner(): string {
  return JSON.stringify([
    getAccountEnvironmentKey(getAuthStore()),
    getBrainConnectionGeneration(),
  ]);
}

export class ControlOutcomeUnknown extends Error {
  constructor() {
    super('Control outcome is not confirmed');
    this.name = 'ControlOutcomeUnknown';
  }
}

/** Bounds lookup, delivery and body consumption, including uncooperative promises.
 * Aborting this wait never asserts that the server cancelled its operation.
 */
export function controlRequest<T>(
  work: (options: FetchRequestOptions) => Promise<T>,
  owner = controlOwner()
): Promise<T> {
  const controller = new AbortController();
  const account = getAccountEnvironmentKey(getAuthStore());
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (error: unknown, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      controller.abort();
      if (error) reject(error);
      else resolve(value as T);
    };
    const timer = setTimeout(
      () => finish(new ControlOutcomeUnknown()),
      CONTROL_REQUEST_TIMEOUT_MS
    );
    const beforeRequest = () => {
      if (settled || controller.signal.aborted || controlOwner() !== owner)
        throw new ControlOutcomeUnknown();
    };
    Promise.resolve()
      .then(() => {
        beforeRequest();
        return work({
          signal: controller.signal,
          expectedAccountKey: account,
          beforeRequest,
          assertCurrent: beforeRequest,
        });
      })
      .then(
        (value) => {
          try {
            beforeRequest();
            finish(null, value);
          } catch (error) {
            finish(error);
          }
        },
        (error) => finish(error)
      );
  });
}
