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
 * Read the remote-control link token from the URL.
 *
 * Fragment is the canonical location (`#t=...`) because it never leaves the browser:
 * it is not sent to the server, not logged in access logs, and not included in the
 * Referer header. The `?t=` query form is accepted only as a fallback for shares
 * that strip fragments (e.g. some SMS clients).
 */
export function parseRemoteControlToken(search: string, hash: string): string {
  const normalizedHash = hash.replace(/^#/, '');
  const fragmentToken = new URLSearchParams(normalizedHash).get('t');
  if (fragmentToken) {
    return fragmentToken;
  }
  return new URLSearchParams(search).get('t') || '';
}
