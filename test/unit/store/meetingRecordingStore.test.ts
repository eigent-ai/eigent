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

import type { Meeting } from '@/service/meetingsApi';
import {
  createMeetingRecordingStore,
  isRecordingActive,
  recordingElapsedMs,
  type MeetingRecorderDeps,
  type RecorderLike,
} from '@/store/meetingRecordingStore';
import { describe, expect, it, vi } from 'vitest';

class FakeRecorder implements RecorderLike {
  state: RecorderLike['state'] = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable: RecorderLike['ondataavailable'] = null;
  onstop: RecorderLike['onstop'] = null;
  start = vi.fn(() => {
    this.state = 'recording';
  });
  pause = vi.fn(() => {
    this.state = 'paused';
  });
  resume = vi.fn(() => {
    this.state = 'recording';
  });
  stop = vi.fn(() => {
    this.ondataavailable?.({ data: new Blob(['audio-bytes']) });
    this.state = 'inactive';
    this.onstop?.();
  });
}

class FakeTrack extends EventTarget {
  stop = vi.fn();
}

function fakeStream() {
  const track = new FakeTrack();
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  return { stream, track };
}

const meeting = (overrides: Partial<Meeting> = {}): Meeting => ({
  id: 'meeting_1',
  title: 'Weekly sync',
  status: 'recording',
  source: 'microphone',
  started_at: 1,
  ended_at: null,
  duration_ms: 0,
  recording_file: null,
  recording_bytes: 0,
  recording_kept: false,
  note_markdown: '',
  note_edited: false,
  typed_notes: [],
  spaces: [],
  ...overrides,
});

function setup(overrides: Partial<MeetingRecorderDeps> = {}) {
  let now = 10_000;
  const recorder = new FakeRecorder();
  const { stream, track } = fakeStream();
  const deps: MeetingRecorderDeps = {
    acquireMicrophone: vi.fn(async () => ({ ok: true as const, stream })),
    createRecorder: vi.fn(() => recorder),
    pickMimeType: () => 'audio/webm;codecs=opus',
    createMeeting: vi.fn(async (title: string) => meeting({ title })),
    updateMeeting: vi.fn(async () => meeting({ status: 'ready' })),
    uploadRecording: vi.fn(async () => meeting({ recording_kept: true })),
    now: () => now,
    ...overrides,
  };
  const store = createMeetingRecordingStore(deps);
  return {
    store,
    deps,
    recorder,
    track,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('meeting recording store', () => {
  it('shows a denied permission without creating a meeting', async () => {
    const { store, deps } = setup({
      acquireMicrophone: vi.fn(async () => ({
        ok: false as const,
        problem: 'denied' as const,
      })),
    });

    const result = await store.getState().start({ title: 'Call', host: null });

    expect(result).toBeNull();
    expect(store.getState().phase).toBe('idle');
    expect(store.getState().problem).toBe('denied');
    expect(deps.createMeeting).not.toHaveBeenCalled();
  });

  it('releases the microphone when the meeting cannot be created', async () => {
    const { store, track } = setup({
      createMeeting: vi.fn(async () => {
        throw new Error('backend down');
      }),
    });

    await store.getState().start({ title: 'Call', host: null });

    expect(store.getState().problem).toBe('start-failed');
    expect(store.getState().phase).toBe('idle');
    expect(track.stop).toHaveBeenCalled();
  });

  it('records, pauses, takes notes and saves on stop', async () => {
    const { store, deps, recorder, track, advance } = setup();

    const meetingId = await store
      .getState()
      .start({ title: 'Weekly sync', host: null });
    expect(meetingId).toBe('meeting_1');
    expect(store.getState().phase).toBe('recording');
    expect(isRecordingActive(store.getState().phase)).toBe(true);
    expect(recorder.start).toHaveBeenCalledWith(1000);

    advance(5_000);
    store.getState().addTypedNote('  Decide owner  ');
    store.getState().pause();
    advance(60_000); // paused time does not count
    store.getState().resume();
    advance(2_000);
    store.getState().addTypedNote('');

    expect(store.getState().typedNotes).toEqual([
      { at_ms: 5_000, text: 'Decide owner' },
    ]);
    expect(deps.updateMeeting).toHaveBeenCalledWith('meeting_1', {
      typed_notes: [{ at_ms: 5_000, text: 'Decide owner' }],
    });

    const saved = await store.getState().stop();

    expect(saved).toBe('meeting_1');
    expect(recorder.stop).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    expect(deps.uploadRecording).toHaveBeenCalledWith(
      'meeting_1',
      expect.any(Blob),
      'microphone.webm'
    );
    expect(deps.updateMeeting).toHaveBeenLastCalledWith('meeting_1', {
      status: 'ready',
      duration_ms: 7_000,
      ended_at: 77,
      typed_notes: [{ at_ms: 5_000, text: 'Decide owner' }],
    });
    expect(store.getState()).toMatchObject({
      phase: 'idle',
      meetingId: null,
      problem: null,
      lastSavedMeetingId: 'meeting_1',
    });
  });

  it('marks the meeting not saved when the upload fails', async () => {
    const { store, deps } = setup({
      uploadRecording: vi.fn(async () => {
        throw new Error('disk full');
      }),
    });
    await store.getState().start({ title: 'Call', host: null });

    await store.getState().stop();

    expect(store.getState().problem).toBe('save-failed');
    expect(deps.updateMeeting).toHaveBeenLastCalledWith(
      'meeting_1',
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('saves what was recorded when the microphone is unplugged', async () => {
    const { store, deps, track } = setup();
    await store.getState().start({ title: 'Call', host: null });

    track.dispatchEvent(new Event('ended'));
    await vi.waitFor(() => expect(store.getState().phase).toBe('idle'));

    expect(store.getState().problem).toBe('device-lost');
    expect(deps.uploadRecording).toHaveBeenCalled();
  });

  it('ignores a second start while recording', async () => {
    const { store, deps } = setup();
    await store.getState().start({ title: 'Call', host: null });

    await store.getState().start({ title: 'Other', host: null });

    expect(deps.createMeeting).toHaveBeenCalledTimes(1);
  });
});

describe('recordingElapsedMs', () => {
  it('subtracts paused time, including a pause in progress', () => {
    expect(
      recordingElapsedMs(
        { startedAt: 1_000, pausedMs: 500, pausedSince: null },
        4_000
      )
    ).toBe(2_500);
    expect(
      recordingElapsedMs(
        { startedAt: 1_000, pausedMs: 0, pausedSince: 3_000 },
        9_000
      )
    ).toBe(2_000);
    expect(
      recordingElapsedMs(
        { startedAt: null, pausedMs: 0, pausedSince: null },
        9_000
      )
    ).toBe(0);
  });
});
