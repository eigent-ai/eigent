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

import type {
  AppUpdater,
  ResolvedUpdateFileInfo,
  UpdateInfo,
} from 'electron-updater';
import type { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const { GitHubProvider } =
  require('electron-updater/out/providers/GitHubProvider') as {
    GitHubProvider: new (
      options: GitHubProviderOptions,
      updater: AppUpdater,
      runtimeOptions: ProviderRuntimeOptions
    ) => object;
  };

const { resolveFiles } = require('electron-updater/out/providers/Provider') as {
  resolveFiles: (
    updateInfo: UpdateInfo,
    baseUrl: URL,
    pathTransformer?: (path: string) => string
  ) => Array<ResolvedUpdateFileInfo>;
};

export const DEFAULT_CDN_RELEASE_BASE_URL = 'https://cdn.eigent.ai/releases';

export type UpdatePlatformDirectory =
  | 'mac-arm64'
  | 'mac-intel'
  | 'win-x64'
  | 'linux-x64';

type GitHubProviderOptions = {
  provider: 'github';
  owner: string;
  repo: string;
  releaseType?: 'draft' | 'prerelease' | 'release' | null;
  channel?: string | null;
  host?: string | null;
  protocol?: 'https' | 'http' | null;
  token?: string | null;
  private?: boolean | null;
  tagNamePrefix?: string;
  vPrefixedTagName?: boolean;
};

export type GitHubReleaseCdnOptions = {
  owner: string;
  repo: string;
  releaseType?: 'draft' | 'prerelease' | 'release' | null;
  channel?: string | null;
  host?: string | null;
  protocol?: 'https' | 'http' | null;
  token?: string | null;
  private?: boolean | null;
  tagNamePrefix?: string;
  vPrefixedTagName?: boolean;
  cdnBaseUrl: string;
  platformDir: UpdatePlatformDirectory;
};

export function normalizeCdnReleaseBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export function getUpdatePlatformDirectory(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture
): UpdatePlatformDirectory | null {
  switch (platform) {
    case 'darwin':
      if (arch === 'arm64') {
        return 'mac-arm64';
      }
      if (arch === 'x64') {
        return 'mac-intel';
      }
      return null;
    case 'win32':
      return arch === 'x64' ? 'win-x64' : null;
    case 'linux':
      return arch === 'x64' ? 'linux-x64' : null;
    default:
      return null;
  }
}

export function getGitHubReleaseChannel(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture
): string {
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'latest-arm64' : 'latest-x64';
  }

  return 'latest';
}

export function buildVersionedReleaseBaseUrl(
  cdnBaseUrl: string,
  version: string,
  platformDir: UpdatePlatformDirectory
): string {
  return `${normalizeCdnReleaseBaseUrl(cdnBaseUrl)}/v${version}/${platformDir}/`;
}

export class GitHubReleaseCdnProvider extends GitHubProvider {
  private readonly cdnBaseUrl: string;
  private readonly platformDir: UpdatePlatformDirectory;

  constructor(
    options: GitHubReleaseCdnOptions,
    updater: AppUpdater,
    runtimeOptions: ProviderRuntimeOptions
  ) {
    const githubOptions: GitHubProviderOptions = {
      provider: 'github',
      owner: options.owner,
      repo: options.repo,
      releaseType: options.releaseType,
      channel: options.channel,
      host: options.host,
      protocol: options.protocol,
      token: options.token,
      private: options.private,
      tagNamePrefix: options.tagNamePrefix,
      vPrefixedTagName: options.vPrefixedTagName,
    };

    super(githubOptions, updater, runtimeOptions);

    this.cdnBaseUrl = normalizeCdnReleaseBaseUrl(options.cdnBaseUrl);
    this.platformDir = options.platformDir;
  }

  resolveFiles(updateInfo: UpdateInfo): Array<ResolvedUpdateFileInfo> {
    const versionedBaseUrl = new URL(
      buildVersionedReleaseBaseUrl(
        this.cdnBaseUrl,
        updateInfo.version,
        this.platformDir
      )
    );

    return resolveFiles(updateInfo, versionedBaseUrl, (filePath: string) =>
      filePath.replace(/ /g, '-')
    );
  }
}
