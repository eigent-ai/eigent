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

/**
 * Local `/runs/{runId}/stream` envelopes predate the Cloud projector shape:
 * they use `sequence` and intentionally omit `project_id`. Keep that transport
 * difference at the source boundary so every downstream reducer sees the same
 * canonical event contract.
 */
export function normalizeLocalRunEvent(
  raw: unknown,
  projectId: string
): CanonicalProjectEvent {
  if (!projectId) {
    throw new Error('Local Run events require a trusted project id');
  }

  const message = decodeTransportMessage(raw);
  return normalizeEvent({
    ...message,
    project_id: message.project_id ?? projectId,
    run_sequence: message.run_sequence ?? message.sequence,
  });
}
