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
  invalidatePendingHumanInteractions,
  isHumanInteractionStillPending,
  type HumanInteractionPayload,
} from './humanInteractionApi';

const RETRY_INITIAL_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 15_000;

export interface HumanInteractionPendingWatch {
  /** Re-read now, bypassing the short pending-list cache and the backoff. */
  recheck: () => void;
  dispose: () => void;
}

/**
 * Track whether Brain still lists an interaction as pending.
 *
 * Only an answer from Brain is reported as `true` or `false`. A read that
 * fails or times out (for example while every connection to Brain is busy)
 * leaves the outcome unknown: it is reported as `null`, never as "not
 * pending", and retried after 1 s, doubling up to 15 s, until Brain answers.
 */
export function watchHumanInteractionPending(
  interaction: HumanInteractionPayload,
  onResult: (pending: boolean | null) => void
): HumanInteractionPendingWatch {
  let disposed = false;
  let latestCheck = 0;
  let failures = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const check = () => {
    clearTimeout(retry);
    const currentCheck = ++latestCheck;
    isHumanInteractionStillPending(interaction).then(
      (pending) => {
        if (disposed || currentCheck !== latestCheck) return;
        failures = 0;
        onResult(pending);
      },
      (error) => {
        if (disposed || currentCheck !== latestCheck) return;
        console.debug('[HumanInteraction] pending check deferred', error);
        onResult(null);
        const delay = Math.min(
          RETRY_MAX_DELAY_MS,
          RETRY_INITIAL_DELAY_MS * 2 ** failures
        );
        failures += 1;
        retry = setTimeout(check, delay);
      }
    );
  };

  check();
  return {
    recheck: () => {
      invalidatePendingHumanInteractions(interaction.run_id);
      check();
    },
    dispose: () => {
      disposed = true;
      clearTimeout(retry);
    },
  };
}
