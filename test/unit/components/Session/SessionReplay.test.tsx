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

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { finishedRun } from '../../lib/sessionReplay/fixtures';

const mocks = vi.hoisted(() => ({
  loadSessionReplayData: vi.fn(),
}));

vi.mock('@/service/sessionReplayEvents', () => ({
  loadSessionReplayData: mocks.loadSessionReplayData,
}));

import { SessionReplay } from '@/components/Session/SessionReplay';
import { useSessionReplayStore } from '@/store/sessionReplayStore';

/** The position label once all seven events are loaded. */
const LOADED = /^\d \/ 7$/;

function stepToEnd() {
  const next = screen.getByRole('button', { name: 'Next step' });
  for (let step = 0; step < 10 && !next.hasAttribute('disabled'); step += 1) {
    fireEvent.click(next);
  }
}

describe('SessionReplay', () => {
  beforeEach(() => {
    const events = finishedRun();
    mocks.loadSessionReplayData.mockResolvedValue({
      projectId: 'project-1',
      runs: [
        {
          runId: 'run-1',
          status: 'completed',
          createdAt: '2026-11-01T10:00:00Z',
          events,
        },
      ],
      events,
      unfinishedRunCount: 0,
      truncated: false,
    });
    useSessionReplayStore.setState({
      replayingProjectIds: ['project-1'],
      shareProjectId: null,
    });
  });

  it('plays the stored events read-only and exits on request', async () => {
    const { container } = render(<SessionReplay projectId="project-1" />);
    expect(await screen.findByText(LOADED)).toBeInTheDocument();

    // Read-only: the composer is not part of replay.
    expect(container.querySelector('textarea')).toBeNull();

    // An unfinished Run measures its time to the last event shown, not
    // to the wall clock.
    expect(screen.queryByText(/\d+h /)).toBeNull();

    stepToEnd();
    expect(screen.getByText('7 / 7')).toBeInTheDocument();
    expect(screen.getByText('Write the report')).toBeInTheDocument();
    expect(screen.getByText('The report is ready.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Exit replay' }));
    expect(useSessionReplayStore.getState().replayingProjectIds).toEqual([]);
  });

  it('steps back from the end to hide the answer', async () => {
    render(<SessionReplay projectId="project-1" />);
    await screen.findByText(LOADED);
    stepToEnd();
    expect(screen.getByText('The report is ready.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Previous step' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous step' }));
    expect(screen.getByText('5 / 7')).toBeInTheDocument();
    expect(screen.queryByText('The report is ready.')).toBeNull();
  });

  it('shows a retry when the events cannot be read', async () => {
    mocks.loadSessionReplayData.mockRejectedValueOnce(new Error('offline'));
    render(<SessionReplay projectId="project-1" />);
    expect(
      await screen.findByText('Could not load this Session for replay.')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(LOADED)).toBeInTheDocument();
  });
});
