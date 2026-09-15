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

import { isLoopbackBrowserUrl } from '@/lib/browserUrl';

/** Local generated sites need a visible handoff from the agent browser. */
export const isLocalPreviewUrl = isLoopbackBrowserUrl;

function browserVisitSucceeded(message: string | undefined): boolean {
  if (!message?.trim()) return false;

  let result = message;
  try {
    const parsed = JSON.parse(message) as { result?: unknown };
    if (typeof parsed.result === 'string') result = parsed.result;
  } catch {
    // Older toolkit responses are plain text rather than JSON.
  }

  return !/error|failed|failure|refused|unreachable|timed?\s*out|net::err_/i.test(
    result
  );
}

/** One reveal per live request, without changing the user's active Session. */
export function createBrowserPreviewHandoff(
  projectId: string | null | undefined,
  open: (url: string, projectId: string) => void
) {
  let revealed = false;
  const pending = new Map<string, string>();

  return {
    recordVisit(url: string, toolCallId = 'current') {
      if (revealed || !projectId || !isLocalPreviewUrl(url)) return;
      pending.set(toolCallId, url);
    },
    completeVisit(message: string | undefined, toolCallId = 'current') {
      const url = pending.get(toolCallId);
      pending.delete(toolCallId);
      if (revealed || !url || !projectId || !browserVisitSucceeded(message))
        return;
      revealed = true;
      pending.clear();
      open(url, projectId);
    },
  };
}
