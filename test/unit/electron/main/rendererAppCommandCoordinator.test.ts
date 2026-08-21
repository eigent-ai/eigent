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

import { APP_COMMAND } from '@/shared/appCommands';
import { describe, expect, it, vi } from 'vitest';
import { RendererAppCommandCoordinator } from '../../../../electron/main/rendererAppCommandCoordinator';

function createCoordinator() {
  let requestSequence = 0;
  const send = vi.fn();
  const diagnostic = vi.fn();
  const coordinator = new RendererAppCommandCoordinator({
    send,
    diagnostic,
    createRequestId: () => `request-${++requestSequence}`,
  });
  return { coordinator, diagnostic, send };
}

describe('RendererAppCommandCoordinator', () => {
  it('queues before readiness and flushes ordered commands for the epoch', () => {
    const { coordinator, send } = createCoordinator();

    coordinator.dispatch(APP_COMMAND.togglePreviewPanel);
    coordinator.dispatch(APP_COMMAND.toggleWorkspaceSidebar);

    expect(send).not.toHaveBeenCalled();
    coordinator.markReady('epoch-1');
    expect(send.mock.calls.map(([request]) => request)).toEqual([
      {
        commandId: APP_COMMAND.togglePreviewPanel,
        requestId: 'request-1',
        epoch: 'epoch-1',
      },
      {
        commandId: APP_COMMAND.toggleWorkspaceSidebar,
        requestId: 'request-2',
        epoch: 'epoch-1',
      },
    ]);
  });

  it('coalesces queued navigation last-wins without collapsing toggles', () => {
    const { coordinator, send } = createCoordinator();

    coordinator.dispatch(APP_COMMAND.navigateHome);
    coordinator.dispatch(APP_COMMAND.togglePreviewPanel);
    coordinator.dispatch(APP_COMMAND.navigateFiles);
    coordinator.dispatch(APP_COMMAND.togglePreviewPanel);
    coordinator.markReady('epoch-1');

    expect(send.mock.calls.map(([request]) => request.commandId)).toEqual([
      APP_COMMAND.togglePreviewPanel,
      APP_COMMAND.navigateFiles,
      APP_COMMAND.togglePreviewPanel,
    ]);
  });

  it('queues again after reload and rejects receipts from the old epoch', () => {
    const { coordinator, send } = createCoordinator();
    coordinator.markReady('epoch-1');
    const oldRequestId = coordinator.dispatch(APP_COMMAND.openSettings);

    coordinator.markNotReady('did-start-loading');
    coordinator.dispatch(APP_COMMAND.newProject);
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      coordinator.handleReceipt({
        commandId: APP_COMMAND.openSettings,
        requestId: oldRequestId,
        epoch: 'epoch-1',
      })
    ).toBe(false);

    coordinator.markReady('epoch-2');
    expect(send).toHaveBeenLastCalledWith({
      commandId: APP_COMMAND.newProject,
      requestId: 'request-2',
      epoch: 'epoch-2',
    });
  });

  it('accepts only a matching handled receipt in the current epoch', () => {
    const { coordinator } = createCoordinator();
    coordinator.markReady('epoch-1');
    const requestId = coordinator.dispatch(APP_COMMAND.reportBug);

    expect(
      coordinator.handleReceipt({
        commandId: APP_COMMAND.reportBug,
        requestId,
        epoch: 'stale',
      })
    ).toBe(false);
    expect(
      coordinator.handleReceipt({
        commandId: APP_COMMAND.reportBug,
        requestId,
        epoch: 'epoch-1',
      })
    ).toBe(true);
    expect(
      coordinator.handleReceipt({
        commandId: APP_COMMAND.reportBug,
        requestId,
        epoch: 'epoch-1',
      })
    ).toBe(false);
  });

  it('returns a failed send to the queue until a new renderer is ready', () => {
    const send = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('renderer disappeared');
      })
      .mockImplementation(() => undefined);
    const coordinator = new RendererAppCommandCoordinator({
      send,
      createRequestId: () => 'request-1',
    });
    coordinator.markReady('epoch-1');

    coordinator.dispatch(APP_COMMAND.openSettings);

    expect(coordinator.isReady()).toBe(false);
    expect(coordinator.getQueuedCount()).toBe(1);
    coordinator.markReady('epoch-2');
    expect(send).toHaveBeenLastCalledWith({
      commandId: APP_COMMAND.openSettings,
      requestId: 'request-1',
      epoch: 'epoch-2',
    });
  });
});
