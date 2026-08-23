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

import Session from '@/components/Session';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chatBoxRenderCount: 0,
  pageState: {
    activeWorkspaceTab: 'project',
    setActiveWorkspaceTab: vi.fn(),
    closeSessionPreview: vi.fn(),
    setSessionPreviewProject: vi.fn(),
    sessionPreviewProjectId: 'project-1',
    sessionSidePanelToggleRequestId: 0,
    previewSlice: { open: true, tabs: [], activeTabId: null },
  },
  projectState: {
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
  HeaderBox: () => <div data-testid="session-header" />,
}));
vi.mock('@/components/Session/PreviewPanel', () => ({
  PreviewPanel: () => <div data-testid="preview-panel" />,
}));
vi.mock('@/components/Session/SidePanel', () => ({
  SessionSidePanel: () => <div data-testid="session-side-panel-content" />,
}));
vi.mock('@/hooks/useChatStoreAdapter', () => ({
  default: () => ({
    chatStore: mocks.chatState,
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
  usePageTabStore: (selector: (state: typeof mocks.pageState) => unknown) =>
    selector(mocks.pageState),
  WorkspaceTab: { Project: 'project' },
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
      getProjectMeta: () => { name: string; mode: string; metadata: object };
      updateProjectMeta: ReturnType<typeof vi.fn>;
    }) => unknown
  ) =>
    selector({
      getProjectMeta: () => ({
        name: 'Project 1',
        mode: 'single_agent',
        metadata: {},
      }),
      updateProjectMeta: vi.fn(),
    }),
}));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  useReducedMotion: () => false,
  motion: {
    div: ({
      children,
      initial: _initial,
      animate: _animate,
      exit: _exit,
      transition: _transition,
      layout: _layout,
      ...props
    }: React.HTMLAttributes<HTMLDivElement> & {
      initial?: unknown;
      animate?: unknown;
      exit?: unknown;
      transition?: unknown;
      layout?: unknown;
    }) => <div {...props}>{children}</div>,
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

  expect(separator).toHaveClass('after:opacity-0', 'hover:after:opacity-100');
  expect(separator).not.toHaveClass(
    'hover:bg-ds-accent-subtle-default',
    'after:bg-ds-accent-default-hover'
  );

  await waitFor(() =>
    expect(row.style.getPropertyValue('--session-chat-width')).toBe('360px')
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
    mocks.chatBoxRenderCount = 0;
    mocks.pageState.previewSlice.open = true;
    mocks.pageState.sessionPreviewProjectId = 'project-1';
    mocks.pageState.activeWorkspaceTab = 'project';
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

  afterAll(() => {
    vi.unstubAllGlobals();
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
    expect(row.style.getPropertyValue('--session-chat-width')).toBe('500px');

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
