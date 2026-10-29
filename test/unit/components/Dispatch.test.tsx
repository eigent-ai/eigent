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

import { WorkspaceDispatch } from '@/components/Dispatch';
import { useTriggerStore } from '@/store/triggerStore';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  remoteControlSupported: true,
}));

vi.mock('@/lib/spaceLabel', () => ({
  canUseRemoteControlInSpace: () => mocks.remoteControlSupported,
}));

vi.mock('@/store/spaceStore', () => {
  const state = {
    activeSpaceId: 'space-1',
    spaces: { 'space-1': { id: 'space-1', name: 'Research' } },
  };
  return {
    useSpaceStore: (selector: (value: typeof state) => unknown) =>
      selector(state),
  };
});

vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: (selector: (value: object) => unknown) =>
    selector({ activeProjectId: null }),
}));

describe('WorkspaceDispatch', () => {
  beforeEach(() => {
    mocks.remoteControlSupported = true;
    useTriggerStore.setState({
      activeRemoteControlSessions: [],
      remoteControlLogs: [],
    });
  });

  it('introduces Remote control beside the channel rail before a link exists', () => {
    render(<WorkspaceDispatch />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'Remote control' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();

    const rail = screen.getByRole('complementary', { name: 'Channels' });
    const rows = within(rail).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Remote control',
      'TelegramComing soon',
      'LarkComing soon',
      'WhatsAppComing soon',
    ]);
    expect(
      within(rows[0]).getByText('Remote control').parentElement
    ).toHaveAttribute('aria-current', 'true');
  });

  it('explains why a legacy Space cannot start Remote control', () => {
    mocks.remoteControlSupported = false;
    render(<WorkspaceDispatch />);

    expect(
      screen.getByText('Legacy Spaces do not support remote control.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
    expect(
      within(screen.getByRole('complementary')).getByText('Unavailable')
    ).toBeInTheDocument();
  });

  it('lists active links and activity once a link is started', () => {
    useTriggerStore.setState({
      activeRemoteControlSessions: [
        {
          sessionId: 'rc-1',
          url: 'https://example.test/rc-1',
          title: 'Research',
          expiresAt: '2026-10-29T10:00:00.000Z',
        },
      ],
      remoteControlLogs: [
        {
          id: 'log-1',
          name: 'Research',
          status: 'created',
          time: '2026-10-28T10:00:00.000Z',
        },
      ],
    });
    render(<WorkspaceDispatch />);

    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
    const links = screen.getByRole('region', { name: /Active links/ });
    expect(
      within(links).getByRole('button', { name: 'Copy link' })
    ).toBeInTheDocument();
    expect(
      within(links).getByRole('button', { name: 'Revoke link' })
    ).toBeInTheDocument();
    expect(within(links).getByText(/^Expires /)).toBeInTheDocument();
    const activity = screen.getByRole('region', { name: 'Activity' });
    expect(within(activity).getByText('created')).toBeInTheDocument();
    expect(
      within(screen.getByRole('complementary')).getByText('Connected')
    ).toBeInTheDocument();
  });
});
