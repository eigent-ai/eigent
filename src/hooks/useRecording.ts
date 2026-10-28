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

import { sseTransport } from '@/api/http';
import { useHost } from '@/host';
import {
  ACTIVE_RECORDING_STATES,
  listRecordings,
  mergeRecording,
  recordingCapabilities,
  stopRecording,
  type Recording,
  type RecordingCapabilities,
} from '@/service/recordingApi';
import { useAuthStore } from '@/store/authStore';
import i18next from 'i18next';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { create } from 'zustand';

interface RecordingView {
  recordings: Recording[];
  capabilities: RecordingCapabilities | null;
  connected: boolean;
  account: string | null;
  reconcile: (
    recordings: Recording[],
    capabilities: RecordingCapabilities,
    account: string
  ) => void;
  receive: (recording: Recording) => void;
}
export const useRecordingStore = create<RecordingView>((set) => ({
  recordings: [],
  capabilities: null,
  connected: false,
  account: null,
  reconcile: (recordings, capabilities, account) =>
    set((state) => ({
      recordings:
        state.account === account
          ? recordings.reduce(
              (rows, record) => mergeRecording(rows, record),
              state.recordings
            )
          : recordings,
      capabilities,
      connected: true,
      account,
    })),
  receive: (incoming) =>
    set((state) => ({
      recordings: mergeRecording(state.recordings, incoming),
    })),
}));

function notifyTransition(incoming: Recording) {
  const previous = useRecordingStore
    .getState()
    .recordings.find((item) => item.id === incoming.id);
  if (
    !previous ||
    previous.version >= incoming.version ||
    !ACTIVE_RECORDING_STATES.includes(previous.state) ||
    ACTIVE_RECORDING_STATES.includes(incoming.state)
  )
    return;
  const message = i18next.t(`layout.recording-result-${incoming.state}`);
  if (incoming.state === 'completed') toast.success(message);
  else toast.error(message);
}

/** Mounted once by the app-wide top bar. It only observes Brain state. */
export function useRecordingMonitor() {
  const token = useAuthStore((state) => state.token);
  const userId = useAuthStore((state) => state.user_id);
  const email = useAuthStore((state) => state.email);
  const host = useHost();
  useEffect(() => {
    useRecordingStore.setState({
      recordings: [],
      capabilities: null,
      connected: false,
      account: null,
    });
    if (!token) return;
    const abort = new AbortController();
    const account = `${userId ?? ''}:${email ?? ''}`;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const [list, capabilities] = await Promise.all([
          listRecordings(),
          recordingCapabilities(),
        ]);
        if (!abort.signal.aborted) {
          for (const recording of list.recordings) notifyTransition(recording);
          useRecordingStore
            .getState()
            .reconcile(list.recordings, capabilities, account);
        }
      } catch {
        // Retain the visible indicator when the connection drops; stopping
        // remains retryable, and the adapter's independent lease ends capture.
        if (!abort.signal.aborted)
          useRecordingStore.setState({ connected: false });
      } finally {
        pending = false;
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 5000);
    void sseTransport({
      url: '/recordings/events',
      method: 'GET',
      signal: abort.signal,
      onmessage: (event) => {
        if (abort.signal.aborted || event.event !== 'recording') return;
        try {
          const value = JSON.parse(event.data);
          if (value.schema_version === 1 && value.recording) {
            notifyTransition(value.recording);
            useRecordingStore.getState().receive(value.recording);
          }
        } catch {
          void refresh();
        }
      },
    }).catch(() => {});
    return () => {
      abort.abort();
      clearInterval(interval);
    };
  }, [email, token, userId, host?.recording]);
}

export function useRecording() {
  const recordings = useRecordingStore((state) => state.recordings);
  const capabilities = useRecordingStore((state) => state.capabilities);
  const connected = useRecordingStore((state) => state.connected);
  return {
    recordings,
    capabilities,
    connected,
    active:
      recordings.find((item) => ACTIVE_RECORDING_STATES.includes(item.state)) ??
      null,
  };
}

export function useStopRecording() {
  const pending = useRef(false);
  return async (id: string) => {
    if (pending.current) return;
    pending.current = true;
    try {
      useRecordingStore.getState().receive(await stopRecording(id));
    } finally {
      pending.current = false;
    }
  };
}
