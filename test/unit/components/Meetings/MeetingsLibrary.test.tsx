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

import MeetingsLibrary from '@/components/Meetings/MeetingsLibrary';
import { HostProvider } from '@/host';
import type { Meeting } from '@/service/meetingsApi';
import { useMeetingPreferencesStore } from '@/store/meetingPreferencesStore';
import { useMeetingRecordingStore } from '@/store/meetingRecordingStore';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listMeetings: vi.fn(),
  createMeeting: vi.fn(),
  updateMeeting: vi.fn(),
  importMeetingRecording: vi.fn(),
  uploadMeetingRecording: vi.fn(),
}));
const openMeetings = vi.hoisted(() => vi.fn());

vi.mock('@/service/meetingsApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/meetingsApi')>()),
  ...api,
}));
vi.mock('@/components/Home/hooks/useHomeNavigation', () => ({
  useHomeNavigation: () => ({ openMeetings }),
}));

const meeting = (overrides: Partial<Meeting>): Meeting => ({
  id: 'meeting_a',
  title: 'Weekly sync',
  status: 'ready',
  source: 'microphone',
  started_at: Date.now() / 1000,
  ended_at: null,
  duration_ms: 65_000,
  recording_file: null,
  recording_bytes: 0,
  recording_kept: false,
  note_markdown: '',
  note_edited: false,
  typed_notes: [],
  spaces: [],
  ...overrides,
});

function renderLibrary(electronAPI: Record<string, unknown> | null = null) {
  return render(
    <HostProvider host={{ electronAPI, ipcRenderer: null }}>
      <MemoryRouter>
        <MeetingsLibrary />
      </MemoryRouter>
    </HostProvider>
  );
}

describe('MeetingsLibrary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMeetingPreferencesStore.setState({ consentReminderDismissed: false });
    useMeetingRecordingStore.setState({ problem: null, phase: 'idle' });
    api.updateMeeting.mockResolvedValue(meeting({}));
  });

  it('lists meetings under Today and opens one', async () => {
    api.listMeetings.mockResolvedValue([
      meeting({ id: 'meeting_a', title: 'Weekly sync' }),
      meeting({ id: 'meeting_b', title: 'Lost call', status: 'interrupted' }),
    ]);
    renderLibrary();

    const row = await screen.findByRole('button', { name: /Weekly sync/ });
    expect(screen.getByRole('region', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByText('Interrupted')).toBeInTheDocument();
    expect(row).toHaveTextContent('1:05');

    await userEvent.click(row);
    expect(openMeetings).toHaveBeenCalledWith('meeting_a');
  });

  it('shows the empty state', async () => {
    api.listMeetings.mockResolvedValue([]);
    renderLibrary();

    expect(await screen.findByText('No meetings yet')).toBeInTheDocument();
  });

  it('asks for consent, then explains a denied microphone without recording', async () => {
    api.listMeetings.mockResolvedValue([]);
    const requestMicrophoneAccess = vi.fn(async () => 'denied');
    const openMicrophoneSettings = vi.fn(async () => true);
    renderLibrary({ requestMicrophoneAccess, openMicrophoneSettings });

    await userEvent.click(
      await screen.findByRole('button', { name: 'New meeting' })
    );
    expect(
      screen.getByText(/Let everyone know you're recording/)
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Start recording' })
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Eigent can't use the microphone.");
    expect(requestMicrophoneAccess).toHaveBeenCalledOnce();
    expect(api.createMeeting).not.toHaveBeenCalled();
    expect(openMeetings).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole('button', { name: 'Open System Settings' })
    );
    expect(openMicrophoneSettings).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(useMeetingRecordingStore.getState().phase).toBe('idle')
    );
  });

  it('skips the reminder after "Don\'t show again"', async () => {
    api.listMeetings.mockResolvedValue([]);
    useMeetingPreferencesStore.setState({ consentReminderDismissed: true });
    const requestMicrophoneAccess = vi.fn(async () => 'denied');
    renderLibrary({ requestMicrophoneAccess });

    await userEvent.click(
      await screen.findByRole('button', { name: 'New meeting' })
    );

    await waitFor(() => expect(requestMicrophoneAccess).toHaveBeenCalled());
    expect(
      screen.queryByText(/Let everyone know you're recording/)
    ).not.toBeInTheDocument();
  });
});
