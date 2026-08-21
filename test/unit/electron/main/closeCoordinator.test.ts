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

import { describe, expect, it, vi } from 'vitest';
import { CloseCoordinator } from '../../../../electron/main/closeCoordinator';
import { isWindowCloseResponse } from '../../../../src/shared/windowClose';

function createWindow(webContentsDestroyed = false) {
  const windowListeners = new Map<string, Set<(...args: any[]) => void>>();
  const webContentsListeners = new Map<string, Set<(...args: any[]) => void>>();
  const addListener = (
    listeners: Map<string, Set<(...args: any[]) => void>>,
    event: string,
    listener: (...args: any[]) => void
  ) => {
    const eventListeners = listeners.get(event) ?? new Set();
    eventListeners.add(listener);
    listeners.set(event, eventListeners);
  };
  const removeListener = (
    listeners: Map<string, Set<(...args: any[]) => void>>,
    event: string,
    listener: (...args: any[]) => void
  ) => listeners.get(event)?.delete(listener);
  const emit = (
    listeners: Map<string, Set<(...args: any[]) => void>>,
    event: string,
    ...args: any[]
  ) => listeners.get(event)?.forEach((listener) => listener(...args));
  const closeEvents: Array<{ preventDefault: ReturnType<typeof vi.fn> }> = [];
  const send = vi.fn();
  const close = vi.fn(() => {
    const event = { preventDefault: vi.fn() };
    closeEvents.push(event);
    emit(windowListeners, 'close', event);
  });
  const window = {
    close,
    isDestroyed: () => false,
    on: vi.fn((event: string, listener: (...args: any[]) => void) => {
      addListener(windowListeners, event, listener);
      return window;
    }),
    off: vi.fn((event: string, listener: (...args: any[]) => void) => {
      removeListener(windowListeners, event, listener);
      return window;
    }),
    webContents: {
      isDestroyed: () => webContentsDestroyed,
      send,
      on: vi.fn((event: string, listener: (...args: any[]) => void) => {
        addListener(webContentsListeners, event, listener);
        return window.webContents;
      }),
      off: vi.fn((event: string, listener: (...args: any[]) => void) => {
        removeListener(webContentsListeners, event, listener);
        return window.webContents;
      }),
    },
  };
  return {
    window,
    close,
    closeEvents,
    emitWindow: (event: string, ...args: any[]) =>
      emit(windowListeners, event, ...args),
    emitWebContents: (event: string, ...args: any[]) =>
      emit(webContentsListeners, event, ...args),
    send,
  };
}

