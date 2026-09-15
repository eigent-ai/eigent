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

/** Local generated sites need a visible handoff from the agent browser. */
export function isLocalPreviewUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      /^(localhost|127(?:\.\d{1,3}){3}|\[::1\]|0\.0\.0\.0)$/i.test(url.hostname)
    );
  } catch {
    return false;
  }
}

/** One reveal per live request, without changing the user's active Session. */
export function createBrowserPreviewHandoff(
  projectId: string | null | undefined,
  open: (url: string, projectId: string) => void
) {
  let revealed = false;
  return (url: string) => {
    if (revealed || !projectId || !isLocalPreviewUrl(url)) return;
    revealed = true;
    open(url, projectId);
  };
}
