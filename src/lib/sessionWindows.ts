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
 * Routes for a window (desktop) or browser tab (web) that shows a single
 * Session. Such a window renders only the Session; the main window keeps the
 * sidebar, the Space and every background job.
 */

export const SESSION_WINDOW_PATH_PREFIX = '/session-window/';
export const SESSION_WINDOW_ROUTE = '/session-window/:spaceId/:projectId';

export interface SessionWindowTarget {
  spaceId: string;
  projectId: string;
}

export type SessionWindowRole = 'main' | 'session';

export function sessionWindowPath({ spaceId, projectId }: SessionWindowTarget) {
  return `${SESSION_WINDOW_PATH_PREFIX}${encodeURIComponent(
    spaceId
  )}/${encodeURIComponent(projectId)}`;
}

/** The Session a window shows, read from its route; null in the main window. */
export function parseSessionWindowPath(
  pathname: string
): SessionWindowTarget | null {
  if (!pathname.startsWith(SESSION_WINDOW_PATH_PREFIX)) return null;
  const [spaceId, projectId, ...rest] = pathname
    .slice(SESSION_WINDOW_PATH_PREFIX.length)
    .split('/');
  if (!spaceId || !projectId || rest.some(Boolean)) return null;
  try {
    return {
      spaceId: decodeURIComponent(spaceId),
      projectId: decodeURIComponent(projectId),
    };
  } catch {
    return null;
  }
}

/** Route of this document: the hash route on desktop, the path on the web. */
function currentRoutePath(): string {
  if (typeof window === 'undefined') return '/';
  const hash = window.location.hash;
  if (hash.startsWith('#/')) return hash.slice(1).split('?')[0];
  return window.location.pathname;
}

export function getSessionWindowTarget(): SessionWindowTarget | null {
  return parseSessionWindowPath(currentRoutePath());
}

/** Fixed for the document's life: a window never changes role. */
export function getSessionWindowRole(): SessionWindowRole {
  return getSessionWindowTarget() ? 'session' : 'main';
}
