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

const sessionExecutionMocks = vi.hoisted(() => ({ routeLoading: false }));

vi.mock('@/hooks/useSessionExecution', () => ({
  useSessionExecution: (projectId: string) => ({
    scope: { projectId, accountKey: 'legacy-test' },
    state: {
      route: sessionExecutionMocks.routeLoading
        ? null
        : { route: 'legacy', project_id: projectId },
      managed: false,
      error: null,
      loading: sessionExecutionMocks.routeLoading,
    },
  }),
}));

import Session from '@/components/Session';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chatBoxRenderCount: 0,
  reducedMotion: false,
  entrances: [] as {
    initial: unknown;
    transition: unknown;
    complete?: () => void;
  }[],
  projectMeta: {
    id: 'project-1',
    name: 'Project 1',
    mode: 'single_agent',
    metadata: {} as Record<string, unknown>,
  },
  pageState: {
    activeWorkspaceTab: 'project',
    setActiveWorkspaceTab: vi.fn(),
    closeSessionPreview: vi.fn(),
    setSessionPreviewProject: vi.fn(),
    sessionPreviewProjectId: 'project-1',
    sessionPreviewOpening: null as {
      projectId: string;
      requestId: number;
      immediate: boolean;
    } | null,
    sessionSidePanelToggleRequestId: 0,
    sessionSummaryOpenByProject: {} as Record<string, boolean>,
    setSessionSummaryOpen: vi.fn((id: string, open: boolean) => {
      mocks.pageState.sessionSummaryOpenByProject[id] = open;
    }),
    sessionTaskStartedProjectIds: {} as Record<string, true>,
    clearSessionTaskStarted: vi.fn((id: string) => {
      delete mocks.pageState.sessionTaskStartedProjectIds[id];
    }),
    previewSlice: { open: true, tabs: [], activeTabId: null },
  },
  projectState: {
    chatStoreAvailable: true,
    activeProjectId: 'project-1',
    getAllChatStores: vi.fn(() => []),
  },
  chatState: {
    activeTaskId: 'task-1',
    tasks: {
      'task-1': {
        status: 'finished',
        messages: [{ id: 'message-1', role: 'user', content: 'hello' }],
        hasMessages: true,
        tokens: 0,
      },
    },
    setSelectedFile: vi.fn(),
  },
}));

vi.mock('@/components/ChatBox', () => ({
  default: () => {
    mocks.chatBoxRenderCount += 1;
    return <div data-testid="chat-box" />;
  },
}));
vi.mock('@/components/Workspace', () => ({
  default: () => <div data-testid="workspace" />,
}));
vi.mock('@/components/Session/HeaderBox', () => ({
  HeaderBox: ({
    totalTokens,
    projectName,
    summary,
    showBack = true,
  }: {
    totalTokens?: number;
    projectName?: string | null;
    showBack?: boolean;
    summary?: {
      open: boolean;
      onToggle: () => void;
      popover?: React.ReactNode;
      popoverOpen?: boolean;
    };
  }) => (
    <div
      data-testid="session-header"
      data-total-tokens={totalTokens ?? 'unset'}
      data-project-name={projectName ?? 'unset'}
      data-show-back={showBack}
    >
      <button
        aria-label="Summary"
        aria-pressed={summary?.open}
        onClick={summary?.onToggle}
      />
      {summary?.popoverOpen ? <div role="dialog">{summary.popover}</div> : null}
    </div>
  ),
}));
vi.mock('@/components/Session/PreviewPanel', () => ({
  PreviewPanel: ({ displaySettled }: { displaySettled: boolean }) => (
    <div data-testid="preview-panel" data-settled={displaySettled} />
  ),
}));
vi.mock('@/components/Session/SidePanel', () => ({
  SessionSidePanel: () => <div data-testid="session-side-panel-content" />,
}));
vi.mock('@/hooks/useChatStoreAdapter', () => ({
  default: () => ({
    chatStore: mocks.projectState.chatStoreAvailable ? mocks.chatState : null,
    projectStore: mocks.projectState,
  }),
}));
vi.mock('@/hooks/useProjectEventRuntime', () => ({
  ProjectEventRuntimeProvider: ({ children }: { children: React.ReactNode }) =>
    children,
}));
vi.mock('@/lib/sessionMode', () => ({
  inferSessionModeFromTask: () => 'single_agent',
}));
vi.mock('@/store/pageTabStore', () => ({
  getSessionPreviewSlice: (state: typeof mocks.pageState) => state.previewSlice,
  NEW_SESSION_DRAFT_SCOPE: 'new-session-draft',
  usePageTabStore: (selector: (state: typeof mocks.pageState) => unknown) =>
    selector(mocks.pageState),
  WorkspaceTab: { Project: 'project', NewProject: 'new-project' },
}));
vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: (
    selector: (state: {
      historyLoadingProjectIds: Record<string, boolean>;
    }) => unknown
  ) => selector({ historyLoadingProjectIds: {} }),
}));
vi.mock('@/store/spaceStore', () => ({
  useSpaceStore: (
    selector: (state: {
      getProjectMeta: () => typeof mocks.projectMeta;
      updateProjectMeta: ReturnType<typeof vi.fn>;
    }) => unknown
  ) =>
    selector({
      getProjectMeta: () => mocks.projectMeta,
      updateProjectMeta: vi.fn(),
    }),
}));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  useReducedMotion: () => mocks.reducedMotion,
  motion: {
    div: ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      onAnimationComplete,
      layout: _layout,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & {
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
      onAnimationComplete?: () => void;
      layout?: unknown;
    }) => {
      mocks.entrances.push({
        initial: _initial,
        transition: _transition,
        complete: onAnimationComplete,
      });
      return <div {...props}>{children}</div>;
    },
  },
}));

