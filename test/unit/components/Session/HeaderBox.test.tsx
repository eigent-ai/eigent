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
import type { ChatMessageNode } from '@/lib/projector/chat';
import { usePageTabStore } from '@/store/pageTabStore';
import type { ProjectEventStoreSnapshot } from '@/store/projectEventStore';
import { useSessionControlsStore } from '@/store/sessionControlsStore';
import { useSkillsStore } from '@/store/skillsStore';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { runtimeMock } = vi.hoisted(() => ({ runtimeMock: vi.fn() }));

vi.mock('@/store/authStore', () => ({
  getAuthStore: vi.fn(() => ({ language: 'en-US' })),
  useAuthStore: vi.fn(() => ({ appearance: 'light' })),
}));

vi.mock('@/hooks/useProjectEventRuntime', () => ({
  useProjectEventRuntime: runtimeMock,
}));

vi.mock('@/components/Trigger/TriggerDialog', () => ({
  TriggerDialog: ({
    isOpen,
    sourceProjectId,
    initialTaskPrompt,
  }: {
    isOpen: boolean;
    sourceProjectId?: string;
    initialTaskPrompt?: string;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label="Automation draft">
        {sourceProjectId}: {initialTaskPrompt}
      </div>
    ) : null,
}));

function message(
  id: string,
  runId: string,
  runSequence: number,
  role: ChatMessageNode['role'],
  purpose: ChatMessageNode['purpose'],
  content: string
): ChatMessageNode {
  return {
    id,
    eventId: id,
    projectId: 'project-1',
    runId,
    runSequence,
    cloudCursor: null,
    createdAt: `2026-09-23T10:00:0${runSequence}.000Z`,
    eventType: 'test.message',
    legacyStep: null,
    kind: 'message',
    role,
    purpose,
    content,
    status: 'complete',
  };
}

function completedSnapshot(): ProjectEventStoreSnapshot {
  return {
    view: { projectId: 'project-1', runs: {} },
    chat: {
      nodes: [
        message('query-1', 'run-1', 1, 'user', 'query', 'Original request'),
        message('final-1', 'run-1', 2, 'assistant', 'final', 'Final result'),
      ],
    },
  } as ProjectEventStoreSnapshot;
}

describe('HeaderBox chat timeline mode', () => {
  let resizeHeader: ((width: number) => void) | undefined;
  let resizeTitle: ((width: number) => void) | undefined;

  beforeEach(() => {
    runtimeMock.mockReturnValue({ projectId: null, snapshot: null });
    vi.stubEnv('VITE_CHATBOX_EVENT_BUS', 'true');
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800,
    } as DOMRect);
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserverMock {
        constructor(private callback: ResizeObserverCallback) {}

        observe(target: Element) {
          const resize = (width: number) =>
            this.callback(
              [{ contentRect: { width } } as ResizeObserverEntry],
              this as unknown as ResizeObserver
            );
          if (target.tagName === 'SPAN') resizeTitle = resize;
          else resizeHeader = resize;
        }

        unobserve() {}
        disconnect() {}
      }
    );
    usePageTabStore.setState({
      chatTimelineDetailLevel: 'narrative',
      narrativeInformationDensity: 'compact',
      sessionPreviewProjectId: null,
    });
    useSkillsStore.setState({ skills: [] });
    localStorage.removeItem('eigent-pinned-projects');
    useSessionControlsStore.setState({ pinnedProjectIds: [], request: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses the Session title and trailing menu icon as one trigger', async () => {
    const user = userEvent.setup();
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
    const menuIcon = menu.querySelector('.lucide-ellipsis-vertical');

    expect(menu).toContainElement(title);
    expect(menu).toContainElement(menuIcon as HTMLElement);
    expect(menu).toHaveClass('active:scale-100');
    expect(menu).not.toHaveClass('active:scale-[0.97]');
    expect(title).toHaveClass('max-w-[200px]', 'overflow-hidden');
    expect(title).not.toHaveClass('truncate');
    expect((title as HTMLElement).style.maskImage).toBe('');
    expect(title).toHaveAttribute('title', 'Timeline project');
    expect(
      menu.compareDocumentPosition(tokenLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      tokenLabel.compareDocumentPosition(previewButton) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    await user.click(title);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    await user.click(menuIcon!);
    expect(menu).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps a long Session title bounded and exposes its full name', () => {
    const projectName = 'A long Session title that exceeds the header width';
    let titleWidth = 200;
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(280);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(
      () => titleWidth
    );
    render(<HeaderBox projectName={projectName} projectId="project-1" />);

    const menu = screen.getByRole('button', {
      name: `Session settings: ${projectName}`,
    });
    const title = screen.getByText(projectName);

    expect(menu).toHaveClass('min-w-0', 'max-w-full', 'shrink');
    expect(title).toHaveClass('max-w-[200px]', 'overflow-hidden');
    expect(title).not.toHaveClass('truncate');
    expect(title).toHaveStyle({
      maskImage:
        'linear-gradient(to right, white calc(100% - var(--ds-ref-space-24)), transparent 100%)',
    });
    expect(title).toHaveAttribute('title', projectName);

    titleWidth = 300;
    act(() => resizeTitle?.(titleWidth));
    expect((title as HTMLElement).style.maskImage).toBe('');
  });

  it('puts automation actions first and disables them without a completed result', async () => {
    const user = userEvent.setup();
    render(<HeaderBox projectName="Timeline project" projectId="project-1" />);

    await user.click(
      screen.getByRole('button', { name: 'Session settings: Timeline project' })
    );
    const items = screen.getAllByRole('menuitem');
    expect(items.slice(0, 2).map((item) => item.textContent)).toEqual([
      'Turn into skill',
      'Turn into automation',
    ]);
    expect(items[1].querySelector('.lucide-zap')).toBeTruthy();
    expect(items[0].closest('[role="menu"]')).toHaveClass('w-56');
    expect(items[0]).toHaveAttribute('aria-disabled', 'true');
    expect(items[1]).toHaveAttribute('aria-disabled', 'true');
  });

  it('drafts from the latest completed result and opens an editable automation', async () => {
    const user = userEvent.setup();
    const originalRequestChatDraft =
      usePageTabStore.getState().requestWorkspaceChatDraft;
    const requestChatDraft = vi.fn();
    runtimeMock.mockReturnValue({
      projectId: 'project-1',
      snapshot: completedSnapshot(),
    });
    usePageTabStore.setState({
      sessionPreviewProjectId: 'project-1',
      requestWorkspaceChatDraft: requestChatDraft,
    });
    useSkillsStore.setState({
      skills: [
        {
          id: 'skill-creator',
          name: 'skill-creator',
          description: '',
          filePath: '',
          fileContent: '',
          addedAt: 0,
          scope: { isGlobal: true, selectedAgents: [] },
          enabled: true,
          isExample: false,
        },
      ],
    });

    try {
      const { rerender } = render(
        <HeaderBox projectName="Timeline project" projectId="project-1" />
      );
      const trigger = screen.getByRole('button', {
        name: 'Session settings: Timeline project',
      });
      await user.click(trigger);
      await user.click(
        screen.getByRole('menuitem', { name: 'Turn into skill' })
      );
      expect(requestChatDraft).toHaveBeenCalledWith(
        expect.stringContaining('#skill-creator'),
        undefined,
        { projectId: 'project-1', ifEmpty: true }
      );
      expect(requestChatDraft.mock.calls[0][0]).toContain(
        'Original request:\nOriginal request'
      );
      expect(requestChatDraft.mock.calls[0][0]).toContain(
        'Final result summary:\nFinal result'
      );

      await user.click(trigger);
      await user.click(
        screen.getByRole('menuitem', { name: 'Turn into automation' })
      );
      expect(
        screen.getByRole('dialog', { name: 'Automation draft' })
      ).toHaveTextContent('project-1: Original request');
      rerender(
        <HeaderBox projectName="Another session" projectId="project-2" />
      );
      expect(
        screen.getByRole('dialog', { name: 'Automation draft' })
      ).toHaveTextContent('project-1: Original request');
    } finally {
      act(() => {
        usePageTabStore.setState({
          requestWorkspaceChatDraft: originalRequestChatDraft,
        });
      });
    }
  });

  it('shows view and Narrative detail submenus, disabling detail for Trajectory', async () => {
    const user = userEvent.setup();
    render(
      <HeaderBox
        totalTokens={42}
        projectName="Timeline project"
        projectId="project-1"
      />
    );

    const trigger = screen.getByRole('button', {
      name: 'Session settings: Timeline project',
    });
    await user.click(trigger);
    const viewSettings = screen.getByRole('menuitem', {
      name: 'View settings Narrative',
    });
    const narrativeDetail = screen.getByRole('menuitem', {
      name: 'Narrative detail Compact',
    });
    expect(viewSettings.querySelector('.lucide-square-menu')).toBeTruthy();
    expect(
      narrativeDetail.querySelector('.lucide-rectangle-ellipsis')
    ).toBeTruthy();
    expect(viewSettings).toHaveAttribute('aria-haspopup', 'menu');
    expect(narrativeDetail).not.toHaveAttribute('aria-disabled', 'true');

    await user.click(narrativeDetail);
    expect(
      screen.getByRole('menuitemradio', { name: 'Compact' })
    ).toHaveAttribute('aria-checked', 'true');
    act(() => screen.getByRole('menuitemradio', { name: 'Expanded' }).focus());
    await user.keyboard('{Enter}');
    expect(usePageTabStore.getState().narrativeInformationDensity).toBe(
      'expanded'
    );

    await user.click(trigger);
    expect(
      screen.getByRole('menuitem', { name: 'Narrative detail Expanded' })
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('menuitem', { name: 'View settings Narrative' })
    );
    expect(
      screen.getByRole('menuitemradio', { name: 'Narrative' })
    ).toHaveAttribute('aria-checked', 'true');
    act(() =>
      screen.getByRole('menuitemradio', { name: 'Trajectory' }).focus()
    );
    await user.keyboard('{Enter}');
    expect(usePageTabStore.getState().chatTimelineDetailLevel).toBe(
      'trajectory'
    );
    await user.click(trigger);
    expect(
      screen.getByRole('menuitem', { name: 'View settings Trajectory' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Narrative detail Expanded' })
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows the Session trigger as selected only while its panel is open', async () => {
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
    await user.click(screen.getByRole('menuitem', { name: 'Pin' }));
    expect(useSessionControlsStore.getState().pinnedProjectIds).toEqual([
      'project-1',
    ]);
    expect(
      JSON.parse(localStorage.getItem('eigent-pinned-projects') ?? '[]')
    ).toEqual(['project-1']);
    await user.click(
      screen.getByRole('button', { name: 'Session settings: Timeline project' })
    );
    expect(screen.getByRole('menuitem', { name: 'Unpin' })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Rename session' }));
    expect(useSessionControlsStore.getState().request).toMatchObject({
      action: 'rename',
      projectId: 'project-1',
    });
    await user.click(
      screen.getByRole('button', { name: 'Session settings: Timeline project' })
    );
    await user.click(screen.getByRole('menuitem', { name: 'End session' }));
    expect(useSessionControlsStore.getState().request).toMatchObject({
      action: 'end',
      projectId: 'project-1',
    });
    await user.click(
      screen.getByRole('button', { name: 'Session settings: Timeline project' })
    );
    await user.click(screen.getByRole('menuitem', { name: 'Delete session' }));
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
    expect(
      screen.getByRole('menuitem', { name: 'End session' })
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('lets keyboard users open view settings and choose a mode', async () => {
    const user = userEvent.setup();
    render(<HeaderBox projectName="Timeline project" projectId="project-1" />);
    const trigger = screen.getByRole('button', {
      name: 'Session settings: Timeline project',
    });
    trigger.focus();
    await user.keyboard('{Enter}');
    const viewSettings = screen.getByRole('menuitem', {
      name: 'View settings Narrative',
    });
    act(() => viewSettings.focus());
    await user.keyboard('{ArrowRight}');
    expect(
      screen.getByRole('menuitemradio', { name: 'Narrative' })
    ).toHaveFocus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(usePageTabStore.getState().chatTimelineDetailLevel).toBe(
      'trajectory'
    );
  });
});
