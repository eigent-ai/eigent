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

import { HeaderBox } from '@/components/Session/HeaderBox';
import { usePageTabStore } from '@/store/pageTabStore';
import { useSessionControlsStore } from '@/store/sessionControlsStore';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/store/authStore', () => ({
  getAuthStore: vi.fn(() => ({ language: 'en-US' })),
  useAuthStore: vi.fn(() => ({ appearance: 'light' })),
}));

describe('HeaderBox chat timeline mode', () => {
  let resizeHeader: ((width: number) => void) | undefined;

  beforeEach(() => {
    vi.stubEnv('VITE_CHATBOX_EVENT_BUS', 'true');
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800,
    } as DOMRect);
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserverMock {
        constructor(callback: ResizeObserverCallback) {
          resizeHeader = (width) =>
            callback(
              [{ contentRect: { width } } as ResizeObserverEntry],
              this as unknown as ResizeObserver
            );
        }

        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    usePageTabStore.setState({
      chatTimelineDetailLevel: 'narrative',
      narrativeInformationDensity: 'compact',
    });
    localStorage.removeItem('eigent-pinned-projects');
    useSessionControlsStore.setState({ pinnedProjectIds: [], request: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('places the Session menu beside its title and keeps preview on the right', () => {
    render(
      <HeaderBox
        totalTokens={42}
        projectName="Timeline project"
        projectId="project-1"
      />
    );

    const title = screen.getByText('Timeline project');
    const menu = screen.getByRole('button', {
      name: 'Session settings: Timeline project',
    });
    const tokenLabel = screen.getByText(/Total:/);
    const previewButton = screen.getByRole('button', {
      name: 'Open preview',
    });

    expect(
      title.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      menu.compareDocumentPosition(tokenLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      tokenLabel.compareDocumentPosition(previewButton) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('switches views and adjusts Narrative detail in one menu', async () => {
    const user = userEvent.setup();
    render(
      <HeaderBox
        totalTokens={42}
        projectName="Timeline project"
        projectId="project-1"
      />
    );

    await user.click(
      screen.getByRole('button', { name: 'Session settings: Timeline project' })
    );
    expect(screen.getByText('View settings')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Narrative' })).toHaveAttribute(
      'data-state',
      'active'
    );
    expect(
      screen.getByRole('slider', { name: 'Narrative detail' })
    ).toHaveAttribute('aria-valuetext', 'Compact');
    fireEvent.change(screen.getByRole('slider', { name: 'Narrative detail' }), {
      target: { value: '2' },
    });
    expect(usePageTabStore.getState().narrativeInformationDensity).toBe(
      'expanded'
    );
    await user.click(screen.getByRole('tab', { name: 'Trajectory' }));
    expect(usePageTabStore.getState().chatTimelineDetailLevel).toBe(
      'trajectory'
    );
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('shows the chevron as selected only while its panel is open', async () => {
    const user = userEvent.setup();
    render(<HeaderBox projectName="Timeline project" projectId="project-1" />);
    const trigger = screen.getByRole('button', {
      name: 'Session settings: Timeline project',
    });

    expect(trigger).not.toHaveClass('bg-ds-neutral-strong-default');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveClass('bg-ds-neutral-strong-default');
    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).not.toHaveClass('bg-ds-neutral-strong-default');
  });

  it('hides token usage when the Session pane shrinks and keeps the menu and preview', () => {
    render(
      <HeaderBox
        totalTokens={42}
        projectName="Timeline project"
        projectId="project-1"
      />
    );

    expect(screen.getByText(/Total:/)).toBeInTheDocument();

    act(() => resizeHeader?.(400));

    expect(screen.queryByText(/Total:/)).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Session settings: Timeline project' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open preview' })
    ).toBeInTheDocument();
  });

  it('routes Session actions and updates the shared pinned state', async () => {
    const user = userEvent.setup();
    render(
      <HeaderBox
        totalTokens={42}
        projectName="Timeline project"
        projectId="project-1"
      />
    );

    await user.click(
      screen.getByRole('button', { name: 'Session settings: Timeline project' })
    );
    await user.click(screen.getByRole('button', { name: 'Pin' }));
    expect(useSessionControlsStore.getState().pinnedProjectIds).toEqual([
      'project-1',
    ]);
    expect(
      JSON.parse(localStorage.getItem('eigent-pinned-projects') ?? '[]')
    ).toEqual(['project-1']);
    await user.click(
      screen.getByRole('button', { name: 'Session settings: Timeline project' })
    );
    expect(screen.getByRole('button', { name: 'Unpin' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Rename session' }));
    expect(useSessionControlsStore.getState().request).toMatchObject({
      action: 'rename',
      projectId: 'project-1',
    });
    await user.click(
      screen.getByRole('button', { name: 'Session settings: Timeline project' })
    );
    await user.click(screen.getByRole('button', { name: 'End session' }));
    expect(useSessionControlsStore.getState().request).toMatchObject({
      action: 'end',
      projectId: 'project-1',
    });
    await user.click(
      screen.getByRole('button', { name: 'Session settings: Timeline project' })
    );
    await user.click(screen.getByRole('button', { name: 'Delete session' }));
    expect(useSessionControlsStore.getState().request).toMatchObject({
      action: 'delete',
      projectId: 'project-1',
    });
  });

  it('disables End session for an ended Session', async () => {
    const user = userEvent.setup();
    render(
      <HeaderBox projectName="Ended" projectId="project-1" projectAchieved />
    );
    await user.click(
      screen.getByRole('button', { name: 'Session settings: Ended' })
    );
    expect(screen.getByRole('button', { name: 'End session' })).toBeDisabled();
  });

  it('lets keyboard users reach the view control and density slider', async () => {
    const user = userEvent.setup();
    render(<HeaderBox projectName="Timeline project" projectId="project-1" />);
    const trigger = screen.getByRole('button', {
      name: 'Session settings: Timeline project',
    });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('tab', { name: 'Narrative' })).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole('slider', { name: 'Narrative detail' })
    ).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(usePageTabStore.getState().narrativeInformationDensity).toBe(
      'balanced'
    );
  });
});
