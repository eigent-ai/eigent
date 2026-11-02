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

import {
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from '@/store/settingsStore';
import { matchPath } from 'react-router-dom';

/**
 * Router state key used by every entry into Home / Settings. The route layout
 * uses it to retain the Workspace subtree when the user arrived from there,
 * so browser history can restore the still-mounted Workspace state.
 */
export const SHELL_BACK_STATE_KEY = 'from';

/**
 * Router-state key for the page that opened a Space, Skill, or Connector
 * detail. This is separate from `from`, which records where the full Home /
 * Settings shell was opened from.
 */
export const SHELL_DETAIL_BACK_STATE_KEY = 'detailFrom';

/** Build the `state` payload for a navigation into a full-page shell surface. */
export function shellBackState(from: string): { from: string } {
  return { [SHELL_BACK_STATE_KEY]: from };
}

type ShellRouteState = Record<string, unknown> | null | undefined;

function isInternalRoute(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//')
  );
}

/** Preserve the shell origin while recording the page that opened a detail. */
export function shellDetailBackState(
  state: ShellRouteState,
  from: string
): Record<string, unknown> {
  return {
    ...(state ?? {}),
    [SHELL_DETAIL_BACK_STATE_KEY]: from,
  };
}

/** Resolve a detail's explicit origin, falling back to the shell entry page. */
export function shellDetailBackTarget(state: ShellRouteState): string | null {
  const detailOrigin = state?.[SHELL_DETAIL_BACK_STATE_KEY];
  if (isInternalRoute(detailOrigin)) return detailOrigin;

  const shellOrigin = state?.[SHELL_BACK_STATE_KEY];
  return isInternalRoute(shellOrigin) ? shellOrigin : null;
}

/** Remove a consumed detail origin while retaining unrelated router state. */
export function withoutShellDetailBackState(
  state: ShellRouteState
): Record<string, unknown> | undefined {
  if (!state) return undefined;
  const next = { ...state };
  delete next[SHELL_DETAIL_BACK_STATE_KEY];
  return next;
}

/** Pages that hide the Workspace while keeping it mounted: Home and Settings. */
export function isSettingsRoutePath(pathname: string): boolean {
  return isHomePagePath(pathname) || isSettingsPagePath(pathname);
}

/** The Home page: every Space and each Space's details. */
export function isHomePagePath(pathname: string): boolean {
  return Boolean(matchPath({ path: '/home', end: true }, pathname));
}

/** The Settings page: app-wide setup and the Skill / Connector details. */
export function isSettingsPagePath(pathname: string): boolean {
  return Boolean(matchPath({ path: '/settings', end: true }, pathname));
}

export function isSettingsSection(
  value: string | null
): value is SettingsSectionId {
  return SETTINGS_SECTIONS.includes(value as SettingsSectionId);
}

/**
 * Home and Settings used to share one page, so older links address Settings
 * through `section` (`/home?section=settings&tab=models`, or the earlier
 * `/settings?section=models`). Fold either form into the Settings page's own
 * `?tab=` search and keep every other parameter (provider, skillId, …).
 */
export function settingsPageSearch(search: string | URLSearchParams): string {
  const params = new URLSearchParams(search);
  const section = params.get('section');
  params.delete('section');
  if (
    !isSettingsSection(params.get('tab')) &&
    section !== 'settings' &&
    isSettingsSection(section)
  ) {
    params.set('tab', section);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Whether a `/home` search addresses Settings rather than the Spaces hub. */
export function isLegacyHomeSettingsSearch(
  search: string | URLSearchParams
): boolean {
  const section = new URLSearchParams(search).get('section');
  return section !== null && section !== 'spaces';
}