describe('CloseCoordinator', () => {
  it('routes a native macOS window close through a close-window request', () => {
    const quit = vi.fn();
    const fixture = createWindow();
    const coordinator = new CloseCoordinator({
      defaultIntent: 'close-window',
      quit,
    });
    coordinator.bindWindow(fixture.window as never);

    fixture.close();

    expect(fixture.send).toHaveBeenCalledWith('before-close', {
      intent: 'close-window',
    });
    expect(coordinator.getPendingIntent()).toBe('close-window');

    expect(
      coordinator.respond({
        intent: 'close-window',
        action: 'confirm',
      })
    ).toBe(true);
    expect(fixture.close).toHaveBeenCalledTimes(2);
    expect(quit).not.toHaveBeenCalled();
  });

  it('routes an explicit quit through the same guard and quits after confirm', () => {
    const quit = vi.fn();
    const fixture = createWindow();
    const coordinator = new CloseCoordinator({
      defaultIntent: 'close-window',
      quit,
    });
    coordinator.bindWindow(fixture.window as never);

    coordinator.request('quit-app');

    expect(fixture.send).toHaveBeenCalledWith('before-close', {
      intent: 'quit-app',
    });
    expect(coordinator.respond({ intent: 'quit-app', action: 'confirm' })).toBe(
      true
    );
    expect(quit).toHaveBeenCalledOnce();
  });

  it('clears a cancelled request so a later close can prompt again', () => {
    const fixture = createWindow();
    const coordinator = new CloseCoordinator({
      defaultIntent: 'quit-app',
      quit: vi.fn(),
    });
    coordinator.bindWindow(fixture.window as never);

    fixture.close();
    expect(coordinator.respond({ intent: 'quit-app', action: 'cancel' })).toBe(
      true
    );
    fixture.close();

    expect(fixture.send).toHaveBeenCalledTimes(2);
  });

  it('ignores stale or mismatched renderer responses', () => {
    const fixture = createWindow();
    const quit = vi.fn();
    const coordinator = new CloseCoordinator({
      defaultIntent: 'close-window',
      quit,
    });
    coordinator.bindWindow(fixture.window as never);
    fixture.close();

    expect(coordinator.respond({ intent: 'quit-app', action: 'confirm' })).toBe(
      false
    );
    expect(quit).not.toHaveBeenCalled();
    expect(fixture.close).toHaveBeenCalledOnce();
  });

  it('upgrades an open Close Window confirmation when Quit arrives', () => {
    const fixture = createWindow();
    const quit = vi.fn();
    const coordinator = new CloseCoordinator({
      defaultIntent: 'close-window',
      quit,
    });
    coordinator.bindWindow(fixture.window as never);

    fixture.close();
    expect(
      coordinator.respond({
        intent: 'close-window',
        action: 'acknowledge',
      })
    ).toBe(true);
    coordinator.request('quit-app');

    expect(fixture.send).toHaveBeenLastCalledWith('before-close', {
      intent: 'quit-app',
    });
    expect(
      coordinator.respond({ intent: 'close-window', action: 'confirm' })
    ).toBe(false);
    expect(
      coordinator.respond({ intent: 'quit-app', action: 'acknowledge' })
    ).toBe(true);
    expect(coordinator.respond({ intent: 'quit-app', action: 'confirm' })).toBe(
      true
    );
    expect(quit).toHaveBeenCalledOnce();
  });

  it('does not accumulate listeners when a window is rebound', () => {
    const first = createWindow();
    const second = createWindow();
    const coordinator = new CloseCoordinator({
      defaultIntent: 'close-window',
      quit: vi.fn(),
    });

    coordinator.bindWindow(first.window as never);
    coordinator.bindWindow(second.window as never);

    expect(first.window.off).toHaveBeenCalledWith(
      'close',
      expect.any(Function)
    );
    expect(first.window.off).toHaveBeenCalledWith(
      'unresponsive',
      expect.any(Function)
    );
    expect(first.window.webContents.off).toHaveBeenCalledWith(
      'render-process-gone',
      expect.any(Function)
    );
    expect(second.window.on).toHaveBeenCalledWith(
      'close',
      expect.any(Function)
    );
    expect(second.window.on).toHaveBeenCalledWith(
      'unresponsive',
      expect.any(Function)
    );
  });

  it('lets trusted updater or restart quits bypass the renderer guard', () => {
    const fixture = createWindow();
    const coordinator = new CloseCoordinator({
      defaultIntent: 'close-window',
      quit: vi.fn(),
    });
    coordinator.bindWindow(fixture.window as never);

    coordinator.markAppQuitInProgress();
    fixture.close();

    expect(fixture.send).not.toHaveBeenCalled();
    expect(coordinator.isAppQuitInProgress()).toBe(true);
  });

  it('quits immediately before the renderer is ready to answer', () => {
    const fixture = createWindow();
    const quit = vi.fn();
    const coordinator = new CloseCoordinator({
      defaultIntent: 'close-window',
      quit,
      shouldGuard: () => false,
    });
    coordinator.bindWindow(fixture.window as never);

    coordinator.request('quit-app');

    expect(fixture.send).not.toHaveBeenCalled();
    expect(quit).toHaveBeenCalledOnce();
  });

  it('does not strand a window after its renderer is already destroyed', () => {
    const fixture = createWindow(true);
    const coordinator = new CloseCoordinator({
      defaultIntent: 'close-window',
      quit: vi.fn(),
    });
    coordinator.bindWindow(fixture.window as never);

    fixture.close();

    expect(fixture.send).not.toHaveBeenCalled();
    expect(coordinator.getPendingIntent()).toBeNull();
  });

  it('closes anyway when the renderer never answers', () => {
    const fixture = createWindow();
    const quit = vi.fn();
    let pending: (() => void) | null = null;
    const coordinator = new CloseCoordinator({
      defaultIntent: 'quit-app',
      quit,
      responseTimeoutMs: 5_000,
      setTimeoutFn: (handler) => {
        pending = handler;
        return 1;
      },
      clearTimeoutFn: () => {
        pending = null;
      },
    });
    coordinator.bindWindow(fixture.window as never);

    coordinator.request('quit-app');
    expect(coordinator.getPendingIntent()).toBe('quit-app');
    expect(quit).not.toHaveBeenCalled();

    // A crashed or hung renderer must not be able to veto the quit forever.
    pending?.();

    expect(quit).toHaveBeenCalledOnce();
    expect(coordinator.getPendingIntent()).toBeNull();
  });

  it('cancels the watchdog once the renderer answers', () => {
    const fixture = createWindow();
    const cleared: unknown[] = [];
    const coordinator = new CloseCoordinator({
      defaultIntent: 'close-window',
      quit: vi.fn(),
      responseTimeoutMs: 5_000,
      setTimeoutFn: () => 'timer',
      clearTimeoutFn: (handle) => cleared.push(handle),
    });
    coordinator.bindWindow(fixture.window as never);

    coordinator.request('close-window');
    coordinator.respond({ intent: 'close-window', action: 'cancel' });

    expect(cleared).toContain('timer');
    expect(coordinator.getPendingIntent()).toBeNull();
  });

  it('suspends the watchdog while an acknowledged dialog awaits a decision', () => {
    vi.useFakeTimers();
    try {
      const fixture = createWindow();
      const quit = vi.fn();
      const coordinator = new CloseCoordinator({
        defaultIntent: 'quit-app',
        quit,
        responseTimeoutMs: 5_000,
      });
      coordinator.bindWindow(fixture.window as never);

      coordinator.request('quit-app');
      const acknowledgement = {
        intent: 'quit-app',
        action: 'acknowledge',
      } as const;

      expect(isWindowCloseResponse(acknowledgement)).toBe(true);
      expect(coordinator.respond(acknowledgement)).toBe(true);
      expect(coordinator.getPendingIntent()).toBe('quit-app');

      vi.advanceTimersByTime(5_000);

      expect(quit).not.toHaveBeenCalled();
      expect(coordinator.getPendingIntent()).toBe('quit-app');
      expect(
        coordinator.respond({ intent: 'quit-app', action: 'cancel' })
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears an acknowledged request when the renderer becomes unresponsive', () => {
    const fixture = createWindow();
    const quit = vi.fn();
    const diagnostic = vi.fn();
    const coordinator = new CloseCoordinator({
      defaultIntent: 'close-window',
      quit,
      diagnostic,
    });
    coordinator.bindWindow(fixture.window as never);

    coordinator.request('quit-app');
    coordinator.respond({ intent: 'quit-app', action: 'acknowledge' });
    fixture.emitWindow('unresponsive');

    expect(coordinator.getPendingIntent()).toBeNull();
    expect(coordinator.isRendererReady()).toBe(false);
    expect(diagnostic).toHaveBeenLastCalledWith(
      expect.stringContaining('acknowledged=true')
    );

    // A second explicit Quit is now an escape instead of being swallowed.
    coordinator.request('quit-app');
    expect(quit).toHaveBeenCalledOnce();
  });

  it('clears pending state on renderer crash and lets the next native close pass', () => {
    const fixture = createWindow();
    const coordinator = new CloseCoordinator({
      defaultIntent: 'close-window',
      quit: vi.fn(),
    });
    coordinator.bindWindow(fixture.window as never);

    fixture.close();
    coordinator.respond({ intent: 'close-window', action: 'acknowledge' });
    fixture.emitWebContents('render-process-gone');
    fixture.close();

    expect(coordinator.getPendingIntent()).toBeNull();
    expect(fixture.send).toHaveBeenCalledTimes(1);
    expect(fixture.closeEvents.at(-1)?.preventDefault).not.toHaveBeenCalled();
  });

  it('can guard again after a recovered renderer completes its handshake', () => {
    const fixture = createWindow();
    const coordinator = new CloseCoordinator({
      defaultIntent: 'close-window',
      quit: vi.fn(),
    });
    coordinator.bindWindow(fixture.window as never);
    fixture.emitWindow('unresponsive');
    coordinator.markRendererReady();

    fixture.close();

    expect(fixture.send).toHaveBeenCalledWith('before-close', {
      intent: 'close-window',
    });
  });
});
