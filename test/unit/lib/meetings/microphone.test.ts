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
  acquireMicrophone,
  classifyMicrophoneError,
  pickRecordingMimeType,
  recordingExtension,
  requestMicrophonePermission,
} from '@/lib/meetings/microphone';
import { describe, expect, it, vi } from 'vitest';

const domError = (name: string) => Object.assign(new Error(name), { name });
const fakeStream = { id: 'stream' } as unknown as MediaStream;

describe('classifyMicrophoneError', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'no-device'],
    ['OverconstrainedError', 'no-device'],
    ['NotReadableError', 'busy'],
    ['AbortError', 'busy'],
    ['SomethingElse', 'unknown'],
  ])('maps %s to %s', (name, expected) => {
    expect(classifyMicrophoneError(domError(name))).toBe(expected);
  });

  it('handles values that are not errors', () => {
    expect(classifyMicrophoneError(null)).toBe('unknown');
    expect(classifyMicrophoneError('nope')).toBe('unknown');
  });
});

describe('acquireMicrophone', () => {
  it('asks the OS first and stops at a denied permission', async () => {
    const getUserMedia = vi.fn();
    const host = {
      requestMicrophoneAccess: vi.fn(async () => 'denied' as const),
    };

    const result = await acquireMicrophone(host, { getUserMedia });

    expect(result).toEqual({ ok: false, problem: 'denied' });
    expect(host.requestMicrophoneAccess).toHaveBeenCalledOnce();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('treats a restricted permission as denied', async () => {
    const result = await acquireMicrophone(
      { requestMicrophoneAccess: async () => 'restricted' },
      { getUserMedia: vi.fn() }
    );
    expect(result).toEqual({ ok: false, problem: 'denied' });
  });

  it('opens the microphone once access is granted', async () => {
    const getUserMedia = vi.fn(async () => fakeStream);

    const result = await acquireMicrophone(
      { requestMicrophoneAccess: async () => 'granted' },
      { getUserMedia }
    );

    expect(result).toEqual({ ok: true, stream: fakeStream });
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
  });

  it('returns a denied browser prompt instead of throwing', async () => {
    const getUserMedia = vi.fn(async () => {
      throw domError('NotAllowedError');
    });

    await expect(acquireMicrophone(null, { getUserMedia })).resolves.toEqual({
      ok: false,
      problem: 'denied',
    });
  });

  it('reports a missing microphone', async () => {
    const getUserMedia = vi.fn(async () => {
      throw domError('NotFoundError');
    });

    await expect(
      acquireMicrophone(
        { getMicrophoneAccess: async () => 'unknown' },
        { getUserMedia }
      )
    ).resolves.toEqual({ ok: false, problem: 'no-device' });
  });

  it('reports when the platform has no media devices', async () => {
    await expect(acquireMicrophone(null, undefined)).resolves.toEqual({
      ok: false,
      problem: 'unsupported',
    });
  });

  it('lets the browser decide when the host permission call fails', async () => {
    const getUserMedia = vi.fn(async () => fakeStream);
    const host = {
      requestMicrophoneAccess: vi.fn(async () => {
        throw new Error('ipc gone');
      }),
    };

    await expect(requestMicrophonePermission(host)).resolves.toBe('unknown');
    await expect(acquireMicrophone(host, { getUserMedia })).resolves.toEqual({
      ok: true,
      stream: fakeStream,
    });
  });
});

describe('recording format', () => {
  it('picks the first supported container', () => {
    expect(pickRecordingMimeType((type) => type === 'audio/mp4')).toBe(
      'audio/mp4'
    );
    expect(pickRecordingMimeType(() => true)).toBe('audio/webm;codecs=opus');
    expect(pickRecordingMimeType(() => false)).toBe('');
    expect(pickRecordingMimeType(undefined)).toBe('');
  });

  it('names the file by container', () => {
    expect(recordingExtension('audio/webm;codecs=opus')).toBe('webm');
    expect(recordingExtension('audio/mp4')).toBe('m4a');
    expect(recordingExtension('audio/ogg;codecs=opus')).toBe('ogg');
  });
});
