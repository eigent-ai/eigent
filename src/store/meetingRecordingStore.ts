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
  pickRecordingMimeType,
  recordingExtension,
  type AcquireMicrophoneResult,
  type MicrophoneHost,
  type MicrophoneProblem,
} from '@/lib/meetings/microphone';
import {
  createMeeting,
  updateMeeting,
  uploadMeetingRecording,
  type Meeting,
  type MeetingTypedNote,
  type MeetingUpdate,
} from '@/service/meetingsApi';
import { create } from 'zustand';

/**
 * One microphone recording at a time, owned here rather than by a page, so
 * it keeps going while the person moves to a Space or Settings. The global
 * recording indicator and the quit guard read this store.
 */

export type RecordingPhase =
  'idle' | 'starting' | 'recording' | 'paused' | 'saving';

export type RecordingProblem =
  MicrophoneProblem | 'device-lost' | 'start-failed' | 'save-failed';

/** The parts of `MediaRecorder` the store uses. */
export interface RecorderLike {
  readonly state: 'inactive' | 'recording' | 'paused';
  readonly mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  start(timeslice?: number): void;
  pause(): void;
  resume(): void;
  stop(): void;
}

export interface MeetingRecorderDeps {
  acquireMicrophone: (
    host: MicrophoneHost | null | undefined
  ) => Promise<AcquireMicrophoneResult>;
  createRecorder: (stream: MediaStream, mimeType: string) => RecorderLike;
  pickMimeType: () => string;
  createMeeting: (title: string) => Promise<Meeting>;
  updateMeeting: (meetingId: string, update: MeetingUpdate) => Promise<Meeting>;
  uploadRecording: (
    meetingId: string,
    recording: Blob,
    fileName: string
  ) => Promise<Meeting>;
  now: () => number;
}

export interface MeetingRecordingState {
  phase: RecordingPhase;
  meetingId: string | null;
  title: string;
  /** `Date.now()` when recording started. */
  startedAt: number | null;
  /** Time spent paused before `pausedSince`. */
  pausedMs: number;
  pausedSince: number | null;
  typedNotes: MeetingTypedNote[];
  problem: RecordingProblem | null;
  /** The meeting saved by the last stop, for "Open meeting". */
  lastSavedMeetingId: string | null;
  start: (input: {
    title: string;
    host: MicrophoneHost | null | undefined;
  }) => Promise<string | null>;
  pause: () => void;
  resume: () => void;
  addTypedNote: (text: string) => void;
  stop: () => Promise<string | null>;
  clearProblem: () => void;
}

/** Recording time so far, not counting pauses. */
export function recordingElapsedMs(
  state: Pick<MeetingRecordingState, 'startedAt' | 'pausedMs' | 'pausedSince'>,
  now: number
): number {
  if (state.startedAt === null) return 0;
  const paused =
    state.pausedMs + (state.pausedSince !== null ? now - state.pausedSince : 0);
  return Math.max(0, now - state.startedAt - paused);
}

export function isRecordingActive(phase: RecordingPhase): boolean {
  return phase === 'recording' || phase === 'paused' || phase === 'saving';
}

const IDLE = {
  phase: 'idle' as const,
  meetingId: null,
  title: '',
  startedAt: null,
  pausedMs: 0,
  pausedSince: null,
  typedNotes: [],
};

export const defaultMeetingRecorderDeps: MeetingRecorderDeps = {
  acquireMicrophone: (host) => acquireMicrophone(host),
  // `MediaRecorder` handlers receive a `BlobEvent`, which has the `data` the
  // store reads; the narrower interface keeps the store testable.
  createRecorder: (stream, mimeType) =>
    new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined
    ) as unknown as RecorderLike,
  pickMimeType: () => pickRecordingMimeType(),
  createMeeting,
  updateMeeting,
  uploadRecording: uploadMeetingRecording,
  now: () => Date.now(),
};

