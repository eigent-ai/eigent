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

import { isLoopbackBrowserUrl, normalizeBrowserUrl } from '@/lib/browserUrl';

/** Local generated sites need a visible handoff from the agent browser. */
export const isLocalPreviewUrl = isLoopbackBrowserUrl;

function browserVisitSucceeded(message: string | undefined): boolean {
  if (!message?.trim()) return false;

  let result = message.trim();
  try {
    const parsed = JSON.parse(result) as {
      result?: unknown;
      success?: unknown;
      error?: unknown;
    } | null;
    if (!parsed || typeof parsed !== 'object') return false;
    if (parsed.success === false || parsed.error) return false;
    if (parsed.success === true) return true;
    if (typeof parsed.result !== 'string') return false;
    result = parsed.result;
  } catch {
    if (result.startsWith('{')) {
      // toolkit_listen cuts receipts at 500 characters. The current toolkit
      // puts result first, so recover only that complete JSON string when the
      // later snapshot is truncated; never interpret page text as an outcome.
      const leadingResult = result.match(
        /^\{\s*"result"\s*:\s*("(?:[^"\\]|\\.)*")\s*[,}]/
      );
      if (
        !leadingResult ||
        !/\.\.\. \(truncated, total length: \d+ chars\)$/.test(result)
      )
        return false;
      try {
        result = JSON.parse(leadingResult[1]) as string;
      } catch {
        return false;
      }
    }
  }

  const receipt = result.trim();
  if (/^Navigation completed[.!]?$/i.test(receipt)) return true;

  // The toolkit echoes the original URL, including spaces the browser encodes.
  // Extract it from a successful receipt and use the existing URL validation.
  const navigation = receipt.match(
    /^(?:Navigated to (https?:\/\/[\s\S]+)|Opened (https?:\/\/[\s\S]+) in new tab)$/i
  );
  return !!navigation && normalizeBrowserUrl(navigation[1] || navigation[2]).ok;
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
