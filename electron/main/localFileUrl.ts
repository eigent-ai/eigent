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
 * Extract an OS path from Eigent's localfile URL.
 *
 * New URLs use a fixed host and keep the case-sensitive path in a query
 * parameter. The legacy fallback reconstructs URLs where the first macOS path
 * segment was accidentally parsed as a lower-cased hostname.
 */
export function filePathFromLocalFileUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'localfile:') {
    throw new Error('Unsupported local file protocol');
  }

  const queryPath = parsed.searchParams.get('path');
  if (parsed.hostname === 'preview' && queryPath) return queryPath;

  const pathname = decodeURIComponent(parsed.pathname);
  // Navigable local HTML uses a fixed host with the absolute filesystem path
  // in the pathname. Unlike `localfile:///Users/...`, this keeps Chromium from
  // treating the first path segment as a lower-cased hostname when resolving a
  // relative link from an injected <base> element.
  if (parsed.hostname === 'preview') return pathname;
  if (parsed.hostname) return `/${parsed.hostname}${pathname}`;
  return pathname;
}
