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

import { SettingsRouteBridge } from '@/components/Layout';
import { openSettings, useSettingsStore } from '@/store/settingsStore';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runAfterWorkspaceConfigurationSave: vi.fn(),
}));

vi.mock('@/lib/workspaceConfigurationNavigationGuard', () => ({
  runAfterWorkspaceConfigurationSave: mocks.runAfterWorkspaceConfigurationSave,
}));

function LocationProbe() {
  const location = useLocation();
  return (
    <span data-testid="location">
      {location.pathname}
      {location.search}:{JSON.stringify(location.state)}
    </span>
  );
}

describe('SettingsRouteBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      activeSection: 'models',
      isOpen: false,
    });
  });

  it('clears a rejected request so the same Settings command can retry', async () => {
    mocks.runAfterWorkspaceConfigurationSave
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(
        async (action: () => void | Promise<void>): Promise<boolean> => {
          await action();
          return true;
        }
      );

    render(
      <MemoryRouter initialEntries={['/?view=project']}>
        <SettingsRouteBridge />
        <LocationProbe />
      </MemoryRouter>
    );

    act(() => openSettings('settings'));
    await waitFor(() => {
      expect(mocks.runAfterWorkspaceConfigurationSave).toHaveBeenCalledTimes(1);
      expect(useSettingsStore.getState().isOpen).toBe(false);
    });
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/?view=project:null'
    );

    act(() => openSettings('settings'));
    await waitFor(() => {
      expect(mocks.runAfterWorkspaceConfigurationSave).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/home?section=settings&tab=settings:{"from":"/?view=project"}'
      );
    });
  });
});
