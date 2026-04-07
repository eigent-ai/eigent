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
  buildVersionedReleaseBaseUrl,
  getGitHubReleaseChannel,
  getUpdatePlatformDirectory,
  normalizeCdnReleaseBaseUrl,
} from '../../../electron/main/githubReleaseCdnProvider';

describe('githubReleaseCdnProvider', () => {
  it('maps supported platforms to the expected release directories', () => {
    expect(getUpdatePlatformDirectory('darwin', 'arm64')).toBe('mac-arm64');
    expect(getUpdatePlatformDirectory('darwin', 'x64')).toBe('mac-intel');
    expect(getUpdatePlatformDirectory('win32', 'x64')).toBe('win-x64');
    expect(getUpdatePlatformDirectory('linux', 'x64')).toBe('linux-x64');
  });

  it('returns null for unsupported platform and architecture combinations', () => {
    expect(getUpdatePlatformDirectory('darwin', 'ia32')).toBeNull();
    expect(getUpdatePlatformDirectory('win32', 'arm64')).toBeNull();
    expect(getUpdatePlatformDirectory('linux', 'arm64')).toBeNull();
    expect(getUpdatePlatformDirectory('freebsd', 'x64')).toBeNull();
  });

  it('normalizes the CDN base URL before building versioned release paths', () => {
    expect(
      normalizeCdnReleaseBaseUrl('https://cdn.eigent.ai/releases///')
    ).toBe('https://cdn.eigent.ai/releases');
  });

  it('builds versioned CDN URLs for updater downloads', () => {
    expect(
      buildVersionedReleaseBaseUrl(
        'https://cdn.eigent.ai/releases/',
        '0.0.90',
        'mac-arm64'
      )
    ).toBe('https://cdn.eigent.ai/releases/v0.0.90/mac-arm64/');

    expect(
      buildVersionedReleaseBaseUrl(
        'https://cdn.eigent.ai/releases',
        '0.0.90',
        'win-x64'
      )
    ).toBe('https://cdn.eigent.ai/releases/v0.0.90/win-x64/');
  });

  it('maps mac builds to the GitHub release channels used in CI', () => {
    expect(getGitHubReleaseChannel('darwin', 'arm64')).toBe('latest-arm64');
    expect(getGitHubReleaseChannel('darwin', 'x64')).toBe('latest-x64');
    expect(getGitHubReleaseChannel('win32', 'x64')).toBe('latest');
    expect(getGitHubReleaseChannel('linux', 'x64')).toBe('latest');
  });
});
