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

import { decodeTransportMessage } from '../decode';
import { normalizeEvent } from '../normalize';
import type { CanonicalProjectEvent } from '../types';

export type LegacyChatStepContext = {
  projectId: string;
  runId: string;
  /** Monotonic within this live transport connection. */
  sequence: number;
  /** Distinguishes reconnects when the legacy frame has no server identity. */
  sourceId?: string;
  createdAt?: string | number;
};

/**
 * Give raw `/chat` steps an explicit Project/Run scope and a stable identity
 * for the lifetime of the connection. These synthetic IDs are migration-only:
 * they must never be used to claim identity with a later canonical replay.
 */
export function normalizeLegacyChatStep(
  raw: unknown,
  context: LegacyChatStepContext
): CanonicalProjectEvent {
  if (!context.projectId || !context.runId) {
    throw new Error('Legacy Chat steps require project and run ids');
  }
  if (!Number.isInteger(context.sequence) || context.sequence < 1) {
    throw new Error('Legacy Chat step sequence must be a positive integer');
  }

  const message = decodeTransportMessage(raw);
  const stepId = message.step_id ?? message.id ?? context.sequence;
  return normalizeEvent(
    {
      ...message,
      project_id: message.project_id ?? context.projectId,
      task_id: message.task_id ?? message.run_id ?? context.runId,
      step_id: stepId,
      event_id:
        message.event_id ??
        `chat_step_v1:${context.projectId}:${context.runId}:${context.sourceId || 'stream'}:${context.sequence}`,
      timestamp:
        message.timestamp ??
        message.created_at ??
        context.createdAt ??
        Date.now(),
    },
    'chat_step_v1'
  );
}
