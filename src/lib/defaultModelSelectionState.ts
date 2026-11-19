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

/** In-memory ownership of an explicit default selection while its save is pending. */
export interface DefaultModelSelectionSnapshot {
  readonly selection: Readonly<{
    modelType: 'custom' | 'local' | 'cloud';
    provider_id?: number;
    model_platform?: string;
    model_type?: string;
  }>;
  readonly saved: Promise<boolean>;
}

const pending = new Map<string, DefaultModelSelectionSnapshot>();

export function captureDefaultModelSelection(accountKey: string) {
  return pending.get(accountKey) ?? null;
}

export function saveDefaultModelSelection(
  accountKey: string,
  selection: DefaultModelSelectionSnapshot['selection'],
  save: () => Promise<boolean>
): Promise<boolean> {
  const previous = pending.get(accountKey);
  // Serialize explicit changes in an account. Capture happens synchronously,
  // before the first HTTP await, so Send owns exactly the selected option.
  const saved = (previous?.saved ?? Promise.resolve(true))
    .then(save)
    .catch(() => false);
  const snapshot = Object.freeze({
    selection: Object.freeze({ ...selection }),
    saved,
  });
  pending.set(accountKey, snapshot);
  void saved.then((success) => {
    // Once acknowledged, the server is authoritative again. A failed save
    // stays visible to Send rather than falling back to the old preference.
    if (success && pending.get(accountKey) === snapshot)
      pending.delete(accountKey);
  });
  return saved;
}
