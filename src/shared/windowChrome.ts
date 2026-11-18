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

export const WINDOW_CHROME_THEME_CHANNEL = 'window-chrome:set-theme';

export type WindowChromeTheme = 'light' | 'dark';

export const WINDOW_CHROME_HEIGHT = 40;

export function isWindowChromeTheme(
  value: unknown
): value is WindowChromeTheme {
  return value === 'light' || value === 'dark';
}

/**
 * The caption-button overlay leaves Windows without its native menu bar, so
 * the header offers the same application menu (File, Edit, View, ...) from a
 * button instead.
 */
export const WINDOW_APP_MENU_CHANNEL = 'window-chrome:open-app-menu';

/** Where the menu opens, in CSS pixels from the window's top-left corner. */
export interface WindowAppMenuAnchor {
  x: number;
  y: number;
}

const MAX_APP_MENU_ANCHOR_PX = 100_000;

export function isWindowAppMenuAnchor(
  value: unknown
): value is WindowAppMenuAnchor {
  if (typeof value !== 'object' || value === null) return false;
  const { x, y } = value as Record<string, unknown>;
  return [x, y].every(
    (n) =>
      typeof n === 'number' &&
      Number.isFinite(n) &&
      n >= 0 &&
      n <= MAX_APP_MENU_ANCHOR_PX
  );
}

/** Only Windows hides its menu bar under the overlay; macOS keeps the global menu. */
export function hasWindowAppMenuButton(platform: string): boolean {
  return platform === 'win32';
}

export function getWindowsTitleBarOverlay(theme: WindowChromeTheme) {
  return {
    // This exception is registered as `window-controls`: Windows owns the
    // caption-button rendering while the app header supplies the surface.
    color: '#00000000', // ds:allow-hardcoded-color -- native overlay API
    symbolColor: theme === 'dark' ? '#ffffff' : '#1e1e1e', // ds:allow-hardcoded-color -- native OS symbols
    height: WINDOW_CHROME_HEIGHT,
  };
}
