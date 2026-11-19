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
  MEETING_MICROPHONE_REQUEST_CHANNEL,
  MEETING_MICROPHONE_SETTINGS_CHANNEL,
  MEETING_MICROPHONE_STATUS_CHANNEL,
  toMicrophoneAccessStatus,
  type MicrophoneAccessStatus,
} from '../../src/shared/meetingMicrophone';

/** The parts of Electron's `systemPreferences` this module uses. */
export interface MicrophonePreferences {
  getMediaAccessStatus?: (mediaType: 'microphone') => string;
  askForMediaAccess?: (mediaType: 'microphone') => Promise<boolean>;
}

interface IpcMainLike {
  handle: (channel: string, listener: (...args: unknown[]) => unknown) => void;
}

/**
 * The privacy pane for the microphone. Only these fixed URLs are opened;
 * nothing from the renderer is passed to `openExternal`.
 */
export const MICROPHONE_SETTINGS_URLS: Partial<
  Record<NodeJS.Platform, string>
> = {
  darwin:
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  win32: 'ms-settings:privacy-microphone',
};

/** macOS and Windows report access; other platforms answer `unknown`. */
export function getMicrophoneAccess(
  platform: NodeJS.Platform,
  preferences: MicrophonePreferences
): MicrophoneAccessStatus {
  if (platform !== 'darwin' && platform !== 'win32') return 'unknown';
  try {
    return toMicrophoneAccessStatus(
      preferences.getMediaAccessStatus?.('microphone')
    );
  } catch {
    return 'unknown';
  }
}

/**
 * Ask for microphone access. On macOS this shows the system prompt the first
 * time, using `NSMicrophoneUsageDescription`; later calls return the stored
 * answer. Other platforms cannot prompt here, so they report the status.
 */
export async function requestMicrophoneAccess(
  platform: NodeJS.Platform,
  preferences: MicrophonePreferences
): Promise<MicrophoneAccessStatus> {
  const status = getMicrophoneAccess(platform, preferences);
  if (
    platform !== 'darwin' ||
    status !== 'not-determined' ||
    !preferences.askForMediaAccess
  ) {
    return status;
  }
  try {
    const granted = await preferences.askForMediaAccess('microphone');
    return granted ? 'granted' : 'denied';
  } catch {
    return getMicrophoneAccess(platform, preferences);
  }
}

export async function openMicrophoneSettings(
  platform: NodeJS.Platform,
  openExternal: (url: string) => Promise<void>
): Promise<boolean> {
  const url = MICROPHONE_SETTINGS_URLS[platform];
  if (!url) return false;
  try {
    await openExternal(url);
    return true;
  } catch {
    return false;
  }
}

export function registerMeetingMicrophoneHandlers(
  ipcMain: IpcMainLike,
  {
    platform,
    preferences,
    openExternal,
  }: {
    platform: NodeJS.Platform;
    preferences: MicrophonePreferences;
    openExternal: (url: string) => Promise<void>;
  }
): void {
  ipcMain.handle(MEETING_MICROPHONE_STATUS_CHANNEL, () =>
    getMicrophoneAccess(platform, preferences)
  );
  ipcMain.handle(MEETING_MICROPHONE_REQUEST_CHANNEL, () =>
    requestMicrophoneAccess(platform, preferences)
  );
  ipcMain.handle(MEETING_MICROPHONE_SETTINGS_CHANNEL, () =>
    openMicrophoneSettings(platform, openExternal)
  );
}
