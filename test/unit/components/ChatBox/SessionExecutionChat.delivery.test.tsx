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

import { SessionExecutionChat } from '@/components/ChatBox/SessionExecutionChat';
import {
  createSessionMessageIntent,
  deliverSessionMessage,
  executionScope,
} from '@/service/executionApi';
import { resetSessionDrafts } from '@/store/sessionDraftStore';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
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

/**
 * Uses the real delivery function and the real HTTP request preparation, so
 * it covers the gap between pressing Send and the request leaving the app.
 */
const mocks = vi.hoisted(() => ({
  state: {} as any,
  submit: vi.fn(),
  capability: vi.fn(),
}));
vi.mock('@/hooks/useSessionExecution', () => ({
  useSessionExecution: () => ({ scope: stableScope, state: mocks.state }),
}));
vi.mock('@/hooks/useProjectEventRuntime', () => ({
  useProjectEventRuntime: () => ({ hydration: { retry: vi.fn() } }),
}));
vi.mock('@/store/pageTabStore', () => ({
  usePageTabStore: (select: any) => select({ workspaceChatDraftRequest: null }),
}));
vi.mock('@/store/sessionExecutionStore', () => ({
  refreshSessionExecution: vi.fn(),
  loadMoreSessionExecutions: vi.fn(),
}));
vi.mock('@/service/sessionMessage', () => ({
  submitSessionMessage: mocks.submit,
  sessionMessageConfiguration: () => ({}),
}));
vi.mock('@/host/createHost', () => ({
  createHost: () => ({
    ipcRenderer: { invoke: async () => 5001 },
    electronAPI: { getLocalControlCapability: mocks.capability },
  }),
}));
vi.mock('@/components/ChatBox/BottomBox/BoxFooter', () => ({
  BoxFooter: () => <div />,
}));
vi.mock('@/components/ChatBox/EventNativeProjectTimeline', () => ({
  EventNativeProjectTimeline: () => <div />,
}));

const stableScope = executionScope('session');
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
  resetSessionDrafts();
  mocks.state = {
    route: { entry_enabled: true, eligible: true, has_requests: true },
    managed: true,
    requests: [],
    revision: 'empty',
    nextCursor: null,
    error: null,
  };
  mocks.submit.mockImplementation(async (intent) => {
    // Skip only configuration preparation; delivery and HTTP are real.
    intent.body = Object.freeze({
      request_id: intent.requestId,
      kind: intent.kind,
    });
    return deliverSessionMessage(intent);
  });
});
afterEach(cleanup);

describe('managed Session delivery', () => {
  it('keeps the draft when leaving the Session stops the send before the request is sent', async () => {
    let releaseHeaders!: (token: string) => void;
    mocks.capability.mockReturnValue(
      new Promise<string>((resolve) => {
        releaseHeaders = resolve;
      })
    );
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('no request may be sent'));
    try {
      const view = render(
        <SessionExecutionChat key="a" projectId="session-a" />
      );
      type('Draft that never reached the server');
      fireEvent.keyDown(input(), { key: 'Enter', code: 'Enter' });
      await waitFor(() => expect(mocks.capability).toHaveBeenCalled());
      const intent = mocks.submit.mock.calls[0][0];
      expect(intent.deliveryAttempted).toBe(false);

      view.rerender(<SessionExecutionChat key="b" projectId="session-b" />);
      await act(async () => {
        releaseHeaders('synthetic-capability');
      });
      expect(intent.scope.signal.aborted).toBe(true);
      expect(network).not.toHaveBeenCalled();
      expect(intent.deliveryAttempted).toBe(false);

      view.rerender(<SessionExecutionChat key="a" projectId="session-a" />);
      expect(input()).toHaveTextContent('Draft that never reached the server');
    } finally {
      network.mockRestore();
    }
  });

  // The local capability header is cached after its first lookup, so this
  // runs after the test that holds that lookup open.
  it('marks the delivery as attempted by the time the request is sent', async () => {
    mocks.capability.mockResolvedValue('synthetic-capability');
    const intent = createSessionMessageIntent(
      executionScope('session-a'),
      'hello',
      'start'
    );
    intent.body = Object.freeze({
      request_id: intent.requestId,
      kind: intent.kind,
    }) as any;
    const markedWhenSent: boolean[] = [];
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => {
        markedWhenSent.push(intent.deliveryAttempted);
        throw new TypeError('response lost');
      });
    try {
      await expect(deliverSessionMessage(intent)).rejects.toThrow();
      // A sent request whose response was lost must not be sent as new.
      expect(markedWhenSent).toEqual([true]);
      expect(intent.deliveryAttempted).toBe(true);
    } finally {
      network.mockRestore();
    }
  });
});
