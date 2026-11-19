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
  toMicrophoneAccessStatus,
  type MicrophoneAccessStatus,
} from '@/shared/meetingMicrophone';

/** Why the microphone could not be opened. Every case is shown, never thrown. */
export type MicrophoneProblem =
  'denied' | 'no-device' | 'busy' | 'unsupported' | 'unknown';

/** The desktop host's microphone permission calls, when there is one. */
export interface MicrophoneHost {
  getMicrophoneAccess?: () => Promise<MicrophoneAccessStatus>;
  requestMicrophoneAccess?: () => Promise<MicrophoneAccessStatus>;
  openMicrophoneSettings?: () => Promise<boolean>;
}

type MediaDevicesLike = Pick<MediaDevices, 'getUserMedia'>;

export type AcquireMicrophoneResult =
  { ok: true; stream: MediaStream } | { ok: false; problem: MicrophoneProblem };

/** Map a `getUserMedia` failure to something the UI can explain. */
export function classifyMicrophoneError(error: unknown): MicrophoneProblem {
  const name = (error as { name?: unknown } | null)?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'no-device';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'busy';
    default:
      return 'unknown';
  }
}

/** Ask the OS for access (macOS shows its prompt once), read the status. */
export async function requestMicrophonePermission(
  host: MicrophoneHost | null | undefined
): Promise<MicrophoneAccessStatus> {
  try {
    if (host?.requestMicrophoneAccess) {
      return toMicrophoneAccessStatus(await host.requestMicrophoneAccess());
    }
    if (host?.getMicrophoneAccess) {
      return toMicrophoneAccessStatus(await host.getMicrophoneAccess());
    }
  } catch {
    // The browser prompt below still decides.
  }
  return 'unknown';
}

/**
 * Open the microphone for a recording. The OS permission is asked first, so
 * a denied permission ends here with `denied` instead of a failed stream.
 */
export async function acquireMicrophone(
  host: MicrophoneHost | null | undefined,
  mediaDevices: MediaDevicesLike | undefined = globalThis.navigator
    ?.mediaDevices
): Promise<AcquireMicrophoneResult> {
  const status = await requestMicrophonePermission(host);
  if (status === 'denied' || status === 'restricted') {
    return { ok: false, problem: 'denied' };
  }
  if (!mediaDevices?.getUserMedia) {
    return { ok: false, problem: 'unsupported' };
  }
  try {
    const stream = await mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
    return { ok: true, stream };
  } catch (error) {
    return { ok: false, problem: classifyMicrophoneError(error) };
  }
}

const RECORDING_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
] as const;

/** The first container this recorder supports, or '' for its default. */
export function pickRecordingMimeType(
  isTypeSupported:
    ((mimeType: string) => boolean) | undefined = typeof globalThis
    .MediaRecorder?.isTypeSupported === 'function'
    ? (mimeType) => globalThis.MediaRecorder.isTypeSupported(mimeType)
    : undefined
): string {
  if (!isTypeSupported) return '';
  return RECORDING_MIME_TYPES.find((type) => isTypeSupported(type)) ?? '';
}

/** File extension the backend accepts for a recorder's container. */
export function recordingExtension(mimeType: string): string {
  if (mimeType.startsWith('audio/mp4')) return 'm4a';
  if (mimeType.startsWith('audio/ogg')) return 'ogg';
  return 'webm';
}
