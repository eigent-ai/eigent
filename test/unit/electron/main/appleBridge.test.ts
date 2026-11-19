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

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  APPLE_INTELLIGENCE_SETTINGS_URL,
  resolveAppleBridgePath,
  type AppleBridgeLocation,
} from '../../../../electron/main/utils/appleBridge';

function location(
  overrides: Partial<AppleBridgeLocation> = {}
): AppleBridgeLocation {
  return {
    platform: 'darwin',
    arch: 'arm64',
    isPackaged: true,
    resourcesPath: '/Applications/Eigent.app/Contents/Resources',
    appPath: '/src/eigent',
    exists: () => true,
    ...overrides,
  };
}

describe('resolveAppleBridgePath', () => {
  it('uses the packaged binary on Apple silicon Macs', () => {
    expect(resolveAppleBridgePath(location())).toBe(
      path.join(
        '/Applications/Eigent.app/Contents/Resources',
        'prebuilt',
        'apple-bridge',
        'eigent-apple-bridge'
      )
    );
  });

  it('uses the locally built binary in development', () => {
    expect(resolveAppleBridgePath(location({ isPackaged: false }))).toBe(
      path.join(
        '/src/eigent',
        'resources',
        'prebuilt',
        'apple-bridge',
        'eigent-apple-bridge'
      )
    );
  });

  it.each([
    ['Windows', { platform: 'win32' as const, arch: 'x64' }],
    ['Windows on Arm', { platform: 'win32' as const, arch: 'arm64' }],
    ['Linux', { platform: 'linux' as const, arch: 'x64' }],
    ['Linux on Arm', { platform: 'linux' as const, arch: 'arm64' }],
    ['Intel Macs', { platform: 'darwin' as const, arch: 'x64' }],
  ])('is never offered on %s', (_name, overrides) => {
    const exists = vi.fn(() => true);
    expect(resolveAppleBridgePath(location({ ...overrides, exists }))).toBe(
      null
    );
    expect(exists).not.toHaveBeenCalled();
  });

  it('is absent when the build has no bridge', () => {
    expect(resolveAppleBridgePath(location({ exists: () => false }))).toBe(
      null
    );
  });
});

describe('Brain process wiring', () => {
  it('passes the bridge path to the backend', () => {
    const startup = fs.readFileSync(
      path.resolve(process.cwd(), 'electron/main/init.ts'),
      'utf-8'
    );
    expect(startup).toContain('getBundledAppleBridgePath()');
    expect(startup).toContain('EIGENT_APPLE_BRIDGE: appleBridgePath');
  });

  it('opens only the Apple Intelligence settings pane, only on macOS', () => {
    const main = fs.readFileSync(
      path.resolve(process.cwd(), 'electron/main/index.ts'),
      'utf-8'
    );
    expect(APPLE_INTELLIGENCE_SETTINGS_URL).toBe(
      'x-apple.systempreferences:com.apple.Siri-Settings.extension'
    );
    const handler = main.slice(
      main.indexOf("'open-apple-intelligence-settings'"),
      main.indexOf("'upload-log'")
    );
    expect(handler).toContain("process.platform !== 'darwin'");
    expect(handler).toContain(
      'shell.openExternal(APPLE_INTELLIGENCE_SETTINGS_URL)'
    );
  });
});
