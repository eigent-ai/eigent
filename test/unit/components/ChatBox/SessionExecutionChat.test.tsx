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

import { useSessionArtifactPreview } from '@/components/ChatBox/SessionArtifactPreview';
import { SessionExecutionChat } from '@/components/ChatBox/SessionExecutionChat';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({
  state: {} as any,
  handoff: null as any,
  submit: vi.fn(),
  cancel: vi.fn(),
  sendNow: vi.fn(),
  refresh: vi.fn(),
  hydrate: vi.fn(),
  artifacts: vi.fn(),
  read: vi.fn(),
}));
vi.mock('@/hooks/useSessionExecution', () => ({
  useSessionExecution: () => ({ scope: stableScope, state: mocks.state }),
}));
vi.mock('@/hooks/useProjectEventRuntime', () => ({
  useProjectEventRuntime: () => ({ hydration: { retry: mocks.hydrate } }),
}));
vi.mock('@/store/pageTabStore', () => ({
  usePageTabStore: (select: any) =>
    select({ workspaceChatDraftRequest: mocks.handoff }),
}));
vi.mock('@/store/sessionExecutionStore', () => ({
  refreshSessionExecution: mocks.refresh,
  loadMoreSessionExecutions: vi.fn(),
}));
vi.mock('@/service/sessionMessage', () => ({
  submitSessionMessage: mocks.submit,
  sessionMessageConfiguration: () => ({}),
}));
vi.mock('@/service/executionApi', () => ({
  assertExecutionScope: () => undefined,
  createSessionMessageIntent: (scope: any, content: string, kind: string) => ({
    scope,
    content,
    kind,
    requestId: 'stable-request',
    deliveryAttempted: false,
  }),
  cancelSessionExecution: mocks.cancel,
  sendSessionExecutionNow: mocks.sendNow,
  fetchExecutionArtifacts: mocks.artifacts,
  readExecutionArtifact: mocks.read,
}));
vi.mock('@/components/ChatBox/BottomBox/BoxFooter', () => ({
  BoxFooter: () => <div />,
}));
vi.mock('@/components/ChatBox/EventNativeProjectTimeline', () => ({
  EventNativeProjectTimeline: () => <ArtifactButtons />,
}));
const stableScope = { projectId: 'session', accountKey: 'synthetic-account' };
function ArtifactButtons() {
  const open = useSessionArtifactPreview();
  return (
    <>
      {['first', 'second'].map((run) => (
        <button
          key={run}
          onClick={() =>
            open?.(run, {
              name: 'same.txt',
              path: '/must-not-use/current-space/same.txt',
              type: 'txt',
              artifactId: run,
            })
          }
        >
          Open {run}
        </button>
      ))}
    </>
  );
}
const innerTextDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'innerText'
);
beforeAll(() => {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as any;
  Object.defineProperty(HTMLElement.prototype, 'innerText', {
    configurable: true,
    get() {
      return this.textContent || '';
    },
    set(value: string) {
      this.textContent = value;
    },
  });
});
afterAll(() => {
  if (innerTextDescriptor)
    Object.defineProperty(
      HTMLElement.prototype,
      'innerText',
      innerTextDescriptor
    );
  else delete (HTMLElement.prototype as any).innerText;
});
const input = () => screen.getByRole('textbox');
function type(text: string) {
  const node = input();
  node.textContent = text;
  fireEvent.input(node);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = {
    route: { entry_enabled: true, eligible: true, has_requests: true },
    managed: true,
    requests: [],
    revision: 'empty',
    nextCursor: null,
    error: null,
  };
  mocks.handoff = null;
  mocks.submit.mockResolvedValue({});
  mocks.cancel.mockResolvedValue({});
  mocks.sendNow.mockResolvedValue({});
  mocks.artifacts.mockImplementation(async (_scope, run) => ({
    artifacts: [
      {
        artifact_id: run,
        filename: 'same.txt',
        checkpoint_revision: 'revision-' + run,
        size: 5,
      },
    ],
  }));
  mocks.read.mockImplementation(async (_scope, run) => ({
    text: async () => run,
    size: 5,
  }));
});
afterEach(cleanup);

