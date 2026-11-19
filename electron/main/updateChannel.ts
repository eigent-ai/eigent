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

/**
 * Which builds an install follows. `stable` is every release; `prerelease`
 * also takes builds published for testing before a release. The choice
 * belongs to one install, never to a build: the same binary may be promoted
 * from pre-release to stable, so a channel baked into it would follow it.
 */
export type UpdateChannel = 'stable' | 'prerelease';

export const UPDATE_CHANNEL_FILE_NAME = 'update-channel.json';
export const UPDATE_CHANNEL_ENV = 'EIGENT_UPDATE_CHANNEL';
export const UPDATE_CHECK_INTERVAL_ENV = 'EIGENT_UPDATE_CHECK_INTERVAL_MINUTES';

function parseUpdateChannel(value: unknown): UpdateChannel | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'stable' || normalized === 'latest') return 'stable';
  if (
    normalized === 'prerelease' ||
    normalized === 'pre-release' ||
    normalized === 'pre'
  ) {
    return 'prerelease';
  }
  return null;
}

/**
 * Reads the install's update channel: the environment variable wins, then
 * `<userData>/update-channel.json` (`{ "channel": "prerelease" }`). Anything
 * missing or unreadable means `stable`.
 */
export function readUpdateChannel({
  env = process.env,
  userDataPath,
  readFile = (filePath: string) => fs.readFileSync(filePath, 'utf8'),
}: {
  env?: Record<string, string | undefined>;
  userDataPath: string;
  readFile?: (filePath: string) => string;
}): UpdateChannel {
  const fromEnv = parseUpdateChannel(env[UPDATE_CHANNEL_ENV]);
  if (fromEnv) return fromEnv;

  try {
    const raw = readFile(path.join(userDataPath, UPDATE_CHANNEL_FILE_NAME));
    const parsed = JSON.parse(raw) as { channel?: unknown } | null;
    return parseUpdateChannel(parsed?.channel) ?? 'stable';
  } catch {
    return 'stable';
  }
}

/**
 * Picks the feed for a channel. A build without a pre-release feed keeps its
 * pre-release installs on the stable feed rather than failing every check.
 */
export function selectUpdateFeedBaseUrl({
  channel,
  stableBaseUrl,
  prereleaseBaseUrl,
}: {
  channel: UpdateChannel;
  stableBaseUrl: string;
  prereleaseBaseUrl?: string | null;
}): string {
  const prerelease = prereleaseBaseUrl?.trim();
  if (channel === 'prerelease' && prerelease) return prerelease;
  return stableBaseUrl;
}

export interface UpdateCheckConfig {
  /** Overrides the background check interval, for testing an install. */
  intervalMinutes: number | null;
}

/** Reads `EIGENT_UPDATE_CHECK_INTERVAL_MINUTES` (whole minutes, at least 1). */
export function readUpdateCheckConfig(
  env: Record<string, string | undefined> = process.env
): UpdateCheckConfig {
  const raw = env[UPDATE_CHECK_INTERVAL_ENV]?.trim();
  if (!raw || !/^\d+$/.test(raw)) return { intervalMinutes: null };
  const minutes = Number(raw);
  return {
    intervalMinutes:
      Number.isSafeInteger(minutes) && minutes >= 1 ? minutes : null,
  };
}
