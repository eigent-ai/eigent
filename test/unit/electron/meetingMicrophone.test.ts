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

import { describe, expect, it, vi } from 'vitest';
import {
  getMicrophoneAccess,
  MICROPHONE_SETTINGS_URLS,
  openMicrophoneSettings,
  registerMeetingMicrophoneHandlers,
  requestMicrophoneAccess,
} from '../../../electron/main/meetingMicrophone';
import {
  MEETING_MICROPHONE_REQUEST_CHANNEL,
  MEETING_MICROPHONE_SETTINGS_CHANNEL,
  MEETING_MICROPHONE_STATUS_CHANNEL,
} from '../../../src/shared/meetingMicrophone';

describe('getMicrophoneAccess', () => {
  it('reads the OS status on macOS and Windows', () => {
    const preferences = { getMediaAccessStatus: vi.fn(() => 'denied') };

    expect(getMicrophoneAccess('darwin', preferences)).toBe('denied');
    expect(getMicrophoneAccess('win32', preferences)).toBe('denied');
    expect(preferences.getMediaAccessStatus).toHaveBeenCalledWith('microphone');
  });

  it('answers unknown where the OS does not report it', () => {
    const preferences = { getMediaAccessStatus: vi.fn(() => 'granted') };

    expect(getMicrophoneAccess('linux', preferences)).toBe('unknown');
    expect(preferences.getMediaAccessStatus).not.toHaveBeenCalled();
  });

  it('answers unknown for unexpected values or errors', () => {
    expect(
      getMicrophoneAccess('darwin', { getMediaAccessStatus: () => 'weird' })
    ).toBe('unknown');
    expect(
      getMicrophoneAccess('darwin', {
        getMediaAccessStatus: () => {
          throw new Error('no TCC');
        },
      })
    ).toBe('unknown');
  });
});

describe('requestMicrophoneAccess', () => {
  it('shows the macOS prompt only when the person has not answered', async () => {
    const askForMediaAccess = vi.fn(async () => true);

    await expect(
      requestMicrophoneAccess('darwin', {
        getMediaAccessStatus: () => 'not-determined',
        askForMediaAccess,
      })
    ).resolves.toBe('granted');
    expect(askForMediaAccess).toHaveBeenCalledWith('microphone');
  });

  it('returns a refused prompt as denied', async () => {
    await expect(
      requestMicrophoneAccess('darwin', {
        getMediaAccessStatus: () => 'not-determined',
        askForMediaAccess: async () => false,
      })
    ).resolves.toBe('denied');
  });

  it('does not ask again after a denial', async () => {
    const askForMediaAccess = vi.fn(async () => true);

    await expect(
      requestMicrophoneAccess('darwin', {
        getMediaAccessStatus: () => 'denied',
        askForMediaAccess,
      })
    ).resolves.toBe('denied');
    expect(askForMediaAccess).not.toHaveBeenCalled();
  });

  it('reports the status on Windows without prompting', async () => {
    const askForMediaAccess = vi.fn(async () => true);

    await expect(
      requestMicrophoneAccess('win32', {
        getMediaAccessStatus: () => 'not-determined',
        askForMediaAccess,
      })
    ).resolves.toBe('not-determined');
    expect(askForMediaAccess).not.toHaveBeenCalled();
  });
});

describe('openMicrophoneSettings', () => {
  it('opens only the fixed privacy pane for the platform', async () => {
    const openExternal = vi.fn(async () => undefined);

    await expect(openMicrophoneSettings('darwin', openExternal)).resolves.toBe(
      true
    );
    expect(openExternal).toHaveBeenCalledWith(MICROPHONE_SETTINGS_URLS.darwin);
    await expect(openMicrophoneSettings('linux', openExternal)).resolves.toBe(
      false
    );
    expect(openExternal).toHaveBeenCalledTimes(1);
  });

  it('returns false when the pane cannot open', async () => {
    await expect(
      openMicrophoneSettings('win32', async () => {
        throw new Error('blocked');
      })
    ).resolves.toBe(false);
  });
});

describe('registerMeetingMicrophoneHandlers', () => {
  it('registers the three channels', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    registerMeetingMicrophoneHandlers(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      {
        platform: 'darwin',
        preferences: { getMediaAccessStatus: () => 'granted' },
        openExternal: async () => undefined,
      }
    );

    expect([...handlers.keys()].sort()).toEqual(
      [
        MEETING_MICROPHONE_REQUEST_CHANNEL,
        MEETING_MICROPHONE_SETTINGS_CHANNEL,
        MEETING_MICROPHONE_STATUS_CHANNEL,
      ].sort()
    );
    expect(await handlers.get(MEETING_MICROPHONE_STATUS_CHANNEL)?.()).toBe(
      'granted'
    );
  });
});