describe('managed Session composer and fixed artifact preview', () => {
  it.each(['light', 'dark'])(
    'keeps a failed draft and retries the identical intent in %s theme',
    async (theme) => {
      document.documentElement.dataset.theme = theme;
      mocks.submit.mockImplementationOnce(async (intent) => {
        intent.deliveryAttempted = true;
        throw new Error('lost ack');
      });
      render(<SessionExecutionChat projectId="session" />);
      type('Keep this draft');
      fireEvent.keyDown(input(), { key: 'Enter', code: 'Enter' });
      await screen.findByRole('alert');
      expect(input()).toHaveTextContent('Keep this draft');
      const first = mocks.submit.mock.calls[0][0];
      await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
      expect(mocks.submit.mock.calls[1][0]).toBe(first);
      await waitFor(() => expect(input()).toHaveTextContent(''));
      expect(mocks.hydrate).toHaveBeenCalled();
    }
  );
  it('observes cancellation instead of removing the active task optimistically', async () => {
    mocks.state.requests = [
      {
        request_id: 'active',
        content: 'long '.repeat(300),
        status: 'admitted',
        admitted_run_id: 'active',
        settlement: null,
        cancel_requested: false,
        created_at: 1,
      },
    ];
    const { rerender } = render(<SessionExecutionChat projectId="session" />);
    await userEvent.click(screen.getByRole('button', { name: 'Stop task' }));
    expect(mocks.cancel).toHaveBeenCalledWith(
      expect.objectContaining(stableScope),
      'active'
    );
    expect(screen.getByText(/long long/)).toBeInTheDocument();
    mocks.state = {
      ...mocks.state,
      requests: [{ ...mocks.state.requests[0], cancel_requested: true }],
    };
    rerender(<SessionExecutionChat projectId="session" />);
    expect(screen.getByRole('button', { name: 'Stop task' })).toBeDisabled();
    expect(
      screen.getByText('Stopping the task and saving its results…')
    ).toBeInTheDocument();
  });
  it('shows retained unsupported handoff and keeps legacy execution unmounted', () => {
    mocks.handoff = {
      projectId: 'session',
      content: 'Retain review feedback',
      reviewHandoffIds: ['handoff'],
    };
    render(<SessionExecutionChat projectId="session" />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Retain review feedback'
    );
    expect(input()).toHaveAttribute('contenteditable', 'false');
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it('opens same-named files by Run/artifact identity, escapes content, and restores keyboard focus', async () => {
    mocks.read.mockImplementation(async (_scope, run) => ({
      text: async () => (run === 'first' ? '<script>first</script>' : 'second'),
      size: 5,
    }));
    render(<SessionExecutionChat projectId="session" />);
    const first = screen.getByRole('button', { name: 'Open first' });
    await userEvent.click(first);
    await screen.findByText('<script>first</script>');
    expect(document.querySelector('script')).toBeNull();
    expect(
      screen.getByText('Saved task version: revision-first')
    ).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    expect(first).toHaveFocus();
    // The same filename resolves through the second Run, never through path.
    await userEvent.click(screen.getByRole('button', { name: 'Open second' }));
    await screen.findByText('second');
    expect(mocks.read.mock.calls.map((args) => args.slice(1))).toEqual([
      ['first', 'first'],
      ['second', 'second'],
    ]);
    expect(
      screen.getByText('Saved task version: revision-second')
    ).toBeInTheDocument();
  });
  it('rejects pasted and dropped attachments before reading files and retains typed text', () => {
    render(<SessionExecutionChat projectId="session" />);
    expect(
      screen.queryByRole('button', { name: 'Add connectors' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add skills' })
    ).not.toBeInTheDocument();
    type('keep text');
    const file = new File(['synthetic'], 'blocked.txt', { type: 'text/plain' });
    const read = vi.spyOn(FileReader.prototype, 'readAsDataURL');
    fireEvent.paste(input(), {
      clipboardData: {
        items: [{ kind: 'file', type: 'text/plain', getAsFile: () => file }],
        files: [file],
        getData: () => '',
      },
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.drop(input(), {
      dataTransfer: {
        files: [file],
        items: [{ kind: 'file' }],
        types: ['Files'],
      },
    });
    expect(input()).toHaveTextContent('keep text');
    expect(read).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
    read.mockRestore();
  });
  it('announces empty and unavailable saved files', async () => {
    mocks.read.mockResolvedValueOnce({ text: async () => '', size: 0 });
    render(<SessionExecutionChat projectId="session" />);
    await userEvent.click(screen.getByRole('button', { name: 'Open first' }));
    await screen.findByText('This saved file is empty.');
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    );
    mocks.read.mockRejectedValueOnce(new Error('Missing'));
    await userEvent.click(screen.getByRole('button', { name: 'Open second' }));
    await screen.findByText(
      'This saved file is missing, unavailable, or cannot be previewed as text.'
    );
  });
});
