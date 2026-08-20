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

import { matchPath } from 'react-router-dom';

/**
 * Router state key used by every entry into Home / Settings. The route layout
 * uses it to retain the Workspace subtree when the user arrived from there,
 * so browser history can restore the still-mounted Workspace state.
 */
export const SHELL_BACK_STATE_KEY = 'from';

/** Build the `state` payload for a navigation into a full-page shell surface. */
export function shellBackState(from: string): { from: string } {
  return { [SHELL_BACK_STATE_KEY]: from };
}

/** Match the canonical Home management surface and its legacy Settings URL. */
export function isSettingsRoutePath(pathname: string): boolean {
  return Boolean(
    matchPath({ path: '/home', end: true }, pathname) ||
    matchPath({ path: '/settings', end: true }, pathname)
  );
}
