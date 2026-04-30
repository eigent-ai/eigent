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

const STORAGE_KEY = 'eigent-workspace-return';

/** Last app path before opening `/history` — used for Support / exit, not full browser history. */
export function lastNonHistoryAppPath(): string {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw || raw.startsWith('/history')) return '/';
    return raw;
  } catch {
    return '/';
  }
}

export function persistLastNonHistoryPath(pathWithSearch: string): void {
  try {
    if (!pathWithSearch.startsWith('/history')) {
      sessionStorage.setItem(STORAGE_KEY, pathWithSearch);
    }
  } catch {
    /* ignore */
  }
}
