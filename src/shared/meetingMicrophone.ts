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

/** IPC contract for the microphone permission used by meeting recording. */

export const MEETING_MICROPHONE_STATUS_CHANNEL = 'meetings-microphone-status';
export const MEETING_MICROPHONE_REQUEST_CHANNEL = 'meetings-microphone-request';
export const MEETING_MICROPHONE_SETTINGS_CHANNEL =
  'meetings-microphone-open-settings';

/**
 * The operating system's answer for microphone access. `unknown` means the
 * platform does not report it (Linux); the recorder then asks the browser.
 */
export type MicrophoneAccessStatus =
  'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown';

export const MICROPHONE_ACCESS_STATUSES: readonly MicrophoneAccessStatus[] = [
  'granted',
  'denied',
  'restricted',
  'not-determined',
  'unknown',
];

export function toMicrophoneAccessStatus(
  value: unknown
): MicrophoneAccessStatus {
  return MICROPHONE_ACCESS_STATUSES.includes(value as MicrophoneAccessStatus)
    ? (value as MicrophoneAccessStatus)
    : 'unknown';
}
