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
import { useState } from 'react';
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
    expect(items.map((item) => item.textContent)).toEqual([
      'Turn into skill',
      'Turn into automation',
      'Pin',
      'Rename session',
      'End session',
      'Delete session',
    ]);
    expect(items[1].querySelector('.lucide-zap')).toBeTruthy();
    expect(items[0].closest('[role="menu"]')).toHaveClass('w-56');
    expect(items[0]).toHaveAttribute('aria-disabled', 'true');
    expect(items[1]).toHaveAttribute('aria-disabled', 'true');
    // A separator divides the Task actions from the Session actions.
    expect(items[1].nextElementSibling).toHaveAttribute('role', 'separator');
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
        'project-1',
        { ifEmpty: true }
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

  it('shows the Session trigger as selected only while its menu is open', async () => {
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

  it('hides Back, the timeline style, and Session actions on the New session header', () => {
    render(
      <HeaderBox
        projectName="New session"
        showBack={false}
        showTimelineStyle={false}
      />
    );
    expect(
      screen.queryByRole('button', { name: 'Back' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('tablist', { name: 'Chat timeline style' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Session settings/ })
    ).not.toBeInTheDocument();
    expect(screen.getByText('New session')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open preview' })
    ).toBeInTheDocument();
  });

  it('shows Back on a Session header', () => {
    render(<HeaderBox projectName="Timeline project" />);
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('places the mode toggle between token usage and preview controls', () => {
    render(<HeaderBox totalTokens={42} projectName="Timeline project" />);

    const tokenLabel = screen.getByText(/Total:/);
    const toggle = screen.getByRole('tablist', {
      name: 'Chat timeline style',
    });
    const previewButton = screen.getByRole('button', {
      name: 'Open preview',
    });

    expect(
      tokenLabel.compareDocumentPosition(toggle) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      toggle.compareDocumentPosition(previewButton) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('puts the Summary toggle next to Preview with keyboard focus and pressed state', async () => {
    const user = userEvent.setup();
    const toggle = vi.fn();
    const { rerender } = render(
      <HeaderBox summary={{ open: false, onToggle: toggle }} />
    );
    const summary = screen.getByRole('button', { name: 'Summary' });
    const preview = screen.getByRole('button', { name: 'Open preview' });
    expect(summary).toHaveAttribute('aria-pressed', 'false');
    expect(
      summary.compareDocumentPosition(preview) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    act(() => summary.focus());
    await user.keyboard('{Enter}');
    expect(toggle).toHaveBeenCalledOnce();
    rerender(<HeaderBox summary={{ open: true, onToggle: toggle }} />);
    expect(summary).toHaveAttribute('aria-pressed', 'true');
    expect(summary).toHaveFocus();
    await user.tab();
    expect(preview).toHaveFocus();
  });

  it('opens Activity over chat from the same icon and restores focus after Escape', async () => {
    const user = userEvent.setup();
    function NarrowHeader() {
      const [open, setOpen] = useState(false);
      return (
        <HeaderBox
          summary={{
            open: false,
            onToggle: () => {},
            popover: <button>Activity content</button>,
            popoverOpen: open,
            onPopoverOpenChange: setOpen,
          }}
        />
      );
    }
    render(<NarrowHeader />);
    const summary = screen.getByRole('button', { name: 'Summary' });
    await user.click(summary);
    expect(screen.getByRole('dialog', { name: 'Summary' })).toContainElement(
      screen.getByRole('button', { name: 'Activity content' })
    );
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(summary).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Summary' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open preview' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens Preview immediately from the keyboard and animates the next pointer opening', async () => {
    const user = userEvent.setup();
    usePageTabStore.setState({
      sessionPreviewProjectId: 'keyboard-test',
      sessionPreviewByProject: {},
      sessionPreviewOpening: null,
    });
    render(<HeaderBox />);
    const preview = screen.getByRole('button', { name: 'Open preview' });
    act(() => preview.focus());
    await user.keyboard('{Enter}');
    expect(usePageTabStore.getState().sessionPreviewOpening).toMatchObject({
      immediate: true,
    });
    expect(preview).toHaveFocus();
    await user.click(preview);
    await user.click(preview);
    expect(usePageTabStore.getState().sessionPreviewOpening).toMatchObject({
      immediate: false,
    });
    act(() =>
      usePageTabStore.setState({
        sessionPreviewProjectId: null,
        sessionPreviewByProject: {},
        sessionPreviewOpening: null,
      })
    );
  });

  it('offers exactly the two timeline modes as a segmented control', () => {
    render(<HeaderBox totalTokens={42} />);

    const options = screen.getAllByRole('tab');
    expect(options.map((option) => option.getAttribute('aria-label'))).toEqual([
      'Narrative',
      'Trajectory',
    ]);
    expect(screen.getByRole('tab', { name: 'Narrative' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('hides token usage when the Session pane shrinks and keeps the menu and right-side controls', () => {
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
      screen.getByRole('tablist', { name: 'Chat timeline style' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Open preview' })
    ).toBeInTheDocument();
  });

  it('switches the event timeline presentation from the toggle', async () => {
    const user = userEvent.setup();
    render(<HeaderBox totalTokens={42} />);

    await user.click(screen.getByRole('tab', { name: 'Trajectory' }));

    expect(usePageTabStore.getState().chatTimelineDetailLevel).toBe(
      'trajectory'
    );
    expect(screen.getByRole('tab', { name: 'Trajectory' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('tab', { name: 'Narrative' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });
});
