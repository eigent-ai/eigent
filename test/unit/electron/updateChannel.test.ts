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

import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  readUpdateChannel,
  readUpdateCheckConfig,
  selectUpdateFeedBaseUrl,
  UPDATE_CHANNEL_FILE_NAME,
} from '../../../electron/main/updateChannel';

describe('updateChannel', () => {
  const userDataPath = '/tmp/eigent-user-data';

  it('defaults to stable when nothing is set', () => {
    const readFile = vi.fn(() => {
      throw new Error('ENOENT');
    });
    expect(readUpdateChannel({ env: {}, userDataPath, readFile })).toBe(
      'stable'
    );
    expect(readFile).toHaveBeenCalledWith(
      path.join(userDataPath, UPDATE_CHANNEL_FILE_NAME)
    );
  });

  it('reads the per-install channel file', () => {
    expect(
      readUpdateChannel({
        env: {},
        userDataPath,
        readFile: () => '{ "channel": "prerelease" }',
      })
    ).toBe('prerelease');
  });

  it('lets the environment override the file', () => {
    expect(
      readUpdateChannel({
        env: { EIGENT_UPDATE_CHANNEL: 'stable' },
        userDataPath,
        readFile: () => '{ "channel": "prerelease" }',
      })
    ).toBe('stable');
    expect(
      readUpdateChannel({
        env: { EIGENT_UPDATE_CHANNEL: ' Pre-Release ' },
        userDataPath,
        readFile: () => '{}',
      })
    ).toBe('prerelease');
  });

  it('falls back to stable for unknown or malformed values', () => {
    expect(
      readUpdateChannel({
        env: { EIGENT_UPDATE_CHANNEL: 'nightly' },
        userDataPath,
        readFile: () => 'not json',
      })
    ).toBe('stable');
    expect(
      readUpdateChannel({
        env: {},
        userDataPath,
        readFile: () => '{ "channel": 1 }',
      })
    ).toBe('stable');
    expect(
      readUpdateChannel({ env: {}, userDataPath, readFile: () => 'null' })
    ).toBe('stable');
  });

  it('uses the pre-release feed only when the build has one', () => {
    const stableBaseUrl = 'https://cdn.example.com/releases';
    const prereleaseBaseUrl = 'https://cdn.example.com/pre-releases';

    expect(
      selectUpdateFeedBaseUrl({
        channel: 'prerelease',
        stableBaseUrl,
        prereleaseBaseUrl,
      })
    ).toBe(prereleaseBaseUrl);
    expect(
      selectUpdateFeedBaseUrl({
        channel: 'stable',
        stableBaseUrl,
        prereleaseBaseUrl,
      })
    ).toBe(stableBaseUrl);
    expect(
      selectUpdateFeedBaseUrl({
        channel: 'prerelease',
        stableBaseUrl,
        prereleaseBaseUrl: '  ',
      })
    ).toBe(stableBaseUrl);
    expect(
      selectUpdateFeedBaseUrl({ channel: 'prerelease', stableBaseUrl })
    ).toBe(stableBaseUrl);
  });

  it('reads a whole-minute check interval override', () => {
    expect(readUpdateCheckConfig({})).toEqual({ intervalMinutes: null });
    expect(
      readUpdateCheckConfig({ EIGENT_UPDATE_CHECK_INTERVAL_MINUTES: '2' })
    ).toEqual({ intervalMinutes: 2 });
    for (const value of ['0', '-5', '1.5', 'soon', '']) {
      expect(
        readUpdateCheckConfig({ EIGENT_UPDATE_CHECK_INTERVAL_MINUTES: value })
      ).toEqual({ intervalMinutes: null });
    }
  });
});
