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

import { WindowCloseProvider } from '@/components/Layout/WindowCloseProvider';
import { HostProvider, type AppHost } from '@/host';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasAnyActiveRun: vi.fn(),
}));

vi.mock('@/components/Dialog/CloseNotice', () => ({
  default: ({
    open,
    onOpenChange,
    onConfirm,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
  }) =>
    open ? (
      <div>
        <button onClick={() => onOpenChange(false)}>Cancel close</button>
        <button
          onClick={() => {
            onConfirm();
            onOpenChange(false);
          }}
        >
          Confirm close
        </button>
      </div>
    ) : null,
}));
vi.mock('@/hooks/useChatStoreAdapter', () => ({
  default: () => ({
    chatStore: null,
  }),
}));
vi.mock('@/store/chatStore', () => ({
  hasAnyActiveRun: mocks.hasAnyActiveRun,
}));

function renderProvider() {
  let closeRequestListener:
    | ((request: { intent: 'close-window' | 'quit-app' }) => void)
    | undefined;
  const respondToCloseRequest = vi.fn();
  const unsubscribe = vi.fn(() => {
    closeRequestListener = undefined;
  });
  const onCloseRequest = vi.fn((listener) => {
    closeRequestListener = listener;
    return unsubscribe;
  });
  const host: AppHost = {
    electronAPI: { onCloseRequest, respondToCloseRequest },
    ipcRenderer: null,
  };

  const view = render(
    <HostProvider host={host}>
      <WindowCloseProvider>
        <span>Workspace</span>
      </WindowCloseProvider>
    </HostProvider>
  );

  const emitCloseRequest = (intent: 'close-window' | 'quit-app') => {
    closeRequestListener?.({ intent });
  };

  return {
    emitCloseRequest,
    onCloseRequest,
    respondToCloseRequest,
    unsubscribe,
    view,
  };
}

describe('WindowCloseProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('confirms immediately when no run is active', () => {
    mocks.hasAnyActiveRun.mockReturnValue(false);
    const { emitCloseRequest, respondToCloseRequest } = renderProvider();

    act(() => emitCloseRequest('quit-app'));

    expect(respondToCloseRequest).toHaveBeenCalledWith({
      intent: 'quit-app',
      action: 'confirm',
    });
    expect(screen.queryByRole('button', { name: 'Confirm close' })).toBeNull();
  });

  it('preserves the request intent through cancel and confirm without a duplicate cancel', async () => {
    const user = userEvent.setup();
    mocks.hasAnyActiveRun.mockReturnValue(true);
    const { emitCloseRequest, respondToCloseRequest } = renderProvider();

    act(() => emitCloseRequest('close-window'));
    expect(respondToCloseRequest).toHaveBeenLastCalledWith({
      intent: 'close-window',
      action: 'acknowledge',
    });
    await user.click(screen.getByRole('button', { name: 'Cancel close' }));

    expect(respondToCloseRequest).toHaveBeenLastCalledWith({
      intent: 'close-window',
      action: 'cancel',
    });

    act(() => emitCloseRequest('quit-app'));
    expect(respondToCloseRequest).toHaveBeenLastCalledWith({
      intent: 'quit-app',
      action: 'acknowledge',
    });
    await user.click(screen.getByRole('button', { name: 'Confirm close' }));

    expect(respondToCloseRequest).toHaveBeenLastCalledWith({
      intent: 'quit-app',
      action: 'confirm',
    });
    expect(respondToCloseRequest).toHaveBeenCalledTimes(4);
  });

  it('uses the latest Quit intent when it replaces an open Close request', async () => {
    const user = userEvent.setup();
    mocks.hasAnyActiveRun.mockReturnValue(true);
    const { emitCloseRequest, respondToCloseRequest } = renderProvider();

    act(() => emitCloseRequest('close-window'));
    act(() => emitCloseRequest('quit-app'));
    await user.click(screen.getByRole('button', { name: 'Confirm close' }));

    expect(respondToCloseRequest).toHaveBeenNthCalledWith(1, {
      intent: 'close-window',
      action: 'acknowledge',
    });
    expect(respondToCloseRequest).toHaveBeenNthCalledWith(2, {
      intent: 'quit-app',
      action: 'acknowledge',
    });
    expect(respondToCloseRequest).toHaveBeenNthCalledWith(3, {
      intent: 'quit-app',
      action: 'confirm',
    });
  });

  it('runs its exact cleanup and leaves no stale handler on unmount', () => {
    mocks.hasAnyActiveRun.mockReturnValue(false);
    const {
      emitCloseRequest,
      onCloseRequest,
      respondToCloseRequest,
      unsubscribe,
      view,
    } = renderProvider();

    expect(onCloseRequest).toHaveBeenCalledOnce();

    view.unmount();

    expect(unsubscribe).toHaveBeenCalledOnce();
    act(() => emitCloseRequest('quit-app'));
    expect(respondToCloseRequest).not.toHaveBeenCalled();
  });
});
