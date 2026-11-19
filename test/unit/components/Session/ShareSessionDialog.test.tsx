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

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { finishedRun, runEvent } from '../../lib/sessionReplay/fixtures';

const mocks = vi.hoisted(() => ({
  loadSessionReplayData: vi.fn(),
  createSharedSessionLink: vi.fn(),
  listSharedSessionLinks: vi.fn(),
  stopSharedSessionLink: vi.fn(),
  deleteSharedSessionLink: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock('@/service/sessionReplayEvents', () => ({
  loadSessionReplayData: mocks.loadSessionReplayData,
}));

vi.mock('@/service/sharedSessionApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/service/sharedSessionApi')>()),
  createSharedSessionLink: mocks.createSharedSessionLink,
  listSharedSessionLinks: mocks.listSharedSessionLinks,
  stopSharedSessionLink: mocks.stopSharedSessionLink,
  deleteSharedSessionLink: mocks.deleteSharedSessionLink,
}));

import { ShareSessionDialog } from '@/components/Session/ShareSessionDialog';
import { SharedSessionUnavailableError } from '@/service/sharedSessionApi';

const link = {
  shareId: 'abc123',
  url: 'https://share.example.test/s/abc123',
  title: 'Q3 report',
  createdAt: '2026-11-01T10:00:00Z',
  expiresAt: '2026-11-08T10:00:00Z',
  stopped: false,
  version: 1,
};

function renderDialog() {
  return render(
    <ShareSessionDialog
      projectId="project-1"
      title="Q3 report"
      open
      onOpenChange={() => {}}
    />
  );
}

describe('ShareSessionDialog', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((fn) => fn.mockReset());
    const events = [
      ...finishedRun('run-private-id'),
      runEvent(
        'tool.completed',
        {
          tool_name: 'shell',
          display_output: 'export OPENAI_API_KEY=sk-test-123456789012345678',
        },
        8,
        { runId: 'run-private-id' }
      ),
    ];
    mocks.loadSessionReplayData.mockResolvedValue({
      projectId: 'project-1',
      runs: [
        {
          runId: 'run-private-id',
          status: 'completed',
          createdAt: '2026-11-01T10:00:00Z',
          events,
        },
      ],
      events,
      unfinishedRunCount: 0,
      truncated: false,
    });
    mocks.listSharedSessionLinks.mockResolvedValue([]);
    mocks.createSharedSessionLink.mockResolvedValue(link);
    mocks.writeText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.writeText },
    });
  });

  it('previews the cleaned copy, then creates and copies the link', async () => {
    renderDialog();
    expect(await screen.findByText('Task 1')).toBeInTheDocument();
    expect(screen.getByText('No links yet.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('Write the report')).toBeInTheDocument();
    expect(screen.queryByText(/sk-test/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Create link' }));
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith(link.url));
    const request = mocks.createSharedSessionLink.mock.calls[0][0];
    expect(request).toMatchObject({ projectId: 'project-1', expiresInDays: 7 });
    expect(request.snapshot.included).toEqual({
      tool_calls: true,
      thinking: false,
      files: [],
    });
    const uploaded = JSON.stringify(request.snapshot);
    expect(uploaded).not.toContain('sk-test');
    // The real Run id stays on the device.
    expect(uploaded).not.toContain('run-private-id');
    expect(await screen.findByText(link.url)).toBeInTheDocument();
  });

  it('turning off tool calls leaves them out of the upload', async () => {
    renderDialog();
    await screen.findByText('Task 1');
    fireEvent.click(
      screen.getByRole('switch', { name: 'Tool calls and results' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create link' }));
    await waitFor(() =>
      expect(mocks.createSharedSessionLink).toHaveBeenCalled()
    );
    const { snapshot } = mocks.createSharedSessionLink.mock.calls[0][0];
    const types = snapshot.runs[0].events.map(
      (event: { event_type: string }) => event.event_type
    );
    expect(types).not.toContain('tool.completed');
  });

  it('says when the server cannot hold share links yet', async () => {
    mocks.listSharedSessionLinks.mockRejectedValue(
      new SharedSessionUnavailableError()
    );
    renderDialog();
    expect(
      await screen.findByText('Sharing is not available on this server yet.')
    ).toBeInTheDocument();
  });

  it('can stop a link the owner made', async () => {
    mocks.listSharedSessionLinks.mockResolvedValue([link]);
    mocks.stopSharedSessionLink.mockResolvedValue({ ...link, stopped: true });
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(await screen.findByText('Stopped')).toBeInTheDocument();
    expect(mocks.stopSharedSessionLink).toHaveBeenCalledWith('abc123');
  });
});
