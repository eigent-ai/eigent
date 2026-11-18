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

/** Main -> renderer: a frame embedded in the main window failed to load.
 * The renderer cannot see this itself: a failed frame shows a cross-origin
 * error page and still fires `load`. */
export const SUBFRAME_LOAD_FAILED_CHANNEL = 'subframe-load-failed' as const;

export interface SubframeLoadFailure {
  url: string;
  errorCode: number;
}

/** net::ERR_ABORTED: the frame was removed or navigated elsewhere first. */
const ERR_ABORTED = -3;

/** The failure to forward from a `did-fail-load` event, if any. */
export function subframeLoadFailureFromEvent(
  errorCode: number,
  url: string,
  isMainFrame: boolean
): SubframeLoadFailure | null {
  if (isMainFrame || errorCode === ERR_ABORTED || !url) return null;
  return { url, errorCode };
}

export function isSubframeLoadFailure(
  value: unknown
): value is SubframeLoadFailure {
  if (!value || typeof value !== 'object') return false;
  const failure = value as Partial<SubframeLoadFailure>;
  return (
    typeof failure.url === 'string' && typeof failure.errorCode === 'number'
  );
}

/** Compare a reported frame URL with an iframe `src` after normalization. */
export function isSameFrameUrl(reported: string, src: string): boolean {
  try {
    return new URL(reported).href === new URL(src).href;
  } catch {
    return reported === src;
  }
}
