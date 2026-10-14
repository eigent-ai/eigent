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

import { ShellTerminal } from '@/components/Session/PreviewPanel/tabs/terminal/ShellTerminal';
import { HostProvider } from '@/host';
import { disposeShellSession } from '@/lib/shellSessions';
import { act, cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const xterm = vi.hoisted(() => ({ instances: [] as any[], fit: vi.fn() }));
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 100;
    rows = 35;
    write = vi.fn();
    focus = vi.fn();
    dispose = vi.fn();
    input = { dispose: vi.fn() };
    onData = vi.fn(() => this.input);
    open = vi.fn();
    constructor() {
      xterm.instances.push(this);
    }
    loadAddon() {}
    attachCustomKeyEventHandler() {}
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = xterm.fit;
  },
}));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));

let emitData: (event: { id: string; data: string }) => void;
const api = {
  terminalCreate: vi.fn().mockResolvedValue({ success: true }),
  terminalInput: vi.fn(),
  terminalResize: vi.fn(),
  terminalDispose: vi.fn().mockResolvedValue({ success: true }),
  onTerminalData: vi.fn((callback) => {
    emitData = callback;
  }),
  onTerminalExit: vi.fn(),
};
const host = { electronAPI: api, ipcRenderer: null };
let frames: Map<number, FrameRequestCallback>;
let observers: Set<() => void>;
let frameId = 0;
async function frame() {
  await act(async () => {
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(0));
  });
}
const surface = (id: string, settled = true) => (
  <StrictMode>
    <HostProvider host={host}>
      <ShellTerminal key={id} shellId={id} viewportSettled={settled} />
    </HostProvider>
  </StrictMode>
);
beforeEach(() => {
  vi.clearAllMocks();
  api.terminalCreate.mockResolvedValue({ success: true });
  api.terminalDispose.mockResolvedValue({ success: true });
  xterm.instances.length = 0;
  frames = new Map();
  observers = new Set();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: () => void) {}
      observe() {
        observers.add(this.callback);
      }
      disconnect() {
        observers.delete(this.callback);
      }
    }
  );
});
afterEach(() => {
  cleanup();
  disposeShellSession(api as never, 'session-a');
  disposeShellSession(api as never, 'session-b');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('defers fit, PTY creation and focus until entrance finishes, including StrictMode remounts', async () => {
  const view = render(surface('session-a', false));
  await frame();
  act(() => observers.forEach((callback) => callback()));
  await frame();
  expect(xterm.fit).not.toHaveBeenCalled();
  expect(api.terminalCreate).not.toHaveBeenCalled();
  expect(xterm.instances[0].focus).not.toHaveBeenCalled();

  view.rerender(surface('session-a'));
  await frame();
  expect(xterm.instances).toHaveLength(1);
  expect(api.terminalCreate).toHaveBeenCalledOnce();
  expect(api.terminalCreate).toHaveBeenCalledWith({
    id: 'session-a',
    cwd: undefined,
    cols: 100,
    rows: 35,
  });
  expect(xterm.instances[0].focus).toHaveBeenCalledOnce();
  expect(xterm.instances[0].dispose).not.toHaveBeenCalled();
});

it('keeps the same parser subscribed while detached or animating across repeated Session switches', async () => {
  const view = render(surface('session-a'));
  await frame();
  const terminalA = xterm.instances[0];
  for (let i = 0; i < 4; i++) {
    act(() => emitData({ id: 'session-a', data: `LINE-${i}\r\n\x1b[` }));
    view.rerender(surface('session-b'));
    await frame();
    act(() => emitData({ id: 'session-a', data: '32m100%\x1b[0m\r\n' }));
    xterm.fit.mockClear();
    api.terminalResize.mockClear();
    view.rerender(surface('session-a', false));
    await frame();
    act(() => observers.forEach((callback) => callback()));
    await frame();
    expect(xterm.fit).not.toHaveBeenCalled();
    expect(api.terminalResize).not.toHaveBeenCalled();
    view.rerender(surface('session-a'));
    await frame();
    expect(xterm.instances[0]).toBe(terminalA);
  }
  expect(terminalA.write.mock.calls).toEqual(
    Array.from({ length: 4 }, (_, i) => [
      [`LINE-${i}\r\n\x1b[`],
      ['32m100%\x1b[0m\r\n'],
    ]).flat()
  );
  expect(api.terminalCreate).toHaveBeenCalledTimes(2);
  expect(api.terminalDispose).not.toHaveBeenCalled();
  expect(xterm.instances).toHaveLength(2);
  expect(terminalA.onData).toHaveBeenCalledOnce();
  expect(terminalA.dispose).not.toHaveBeenCalled();

  // Genuine post-entrance layout changes must still resize the existing PTY.
  xterm.fit.mockClear();
  act(() => observers.forEach((callback) => callback()));
  await frame();
  expect(xterm.fit).toHaveBeenCalledOnce();
  expect(api.terminalResize).toHaveBeenLastCalledWith('session-a', 100, 35);
  view.unmount();
  expect(observers.size).toBe(0);
  expect(frames.size).toBe(0);
  expect(terminalA.dispose).not.toHaveBeenCalled();
  disposeShellSession(api as never, 'session-a');
  expect(terminalA.dispose).toHaveBeenCalledOnce();
  expect(terminalA.input.dispose).toHaveBeenCalledOnce();
  const count = terminalA.write.mock.calls.length;
  act(() => emitData({ id: 'session-a', data: 'after close' }));
  expect(terminalA.write).toHaveBeenCalledTimes(count);
});

it('does not steal focus moved to another input while the entrance is pending', async () => {
  const view = render(
    <>
      <input aria-label="Chat input" />
      {surface('session-a', false)}
    </>
  );
  await frame();
  screen.getByRole('textbox', { name: 'Chat input' }).focus();
  view.rerender(
    <>
      <input aria-label="Chat input" />
      {surface('session-a')}
    </>
  );
  await frame();
  expect(api.terminalCreate).toHaveBeenCalledOnce();
  expect(xterm.instances[0].focus).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Chat input' })).toHaveFocus();
});

it('cancels pending work when a Session is switched away before its first frame', async () => {
  const view = render(surface('session-a', false));
  view.rerender(surface('session-b'));
  await frame();
  expect(api.terminalCreate.mock.calls.map(([options]) => options.id)).toEqual([
    'session-b',
  ]);
  expect(xterm.instances[0].focus).not.toHaveBeenCalled();
  expect(observers.size).toBe(1);
});