let scheduledFrame: FrameRequestCallback | null = null;

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
  }
}

function rect(width: number): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    right: width,
    bottom: 800,
    left: 0,
    width,
    height: 800,
    toJSON: () => ({}),
  };
}

async function renderResizableSession() {
  render(<Session />);
  const separator = screen.getByRole('separator');
  const row = separator.parentElement?.parentElement;
  if (!row) throw new Error('missing Session row');

  expect(separator.parentElement).toHaveClass(
    'border-l-[length:var(--ds-border-thin)]',
    'border-ds-hairline-subtle-disabled'
  );
  expect(separator).toHaveClass('absolute');
  expect(separator).not.toHaveClass('px-ds-4');
  expect(separator).not.toHaveClass(
    'hover:bg-ds-accent-subtle-default',
    'after:bg-ds-accent-default-hover'
  );

  await waitFor(() =>
    expect(row.style.getPropertyValue('--session-chat-side-width')).toBe(
      '360px'
    )
  );

  Object.defineProperties(separator, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: {
      configurable: true,
      value: vi.fn(() => true),
    },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });

  fireEvent.pointerDown(separator, {
    button: 0,
    buttons: 1,
    clientX: 360,
    isPrimary: true,
    pointerId: 7,
  });
  await waitFor(() =>
    expect(separator).toHaveAttribute('data-resize-handle-state', 'drag')
  );

  return { row, separator };
}

