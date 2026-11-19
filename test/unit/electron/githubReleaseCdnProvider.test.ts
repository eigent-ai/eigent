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

import type { AppUpdater, UpdateInfo } from 'electron-updater';
import type { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider';
import {
  buildVersionedReleaseBaseUrl,
  getGitHubReleaseChannel,
  getUpdatePlatformDirectory,
  getUpdaterMirrorBaseUrl,
  GitHubReleaseCdnProvider,
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
        '1.0.8',
        'mac-arm64'
      )
    ).toBe('https://cdn.eigent.ai/releases/v1.0.8/mac-arm64/');

    expect(
      buildVersionedReleaseBaseUrl(
        'https://cdn.eigent.ai/releases',
        '1.0.8',
        'win-x64'
      )
    ).toBe('https://cdn.eigent.ai/releases/v1.0.8/win-x64/');
  });

  it('maps mac builds to the GitHub release channels used in CI', () => {
    expect(getGitHubReleaseChannel('darwin', 'arm64')).toBe('latest-arm64');
    expect(getGitHubReleaseChannel('darwin', 'x64')).toBe('latest-x64');
    expect(getGitHubReleaseChannel('win32', 'x64')).toBe('latest');
    expect(getGitHubReleaseChannel('linux', 'x64')).toBe('latest');
  });
});

describe('GitHubReleaseCdnProvider download URLs', () => {
  const updateInfo = {
    version: '2.3.4',
    tag: 'v2.3.4',
    files: [
      {
        url: 'Eigent-2.3.4-arm64-mac.zip',
        sha512: 'zip-sha512',
        size: 100,
      },
      {
        url: 'Eigent-2.3.4-arm64.dmg',
        sha512: 'dmg-sha512',
        size: 200,
      },
    ],
    path: 'Eigent-2.3.4-arm64-mac.zip',
    sha512: 'zip-sha512',
    releaseDate: '2026-01-01T00:00:00.000Z',
  } as UpdateInfo & { tag: string };

  const createProvider = (cdnBaseUrl?: string | null) =>
    new GitHubReleaseCdnProvider(
      {
        owner: 'eigent-ai',
        repo: 'eigent',
        releaseType: 'release',
        channel: 'latest-arm64',
        cdnBaseUrl,
        platformDir: 'mac-arm64',
      },
      {} as AppUpdater,
      {
        platform: 'darwin',
        executor: {},
        isUseMultipleRangeRequest: false,
      } as unknown as ProviderRuntimeOptions
    );

  it('downloads from the GitHub release the metadata came from by default', () => {
    const files = createProvider().resolveFiles(updateInfo);

    expect(files.map((file) => file.url.href)).toEqual([
      'https://github.com/eigent-ai/eigent/releases/download/v2.3.4/Eigent-2.3.4-arm64-mac.zip',
      'https://github.com/eigent-ai/eigent/releases/download/v2.3.4/Eigent-2.3.4-arm64.dmg',
    ]);
    expect(files.map((file) => file.info.sha512)).toEqual([
      'zip-sha512',
      'dmg-sha512',
    ]);
  });

  it('treats a blank mirror as no mirror', () => {
    const files = createProvider('   ').resolveFiles(updateInfo);

    expect(files[0].url.href).toBe(
      'https://github.com/eigent-ai/eigent/releases/download/v2.3.4/Eigent-2.3.4-arm64-mac.zip'
    );
  });

  it('downloads from the versioned mirror path when a mirror is configured', () => {
    const files = createProvider(
      'https://mirror.example.com/oss/'
    ).resolveFiles(updateInfo);

    expect(files[0].url.href).toBe(
      'https://mirror.example.com/oss/v2.3.4/mac-arm64/Eigent-2.3.4-arm64-mac.zip'
    );
  });
});

describe('getUpdaterMirrorBaseUrl', () => {
  it('returns null when no mirror is configured', () => {
    expect(getUpdaterMirrorBaseUrl(undefined)).toBeNull();
    expect(getUpdaterMirrorBaseUrl(null)).toBeNull();
    expect(getUpdaterMirrorBaseUrl('')).toBeNull();
    expect(getUpdaterMirrorBaseUrl('  ')).toBeNull();
  });

  it('trims and normalizes a configured mirror', () => {
    expect(getUpdaterMirrorBaseUrl(' https://mirror.example.com/oss// ')).toBe(
      'https://mirror.example.com/oss'
    );
  });
});
