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

import path from 'path';

export const APPLE_BRIDGE_BINARY = 'eigent-apple-bridge';

/** System Settings pane for Apple Intelligence & Siri. */
export const APPLE_INTELLIGENCE_SETTINGS_URL =
  'x-apple.systempreferences:com.apple.Siri-Settings.extension';

export type AppleBridgeLocation = {
  platform: NodeJS.Platform;
  arch: string;
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
  exists: (candidate: string) => boolean;
};

/**
 * The Apple Intelligence bridge binary, or null where it cannot run.
 *
 * Apple Intelligence needs Apple silicon, so the bridge ships only in the
 * arm64 macOS package. Development builds use the copy that
 * `npm run build:apple-bridge` leaves in resources/prebuilt.
 */
export function resolveAppleBridgePath(
  location: AppleBridgeLocation
): string | null {
  if (location.platform !== 'darwin' || location.arch !== 'arm64') {
    return null;
  }
  const base = location.isPackaged
    ? path.join(location.resourcesPath, 'prebuilt')
    : path.join(location.appPath, 'resources', 'prebuilt');
  const candidate = path.join(base, 'apple-bridge', APPLE_BRIDGE_BINARY);
  return location.exists(candidate) ? candidate : null;
}
