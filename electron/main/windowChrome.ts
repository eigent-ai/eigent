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

import type { BrowserWindowConstructorOptions } from 'electron';
import {
  getWindowsTitleBarOverlay,
  type WindowChromeTheme,
} from '../../src/shared/windowChrome';

// `window-controls` exception: BrowserWindow requires concrete native colors;
// renderer CSS variables are unavailable in the Electron main process.
const NATIVE_DARK_BACKGROUND = '#1e1e1e'; // ds:allow-hardcoded-color -- native window API
const NATIVE_LIGHT_BACKGROUND = '#ffffff'; // ds:allow-hardcoded-color -- native window API
const NATIVE_MAC_LIGHT_BACKGROUND = '#f5f5f5'; // ds:allow-hardcoded-color -- native window API
const NATIVE_LINUX_BACKGROUND = '#f5f5f580'; // ds:allow-hardcoded-color -- native window API

type MainWindowChromeOptions = Pick<
  BrowserWindowConstructorOptions,
  | 'autoHideMenuBar'
  | 'backgroundColor'
  | 'frame'
  | 'roundedCorners'
  | 'titleBarOverlay'
  | 'titleBarStyle'
  | 'trafficLightPosition'
  | 'transparent'
>;

export function getMainWindowChromeOptions(
  platform: NodeJS.Platform,
  theme: WindowChromeTheme
): MainWindowChromeOptions {
  const isMac = platform === 'darwin';
  const isWindows = platform === 'win32';

  return {
    // Keep the native Windows frame for system resizing and snap behavior.
    frame: isWindows,
    // Transparency causes rendering and resize issues on Windows.
    transparent: !isWindows,
    backgroundColor: isWindows
      ? theme === 'dark'
        ? NATIVE_DARK_BACKGROUND
        : NATIVE_LIGHT_BACKGROUND
      : isMac
        ? theme === 'dark'
          ? NATIVE_DARK_BACKGROUND
          : NATIVE_MAC_LIGHT_BACKGROUND
        : NATIVE_LINUX_BACKGROUND,
    // Windows retains its native caption buttons inside the app-owned header.
    titleBarStyle: isMac || isWindows ? 'hidden' : undefined,
    titleBarOverlay: isWindows ? getWindowsTitleBarOverlay(theme) : undefined,
    trafficLightPosition: isMac ? { x: 10, y: 12 } : undefined,
    roundedCorners: !isWindows,
    ...(!isMac && { autoHideMenuBar: true }),
  };
}