export function createMeetingRecordingStore(deps: MeetingRecorderDeps) {
  let recorder: RecorderLike | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];

  const releaseMicrophone = () => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  };

  return create<MeetingRecordingState>()((set, get) => ({
    ...IDLE,
    problem: null,
    lastSavedMeetingId: null,

    start: async ({ title, host }) => {
      if (get().phase !== 'idle') return get().meetingId;
      set({ phase: 'starting', problem: null });

      const microphone = await deps.acquireMicrophone(host);
      if (!microphone.ok) {
        // A denied permission is a state to show, not an error to throw.
        set({ ...IDLE, problem: microphone.problem });
        return null;
      }
      stream = microphone.stream;

      let meeting: Meeting;
      try {
        meeting = await deps.createMeeting(title);
      } catch (error) {
        console.warn('[Meetings] Could not create the meeting', error);
        releaseMicrophone();
        set({ ...IDLE, problem: 'start-failed' });
        return null;
      }

      try {
        chunks = [];
        recorder = deps.createRecorder(stream, deps.pickMimeType());
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) chunks.push(event.data);
        };
        // Write a chunk every second, so little is lost if the app stops.
        recorder.start(1000);
      } catch (error) {
        console.warn('[Meetings] Could not start the recorder', error);
        releaseMicrophone();
        recorder = null;
        void deps
          .updateMeeting(meeting.id, { status: 'failed' })
          .catch(() => undefined);
        set({ ...IDLE, problem: 'start-failed' });
        return null;
      }

      // Unplugging the microphone ends the track: save what was recorded.
      stream.getAudioTracks().forEach((track) => {
        track.addEventListener('ended', () => {
          if (get().meetingId !== meeting.id) return;
          if (get().phase !== 'recording' && get().phase !== 'paused') return;
          set({ problem: 'device-lost' });
          void get().stop();
        });
      });

      set({
        phase: 'recording',
        meetingId: meeting.id,
        title: meeting.title,
        startedAt: deps.now(),
        pausedMs: 0,
        pausedSince: null,
        typedNotes: [],
      });
      return meeting.id;
    },

    pause: () => {
      if (get().phase !== 'recording' || !recorder) return;
      recorder.pause();
      set({ phase: 'paused', pausedSince: deps.now() });
    },

    resume: () => {
      const { phase, pausedSince, pausedMs } = get();
      if (phase !== 'paused' || !recorder) return;
      recorder.resume();
      set({
        phase: 'recording',
        pausedMs:
          pausedMs + (pausedSince !== null ? deps.now() - pausedSince : 0),
        pausedSince: null,
      });
    },

    addTypedNote: (text) => {
      const trimmed = text.trim();
      const state = get();
      if (!trimmed || !state.meetingId) return;
      if (state.phase !== 'recording' && state.phase !== 'paused') return;
      const typedNotes = [
        ...state.typedNotes,
        { at_ms: recordingElapsedMs(state, deps.now()), text: trimmed },
      ];
      set({ typedNotes });
      // Saved now so an interrupted recording keeps them, and again on stop.
      void deps
        .updateMeeting(state.meetingId, { typed_notes: typedNotes })
        .catch(() => undefined);
    },

    stop: async () => {
      const state = get();
      if (state.phase !== 'recording' && state.phase !== 'paused') return null;
      const meetingId = state.meetingId;
      if (!meetingId) return null;
      const durationMs = recordingElapsedMs(state, deps.now());
      set({ phase: 'saving' });

      const activeRecorder = recorder;
      if (activeRecorder && activeRecorder.state !== 'inactive') {
        await new Promise<void>((resolve) => {
          activeRecorder.onstop = () => resolve();
          activeRecorder.stop();
        });
      }
      recorder = null;
      releaseMicrophone();

      const mimeType = activeRecorder?.mimeType || 'audio/webm';
      const recording = new Blob(chunks, { type: mimeType });
      chunks = [];
      let problem = get().problem;
      try {
        if (recording.size > 0) {
          await deps.uploadRecording(
            meetingId,
            recording,
            `microphone.${recordingExtension(mimeType)}`
          );
        }
        await deps.updateMeeting(meetingId, {
          status: 'ready',
          duration_ms: durationMs,
          ended_at: deps.now() / 1000,
          typed_notes: state.typedNotes,
        });
      } catch (error) {
        console.warn('[Meetings] Could not save the recording', error);
        problem = 'save-failed';
        void deps
          .updateMeeting(meetingId, {
            status: 'failed',
            duration_ms: durationMs,
            typed_notes: state.typedNotes,
          })
          .catch(() => undefined);
      }
      set({ ...IDLE, problem, lastSavedMeetingId: meetingId });
      return meetingId;
    },

    clearProblem: () => set({ problem: null }),
  }));
}

export const useMeetingRecordingStore = createMeetingRecordingStore(
  defaultMeetingRecorderDeps
);