describe('Session preview resize', () => {
  beforeEach(() => {
    vi.stubGlobal('PointerEvent', TestPointerEvent);
    vi.stubGlobal('innerWidth', 1600);
    mocks.chatBoxRenderCount = 0;
    mocks.reducedMotion = false;
    mocks.entrances = [];
    mocks.pageState.sessionPreviewOpening = null;
    mocks.projectMeta.name = 'Project 1';
    mocks.projectMeta.metadata = {};
    mocks.pageState.previewSlice.open = true;
    mocks.pageState.sessionSummaryOpenByProject = {};
    mocks.pageState.sessionTaskStartedProjectIds = {};
    mocks.pageState.setSessionSummaryOpen.mockClear();
    mocks.pageState.clearSessionTaskStarted.mockClear();
    mocks.pageState.closeSessionPreview.mockClear();
    mocks.pageState.setSessionPreviewProject.mockClear();
    mocks.projectState.activeProjectId = 'project-1';
    mocks.pageState.sessionPreviewProjectId = 'project-1';
    mocks.pageState.activeWorkspaceTab = 'project';
    mocks.projectState.chatStoreAvailable = true;
    sessionExecutionMocks.routeLoading = false;
    scheduledFrame = null;

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function () {
        return rect(this.id === 'session-side-panel' ? 0 : 1200);
      }
    );
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      scheduledFrame = callback;
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
      scheduledFrame = null;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('holds viewports until the 200ms geometry entrance completes', () => {
    render(<Session />);
    expect(screen.getByTestId('preview-panel')).toHaveAttribute(
      'data-settled',
      'false'
    );
    expect(mocks.entrances.at(-1)?.transition).toMatchObject({
      flexGrow: { type: 'tween', duration: 0.2, ease: [0.23, 1, 0.32, 1] },
      transform: { type: 'tween', duration: 0.2 },
    });
    act(() => mocks.entrances.at(-1)?.complete?.());
    expect(screen.getByTestId('preview-panel')).toHaveAttribute(
      'data-settled',
      'true'
    );
  });

  it.each(['shortcut', 'reduced motion'])(
    'releases immediate geometry after layout for %s without waiting for opacity',
    (input) => {
      mocks.reducedMotion = input === 'reduced motion';
      if (input === 'shortcut')
        mocks.pageState.sessionPreviewOpening = {
          projectId: 'project-1',
          requestId: 1,
          immediate: true,
        };
      render(<Session />);
      expect(screen.getByTestId('preview-panel')).toHaveAttribute(
        'data-settled',
        'false'
      );
      expect(mocks.entrances.at(-1)?.transition).toMatchObject({
        flexGrow: { duration: 0 },
        transform: { duration: 0 },
        opacity: { duration: input === 'shortcut' ? 0 : 0.2 },
      });
      act(() => {
        const frame = scheduledFrame;
        scheduledFrame = null;
        frame?.(0);
      });
      expect(screen.getByTestId('preview-panel')).toHaveAttribute(
        'data-settled',
        'true'
      );
    }
  );

  it('rejects stale completion after close/reopen and Session changes', () => {
    const { rerender } = render(<Session />);
    const firstComplete = mocks.entrances.at(-1)?.complete;
    mocks.pageState.previewSlice.open = false;
    rerender(<Session />);
    mocks.pageState.previewSlice.open = true;
    mocks.pageState.sessionPreviewOpening = {
      projectId: 'project-1',
      requestId: 2,
      immediate: false,
    };
    rerender(<Session />);
    act(() => firstComplete?.());
    expect(screen.getByTestId('preview-panel')).toHaveAttribute(
      'data-settled',
      'false'
    );
    const secondComplete = mocks.entrances.at(-1)?.complete;
    mocks.projectState.activeProjectId = 'project-2';
    mocks.pageState.sessionPreviewProjectId = 'project-2';
    mocks.pageState.sessionPreviewOpening = null;
    rerender(<Session />);
    act(() => secondComplete?.());
    expect(screen.getByTestId('preview-panel')).toHaveAttribute(
      'data-settled',
      'false'
    );
    act(() => mocks.entrances.at(-1)?.complete?.());
    expect(screen.getByTestId('preview-panel')).toHaveAttribute(
      'data-settled',
      'true'
    );
  });

  it('cancels immediate readiness on unmount and ignores old route completion', () => {
    mocks.reducedMotion = true;
    const { rerender, unmount } = render(<Session />);
    const firstFrame = scheduledFrame;
    mocks.pageState.activeWorkspaceTab = 'files';
    rerender(<Session />);
    act(() => firstFrame?.(0));
    expect(screen.getByTestId('preview-panel')).toHaveAttribute(
      'data-settled',
      'false'
    );
    mocks.pageState.activeWorkspaceTab = 'project';
    rerender(<Session />);
    const lastFrame = scheduledFrame;
    unmount();
    act(() => lastFrame?.(0));
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
  });

  it('renders while the active chat store rebuilds during route loading', () => {
    mocks.projectState.chatStoreAvailable = false;
    sessionExecutionMocks.routeLoading = true;

    render(<Session />);

    expect(screen.getByTestId('session-header')).toHaveAttribute(
      'data-total-tokens',
      '0'
    );
    expect(screen.getByTestId('chat-box')).toBeInTheDocument();
  });

  it('shows New session in the header for a system default Session name', () => {
    mocks.projectMeta.name = 'new project';

    render(<Session />);

    expect(screen.getByTestId('session-header')).toHaveAttribute(
      'data-project-name',
      'New session'
    );
  });

  it('keeps a Session name the user chose in the header', () => {
    render(<Session />);

    expect(screen.getByTestId('session-header')).toHaveAttribute(
      'data-project-name',
      'Project 1'
    );
  });

  it('shows the same history title as the Session list for a default name', () => {
    mocks.projectMeta.name = 'new project';
    mocks.projectMeta.metadata = { historyDisplayName: 'Plan the launch' };

    render(<Session />);

    expect(screen.getByTestId('session-header')).toHaveAttribute(
      'data-project-name',
      'Plan the launch'
    );
  });

  it('lays out the New session page with the Session header, centered composer and draft Preview', () => {
    mocks.pageState.activeWorkspaceTab = 'new-project';
    mocks.pageState.sessionPreviewProjectId = 'new-session-draft';
    render(<Session isNewProject />);

    expect(mocks.pageState.setSessionPreviewProject).toHaveBeenCalledWith(
      'new-session-draft'
    );
    expect(screen.getByTestId('session-header')).toHaveAttribute(
      'data-project-name',
      'New session'
    );
    expect(screen.getByTestId('session-header')).toHaveAttribute(
      'data-total-tokens',
      '0'
    );
    expect(screen.getByTestId('session-header')).toHaveAttribute(
      'data-show-back',
      'false'
    );
    expect(screen.getByTestId('workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-box')).not.toBeInTheDocument();
    expect(screen.getByTestId('preview-panel')).toBeInTheDocument();
    expect(screen.getByRole('separator')).toBeInTheDocument();

    // Same rule as a Session: no room beside Preview, so Activity opens over chat.
    fireEvent.click(screen.getByRole('button', { name: 'Summary' }));
    expect(screen.getByRole('dialog')).toContainElement(
      screen.getByTestId('session-side-panel-content')
    );
  });

  it('docks Summary on the New session page under the draft scope', () => {
    mocks.pageState.activeWorkspaceTab = 'new-project';
    mocks.pageState.sessionPreviewProjectId = 'new-session-draft';
    mocks.pageState.previewSlice.open = false;
    const { rerender } = render(<Session isNewProject />);
    fireEvent.click(screen.getByRole('button', { name: 'Summary' }));
    expect(mocks.pageState.setSessionSummaryOpen).toHaveBeenCalledWith(
      'new-session-draft',
      true
    );
    rerender(<Session isNewProject />);
    expect(
      screen.getByTestId('session-side-panel-content')
    ).toBeInTheDocument();
  });

  it('never shows the previous Session Preview on the New session page', () => {
    mocks.pageState.activeWorkspaceTab = 'new-project';
    render(<Session isNewProject />);
    expect(screen.queryByTestId('preview-panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('workspace')).toBeInTheDocument();
  });

  it('starts with Summary closed and leaves no folded rail', () => {
    render(<Session />);
    expect(screen.getByTestId('session-header')).toHaveAttribute(
      'data-show-back',
      'true'
    );
    expect(
      screen.queryByTestId('session-side-panel-content')
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Summary' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('renders chat, Summary, Preview in order and keeps their toggles independent', () => {
    mocks.pageState.sessionSummaryOpenByProject['project-1'] = true;
    const { rerender } = render(<Session />);
    const summary = screen.getByTestId('session-side-panel-content');
    const preview = screen.getByTestId('preview-panel');
    expect(
      screen.getByTestId('chat-box').compareDocumentPosition(summary) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      summary.compareDocumentPosition(preview) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    mocks.pageState.previewSlice.open = false;
    rerender(<Session />);
    expect(
      screen.getByTestId('session-side-panel-content')
    ).toBeInTheDocument();
    expect(screen.queryByTestId('preview-panel')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Summary' }));
    rerender(<Session />);
    expect(
      screen.queryByTestId('session-side-panel-content')
    ).not.toBeInTheDocument();
  });

  it('keeps the chat header above chat and Activity beside the full Preview column', () => {
    mocks.pageState.sessionSummaryOpenByProject['project-1'] = true;
    const { rerender } = render(<Session />);
    const header = screen.getByTestId('session-header');
    const chat = screen.getByTestId('chat-box');
    const summary = screen.getByTestId('session-side-panel-content');
    const preview = screen.getByTestId('preview-panel');
    const chatGroup = header.parentElement!;
    const body = header.nextElementSibling!;
    const row = chatGroup.parentElement!;

    expect(body).toContainElement(chat);
    expect(body).toContainElement(summary);
    expect(chatGroup).not.toContainElement(preview);
    expect(row).toContainElement(preview);
    expect(row).toHaveClass('flex-row');
    expect(chatGroup).toHaveStyle({
      width: 'var(--session-chat-side-width, 720px)',
    });

    mocks.pageState.sessionSummaryOpenByProject['project-1'] = false;
    rerender(<Session />);
    expect(chatGroup).toHaveStyle({
      width: 'var(--session-chat-side-width, 360px)',
    });
    mocks.pageState.previewSlice.open = false;
    rerender(<Session />);
    expect(chatGroup).toHaveClass('flex-1');
    expect(chatGroup.style.width).toBe('');
    expect(chatGroup).toContainElement(header);
    expect(chatGroup).toContainElement(chat);
  });

  it('hides Summary first without forgetting it, then closes Preview as the Session container narrows', () => {
    let resize: (() => void) | undefined;
    let width = 1200;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => rect(width)
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      }
    );
    mocks.pageState.sessionSummaryOpenByProject['project-1'] = true;
    render(<Session />);
    act(() => {
      width = 1000;
      resize?.();
    });
    expect(mocks.pageState.setSessionSummaryOpen).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('session-side-panel-content')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('preview-panel')).toBeInTheDocument();
    expect(screen.getByRole('separator')).toHaveAttribute(
      'aria-valuenow',
      '679'
    );
    expect(mocks.pageState.closeSessionPreview).not.toHaveBeenCalled();
    // Widening docks the remembered Summary again.
    act(() => {
      width = 1200;
      resize?.();
    });
    expect(
      screen.getByTestId('session-side-panel-content')
    ).toBeInTheDocument();
    expect(screen.getByRole('separator')).toHaveAttribute(
      'aria-valuenow',
      '720'
    );
    act(() => {
      width = 1000;
      resize?.();
    });
    act(() => {
      width = 681;
      resize?.();
    });
    expect(screen.getByTestId('preview-panel')).toBeInTheDocument();
    expect(screen.getByRole('separator')).toHaveAttribute(
      'aria-valuenow',
      '360'
    );
    act(() => {
      width = 680;
      resize?.();
    });
    expect(screen.queryByTestId('preview-panel')).not.toBeInTheDocument();
    expect(mocks.pageState.closeSessionPreview).toHaveBeenCalledOnce();
    expect(screen.getByTestId('chat-box')).toBeInTheDocument();
  });

  it('resizes the whole left side both ways, hides Activity without jumping, and keeps narrow access in a popover', () => {
    let resize: (() => void) | undefined;
    let width = 1400;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => rect(width)
    );
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      }
    );
    mocks.pageState.sessionSummaryOpenByProject['project-1'] = true;
    const { rerender } = render(<Session />);
    const separator = screen.getByRole('separator');
    const row = separator.parentElement!.parentElement!;
    const drag = (from: number, to: number) => {
      fireEvent.pointerDown(separator, {
        button: 0,
        buttons: 1,
        clientX: from,
        pointerId: 7,
      });
      fireEvent.pointerMove(window, { buttons: 1, clientX: to, pointerId: 7 });
      fireEvent.pointerUp(window, { pointerId: 7 });
    };
    expect(row.style.getPropertyValue('--session-chat-side-width')).toBe(
      '720px'
    );
    drag(720, 1000);
    expect(row.style.getPropertyValue('--session-chat-side-width')).toBe(
      '1000px'
    );
    expect(
      screen.getByTestId('session-side-panel-content')
    ).toBeInTheDocument();
    drag(1000, 700);
    expect(row.style.getPropertyValue('--session-chat-side-width')).toBe(
      '700px'
    );
    expect(
      screen.queryByTestId('session-side-panel-content')
    ).not.toBeInTheDocument();
    expect(mocks.pageState.setSessionSummaryOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Summary' }));
    expect(screen.getByRole('dialog')).toContainElement(
      screen.getByTestId('session-side-panel-content')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Summary' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Widening the left side docks the remembered Summary without a click.
    drag(700, 900);
    rerender(<Session />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.getByTestId('session-side-panel-content')
    ).toBeInTheDocument();
    fireEvent.pointerDown(separator, {
      button: 0,
      buttons: 1,
      clientX: 900,
      pointerId: 7,
    });
    act(() => {
      width = 1100;
      resize?.();
    });
    expect(row.style.getPropertyValue('--session-chat-side-width')).toBe(
      '779px'
    );
    expect(separator).toHaveAttribute('data-resize-handle-state', 'inactive');
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
  });

  it('opens Summary when a task starts in a wide Session with no saved choice', () => {
    mocks.pageState.previewSlice.open = false;
    mocks.pageState.sessionTaskStartedProjectIds['project-1'] = true;
    const { rerender } = render(<Session />);
    expect(mocks.pageState.clearSessionTaskStarted).toHaveBeenCalledWith(
      'project-1'
    );
    expect(mocks.pageState.setSessionSummaryOpen).toHaveBeenCalledOnce();
    expect(mocks.pageState.setSessionSummaryOpen).toHaveBeenCalledWith(
      'project-1',
      true
    );
    rerender(<Session />);
    expect(
      screen.getByTestId('session-side-panel-content')
    ).toBeInTheDocument();
  });

  it('keeps a saved closed Summary when a task starts', () => {
    mocks.pageState.previewSlice.open = false;
    mocks.pageState.sessionSummaryOpenByProject['project-1'] = false;
    mocks.pageState.sessionTaskStartedProjectIds['project-1'] = true;
    render(<Session />);
    expect(mocks.pageState.clearSessionTaskStarted).toHaveBeenCalledWith(
      'project-1'
    );
    expect(mocks.pageState.setSessionSummaryOpen).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId('session-side-panel-content')
    ).not.toBeInTheDocument();
  });

  it('does not open Summary when a task starts without room to dock it', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      rect(700)
    );
    mocks.pageState.sessionTaskStartedProjectIds['project-1'] = true;
    render(<Session />);
    expect(mocks.pageState.clearSessionTaskStarted).toHaveBeenCalledWith(
      'project-1'
    );
    expect(mocks.pageState.setSessionSummaryOpen).not.toHaveBeenCalled();
  });

  it('supports keyboard resizing to either limit and arrow adjustments', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      rect(1400)
    );
    render(<Session />);
    const separator = screen.getByRole('separator');
    const row = separator.parentElement!.parentElement!;
    expect(screen.getByTestId('session-header').parentElement).not.toHaveClass(
      'transition-[width]'
    );
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(row.style.getPropertyValue('--session-chat-side-width')).toBe(
      '392px'
    );
    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator).toHaveAttribute('aria-valuenow', '1079');
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(separator).toHaveAttribute('aria-valuenow', '1063');
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute('aria-valuenow', '1079');
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator).toHaveAttribute('aria-valuenow', '360');
    fireEvent.keyDown(separator, { key: 'ArrowLeft' });
    expect(separator).toHaveAttribute('aria-valuenow', '360');
  });

  it('restores each Session Summary without carrying it to another Session', () => {
    mocks.pageState.sessionSummaryOpenByProject = {
      'project-1': true,
      'project-2': false,
    };
    const { rerender } = render(<Session />);
    expect(
      screen.getByTestId('session-side-panel-content')
    ).toBeInTheDocument();
    mocks.projectState.activeProjectId = 'project-2';
    rerender(<Session />);
    expect(
      screen.queryByTestId('session-side-panel-content')
    ).not.toBeInTheDocument();
    mocks.projectState.activeProjectId = 'project-1';
    rerender(<Session />);
    expect(
      screen.getByTestId('session-side-panel-content')
    ).toBeInTheDocument();
  });

  it('coalesces pointer moves and ends a lost pointerup when no button is pressed', async () => {
    const { row, separator } = await renderResizableSession();
    const rendersAfterStart = mocks.chatBoxRenderCount;

    fireEvent.pointerMove(window, {
      buttons: 1,
      clientX: 430,
      pointerId: 7,
    });
    fireEvent.pointerMove(window, {
      buttons: 1,
      clientX: 500,
      pointerId: 7,
    });

    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    expect(mocks.chatBoxRenderCount).toBe(rendersAfterStart);
    expect(screen.getByTestId('chat-box')).toBeInTheDocument();
    expect(
      document.querySelector('[data-preview-resize-shield]')
    ).not.toBeNull();

    act(() => {
      const frame = scheduledFrame;
      scheduledFrame = null;
      frame?.(0);
    });
    expect(row.style.getPropertyValue('--session-chat-side-width')).toBe(
      '500px'
    );
    expect(separator).toHaveAttribute('aria-valuenow', '500');
    expect(mocks.chatBoxRenderCount).toBe(rendersAfterStart);
    fireEvent.pointerMove(window, { buttons: 1, clientX: 550, pointerId: 7 });
    act(() => {
      const frame = scheduledFrame;
      scheduledFrame = null;
      frame?.(16);
    });
    expect(row.style.getPropertyValue('--session-chat-side-width')).toBe(
      '550px'
    );
    expect(separator).toHaveAttribute('aria-valuenow', '550');
    expect(mocks.chatBoxRenderCount).toBe(rendersAfterStart);

    fireEvent.pointerMove(window, {
      buttons: 0,
      clientX: 500,
      pointerId: 7,
    });

    await waitFor(() =>
      expect(separator).toHaveAttribute('data-resize-handle-state', 'inactive')
    );
    expect(document.querySelector('[data-preview-resize-shield]')).toBeNull();
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
    expect(separator.releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it('updates only at Activity threshold crossings and preserves live width through unrelated renders', () => {
    const { rerender } = render(<Session />);
    const separator = screen.getByRole('separator');
    const row = separator.parentElement!.parentElement!;
    fireEvent.pointerDown(separator, {
      button: 0,
      buttons: 1,
      clientX: 360,
      pointerId: 7,
    });
    const move = (width: number) => {
      fireEvent.pointerMove(window, {
        buttons: 1,
        clientX: width,
        pointerId: 7,
      });
      act(() => {
        const frame = scheduledFrame;
        scheduledFrame = null;
        frame?.(0);
      });
      expect(row.style.getPropertyValue('--session-chat-side-width')).toBe(
        `${width}px`
      );
      expect(separator).toHaveAttribute('aria-valuenow', String(width));
    };
    const initialRenders = mocks.chatBoxRenderCount;
    move(650);
    move(700);
    expect(mocks.chatBoxRenderCount).toBe(initialRenders);
    move(730);
    const aboveRenders = mocks.chatBoxRenderCount;
    expect(aboveRenders).toBeGreaterThan(initialRenders);
    move(750);
    move(760);
    expect(mocks.chatBoxRenderCount).toBe(aboveRenders);
    mocks.projectMeta.name = 'Updated during drag';
    rerender(<Session />);
    expect(row.style.getPropertyValue('--session-chat-side-width')).toBe(
      '760px'
    );
    expect(separator).toHaveAttribute('aria-valuenow', '760');
    move(710);
    const belowRenders = mocks.chatBoxRenderCount;
    move(680);
    expect(mocks.chatBoxRenderCount).toBe(belowRenders);
    fireEvent.pointerUp(window, { pointerId: 7 });
    expect(separator).toHaveAttribute('aria-valuenow', '680');
  });

  it.each([
    [
      'pointer cancellation',
      (_separator: HTMLElement) =>
        fireEvent.pointerCancel(window, { pointerId: 7 }),
    ],
    [
      'capture loss',
      (separator: HTMLElement) =>
        separator.dispatchEvent(new Event('lostpointercapture')),
    ],
    [
      'window blur',
      (_separator: HTMLElement) => window.dispatchEvent(new Event('blur')),
    ],
  ])('ends resize on %s', async (_label, endDrag) => {
    const { separator } = await renderResizableSession();

    act(() => endDrag(separator));

    await waitFor(() =>
      expect(separator).toHaveAttribute('data-resize-handle-state', 'inactive')
    );
    expect(document.querySelector('[data-preview-resize-shield]')).toBeNull();
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
  });
});
