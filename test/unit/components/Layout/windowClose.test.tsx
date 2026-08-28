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
import type { CloseExecutionClass } from '@/shared/windowClose';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assessCloseRunState: vi.fn(),
  hasAnyActiveLegacySSEConnection: vi.fn(),
  spaceState: {
    getProjectsForSpace: vi.fn(),
  },
  runtimeState: {
    projects: {} as Record<string, object>,
  },
}));

vi.mock('@/components/Dialog/CloseNotice', () => ({
  default: ({
    open,
    intent,
    executionClass,
    onOpenChange,
    onConfirm,
  }: {
    open: boolean;
    intent: 'close-window' | 'quit-app';
    executionClass: CloseExecutionClass;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
  }) =>
    open ? (
      <div>
        <span>{`${intent}:${executionClass}`}</span>
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
  default: () => ({ chatStore: null }),
}));
vi.mock('@/service/runCloseGuard', () => ({
  assessCloseRunState: mocks.assessCloseRunState,
}));
vi.mock('@/store/chatStore', () => ({
  hasAnyActiveLegacySSEConnection: mocks.hasAnyActiveLegacySSEConnection,
}));
vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: {
    getState: () => mocks.runtimeState,
  },
}));
vi.mock('@/store/spaceStore', () => ({
  useSpaceStore: {
    getState: () => mocks.spaceState,
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function renderProvider() {
  let closeRequestListener:
    ((request: { intent: 'close-window' | 'quit-app' }) => void) | undefined;
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
    mocks.assessCloseRunState.mockResolvedValue('idle');
    mocks.hasAnyActiveLegacySSEConnection.mockReturnValue(false);
    mocks.spaceState.getProjectsForSpace.mockReturnValue([{ id: 'project-1' }]);
    mocks.runtimeState.projects = {};
  });

  it('acknowledges first, then confirms after the canonical registry is idle', async () => {
    const { emitCloseRequest, respondToCloseRequest } = renderProvider();

    act(() => emitCloseRequest('quit-app'));

    expect(respondToCloseRequest).toHaveBeenCalledWith({
      intent: 'quit-app',
      action: 'acknowledge',
    });
    await waitFor(() =>
      expect(respondToCloseRequest).toHaveBeenLastCalledWith({
        intent: 'quit-app',
        action: 'confirm',
      })
    );
    expect(screen.queryByRole('button', { name: 'Confirm close' })).toBeNull();
  });

  it('queries every known local Project and includes the legacy lane signal', async () => {
    mocks.hasAnyActiveLegacySSEConnection.mockReturnValue(true);
    mocks.runtimeState.projects = { 'project-2': {} };
    const { emitCloseRequest } = renderProvider();

    act(() => emitCloseRequest('close-window'));

    await waitFor(() => expect(mocks.assessCloseRunState).toHaveBeenCalled());
    expect(mocks.assessCloseRunState).toHaveBeenCalledWith({
      projectIds: ['project-1', 'project-2'],
      legacyActive: true,
      signal: expect.any(AbortSignal),
    });
  });

  it('preserves the intent and execution class through cancel and confirm', async () => {
    const user = userEvent.setup();
    mocks.assessCloseRunState.mockResolvedValue('canonical-durable');
    const { emitCloseRequest, respondToCloseRequest } = renderProvider();

    act(() => emitCloseRequest('close-window'));
    expect(
      await screen.findByText('close-window:canonical-durable')
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel close' }));
    expect(respondToCloseRequest).toHaveBeenLastCalledWith({
      intent: 'close-window',
      action: 'cancel',
    });

    act(() => emitCloseRequest('quit-app'));
    expect(
      await screen.findByText('quit-app:canonical-durable')
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm close' }));
    expect(respondToCloseRequest).toHaveBeenLastCalledWith({
      intent: 'quit-app',
      action: 'confirm',
    });
    expect(respondToCloseRequest).toHaveBeenCalledTimes(4);
  });

  it('uses the latest Quit result when it replaces an in-flight Close lookup', async () => {
    const user = userEvent.setup();
    const closeLookup = deferred<'legacy-stream'>();
    const quitLookup = deferred<'canonical-durable'>();
    mocks.assessCloseRunState
      .mockReturnValueOnce(closeLookup.promise)
      .mockReturnValueOnce(quitLookup.promise);
    const { emitCloseRequest, respondToCloseRequest } = renderProvider();

    act(() => emitCloseRequest('close-window'));
    act(() => emitCloseRequest('quit-app'));
    await act(async () => quitLookup.resolve('canonical-durable'));
    expect(
      await screen.findByText('quit-app:canonical-durable')
    ).toBeInTheDocument();

    await act(async () => closeLookup.resolve('legacy-stream'));
    expect(screen.queryByText('close-window:legacy-stream')).toBeNull();
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

  it('fails closed with an unknown-class prompt when the registry read fails', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.assessCloseRunState.mockRejectedValue(new Error('Brain unavailable'));
    const { emitCloseRequest, respondToCloseRequest } = renderProvider();

    act(() => emitCloseRequest('quit-app'));

    expect(await screen.findByText('quit-app:unknown')).toBeInTheDocument();
    expect(respondToCloseRequest).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      '[WINDOW CLOSE] Could not verify durable Run state',
      expect.any(Error)
    );
  });

  it('fails closed when the canonical registry exceeds its lookup budget', async () => {
    vi.useFakeTimers();
    mocks.assessCloseRunState.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        })
    );
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { emitCloseRequest, respondToCloseRequest } = renderProvider();

    act(() => emitCloseRequest('close-window'));
    await act(async () => vi.advanceTimersByTimeAsync(2_500));

    expect(screen.getByText('close-window:unknown')).toBeInTheDocument();
    expect(respondToCloseRequest).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledWith(
      '[WINDOW CLOSE] Could not verify durable Run state',
      expect.objectContaining({ name: 'TimeoutError' })
    );
    vi.useRealTimers();
  });

  it('runs exact cleanup and ignores a lookup that settles after unmount', async () => {
    const lookup = deferred<'idle'>();
    mocks.assessCloseRunState.mockReturnValue(lookup.promise);
    const {
      emitCloseRequest,
      onCloseRequest,
      respondToCloseRequest,
      unsubscribe,
      view,
    } = renderProvider();

    expect(onCloseRequest).toHaveBeenCalledOnce();
    act(() => emitCloseRequest('quit-app'));
    view.unmount();
    await act(async () => lookup.resolve('idle'));

    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(respondToCloseRequest).toHaveBeenCalledOnce();
    expect(respondToCloseRequest).toHaveBeenCalledWith({
      intent: 'quit-app',
      action: 'acknowledge',
    });
  });
});
