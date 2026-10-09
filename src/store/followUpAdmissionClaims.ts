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

/**
 * Composer admissions in flight, by Project id.
 *
 * Switching Sessions remounts the composer while an earlier submit may still
 * be admitting, and the restored draft still shows its text. The claim must
 * outlive that mount, or the new composer could submit the same text again.
 */
export const followUpAdmissionClaims = new Map<string, symbol>();

const releaseListeners = new Set<() => void>();

/** Call `listener` whenever a claim is released. Returns an unsubscribe. */
export function onFollowUpAdmissionReleased(listener: () => void): () => void {
  releaseListeners.add(listener);
  return () => {
    releaseListeners.delete(listener);
  };
}

/** Wake every composer whose queued work yielded to a released claim. */
export function notifyFollowUpAdmissionReleased(): void {
  releaseListeners.forEach((listener) => listener());
}

/** Forget all claims (tests). */
export function resetFollowUpAdmissionClaims(): void {
  followUpAdmissionClaims.clear();
}
