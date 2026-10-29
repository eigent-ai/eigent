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

import { RecordingIndicator } from '@/components/Recording/RecordingIndicator';
import { SessionRecordingControl } from '@/components/Recording/SessionRecordingControl';
import { useRecordingStore } from '@/hooks/useRecording';
import type { Recording } from '@/service/recordingApi';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  stop: vi.fn(),
  authorize: vi.fn(),
  start: vi.fn(),
  get: vi.fn(),
  openFile: vi.fn(),
}));
vi.mock('@/hooks/useRecording', async () => ({
  ...(await vi.importActual<typeof import('@/hooks/useRecording')>(
    '@/hooks/useRecording'
  )),
  useRecordingMonitor: () => {},
}));
vi.mock('@/host', () => ({
  useHost: () => ({ recording: { authorize: mocks.authorize } }),
}));
vi.mock('@/api/http', () => ({
  fetchGet: (...args: unknown[]) => mocks.get(...args),
  sseTransport: vi.fn(),
}));
vi.mock('@/service/recordingApi', async () => ({
  ...(await vi.importActual<typeof import('@/service/recordingApi')>(
    '@/service/recordingApi'
  )),
  stopRecording: (...args: unknown[]) => mocks.stop(...args),
  startRecording: (...args: unknown[]) => mocks.start(...args),
}));
vi.mock('@/hooks/useSessionPageTabStore', () => ({
  useSessionPageTabStore: (selector: (state: unknown) => unknown) =>
    selector({ openFilePreview: mocks.openFile }),
}));
const row: Recording = {
  id: 'recording',
  version: 1,
  space_id: 'space',
  project_id: 'session',
  run_id: 'run',
  attempt_id: null,
  state: 'recording',
  reason: null,
  started_at: Date.now() / 1000 - 60,
  created_at: 100,
  ended_at: null,
  clips: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  useRecordingStore.setState({
    recordings: [],
    connected: true,
    capabilities: { available: true, reason: null, formats: ['video/mp4'] },
  });
});
afterEach(cleanup);

describe('recording controls', () => {
  it('stops the provider recording from the app-wide surface after Session navigation', async () => {
    useRecordingStore.setState({
      recordings: [{ ...row, project_id: 'different-session' }],
    });
    mocks.stop.mockResolvedValue({ ...row, state: 'stopping', version: 2 });
    render(<RecordingIndicator />);
    expect(screen.getByText('Recording')).toBeVisible();
    const stop = screen.getByRole('button', { name: 'Stop recording' });
    act(() => stop.focus());
    expect(stop).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(mocks.stop).toHaveBeenCalledWith(row.id));
    expect(await screen.findByText('Stopping recording')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Stop recording' })).toBeNull();
  });
  it('keeps capture visible when the backend connection is lost', () => {
    useRecordingStore.setState({ recordings: [row], connected: false });
    render(<RecordingIndicator />);
    expect(screen.getByText(/Reconnecting/)).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Stop recording' })
    ).toBeEnabled();
  });
  it.each(['starting', 'stopping', 'finalizing'] as const)(
    'renders %s without a capture timer',
    (state) => {
      useRecordingStore.setState({ recordings: [{ ...row, state }] });
      render(<RecordingIndicator />);
      expect(screen.getByLabelText('Recordings')).toBeVisible();
      expect(screen.queryByText(/^\d+:\d\d$/)).toBeNull();
    }
  );
  it('requires native desktop consent before sending a start', async () => {
    mocks.get.mockResolvedValue({
      runs: [{ run_id: 'run', status: 'running' }],
    });
    mocks.authorize.mockResolvedValue(null);
    render(<SessionRecordingControl sessionId="session" />);
    await userEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(mocks.authorize).toHaveBeenCalledWith('run');
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('uses the existing file preview with a local-only clip', async () => {
    useRecordingStore.setState({
      recordings: [
        {
          ...row,
          state: 'completed',
          clips: [
            {
              id: 'clip',
              local_path: '/space/recordings/clip.mp4',
              relative_path: 'recordings/clip.mp4',
              mime: 'video/mp4',
              duration: 2,
              bytes: 100,
              width: 800,
              height: 600,
            },
          ],
        },
      ],
    });
    render(<SessionRecordingControl sessionId="session" />);
    await userEvent.click(screen.getByRole('button', { name: 'Recordings' }));
    await userEvent.click(await screen.findByRole('menuitem'));
    expect(mocks.openFile).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'mp4',
        path: '/space/recordings/clip.mp4',
        relativePath: 'recordings/clip.mp4',
        project_id: 'session',
        mimeType: 'video/mp4',
        localPathAvailable: true,
        uploadPolicy: 'metadata_only',
      }),
      'session'
    );
  });
  it('disables recording for unavailable capture without affecting other controls', () => {
    useRecordingStore.setState({
      capabilities: {
        available: false,
        reason: 'provider_unavailable',
        formats: [],
      },
    });
    render(<SessionRecordingControl sessionId="session" compact />);
    expect(screen.getByRole('button', { name: 'Record' })).toBeDisabled();
  });
});
