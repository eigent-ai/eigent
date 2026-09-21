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

import {
  ensureShellSession,
  getShellBuffer,
  getShellSessionState,
  writeToShell,
} from '@/lib/shellSessions';
import { expect, it, vi } from 'vitest';

it('normalizes colored server URLs and clears stale discoveries', async () => {
  let emitData: (payload: { id: string; data: string }) => void = () => {};
  let emitExit: (payload: { id: string; exitCode: number }) => void = () => {};
  const api = {
    terminalCreate: vi.fn().mockResolvedValue({ success: true }),
    terminalInput: vi.fn(),
    terminalResize: vi.fn(),
    terminalDispose: vi.fn(),
    onTerminalData: vi.fn((listener) => {
      emitData = listener;
    }),
    onTerminalExit: vi.fn((listener) => {
      emitExit = listener;
    }),
  };

  await ensureShellSession(api as never, { id: 'uvicorn' });
  emitData({
    id: 'uvicorn',
    data: 'Uvicorn running on \x1b[1mhttp://127.0.0.1:8000\x1b[0m',
  });
  expect(getShellSessionState('uvicorn').url).toBe('http://127.0.0.1:8000');

  await ensureShellSession(api as never, { id: 'vite' });
  emitData({
    id: 'vite',
    data: 'Local: http://localhost:\x1b[1m5173\x1b[22m/',
  });
  expect(getShellSessionState('vite').url).toBe('http://localhost:5173/');

  writeToShell(api as never, 'vite', 'next-command\r');
  expect(getShellSessionState('vite').url).toBeUndefined();
  expect(api.terminalInput).toHaveBeenCalledWith('vite', 'next-command\r');

  emitData({ id: 'vite', data: 'building new command...\n' });
  expect(getShellSessionState('vite').url).toBeUndefined();
  expect(getShellBuffer('vite')).toContain('Local: http://localhost:');

  // A URL may straddle output chunks, but never a command boundary.
  emitData({ id: 'vite', data: 'Local: http://localhost:' });
  writeToShell(api as never, 'vite', 'another-command\n');
  emitData({ id: 'vite', data: '6000/\n' });
  expect(getShellSessionState('vite').url).toBeUndefined();
  emitData({ id: 'vite', data: 'Local: http://0.0.0.0:' });
  emitData({ id: 'vite', data: '7000/\n' });
  expect(getShellSessionState('vite').url).toBe('http://127.0.0.1:7000/');

  emitExit({ id: 'uvicorn', exitCode: 0 });
  expect(getShellSessionState('uvicorn').url).toBeUndefined();
});

it('preserves the shell view and scrollback until disposal succeeds on reset', async () => {
  vi.resetModules();
  const shell = await import('@/lib/shellSessions');
  let emitData: (payload: { id: string; data: string }) => void = () => {};
  const api = {
    terminalCreate: vi.fn().mockResolvedValue({ success: true }),
    terminalInput: vi.fn(),
    terminalResize: vi.fn(),
    terminalDispose: vi.fn().mockResolvedValue({ success: false }),
    onTerminalData: vi.fn((listener) => {
      emitData = listener;
    }),
    onTerminalExit: vi.fn(),
  };
  const disposeView = vi.fn();
  await shell.ensureShellSession(api as never, { id: 'reset-failure' });
  shell.retainShellView('reset-failure', disposeView);
  emitData({ id: 'reset-failure', data: 'existing scrollback\n' });
  const before = shell.getShellSessionState('reset-failure');
  expect(await shell.resetShellSession(api as never, 'reset-failure')).toBe(
    false
  );
  expect(shell.getShellSessionState('reset-failure')).toEqual(before);
  expect(shell.getShellBuffer('reset-failure')).toBe('existing scrollback\n');
  expect(disposeView).not.toHaveBeenCalled();
  expect(api.terminalCreate).toHaveBeenCalledTimes(1);

  api.terminalDispose.mockResolvedValue({ success: true });
  expect(await shell.resetShellSession(api as never, 'reset-failure')).toBe(
    true
  );
  expect(disposeView).toHaveBeenCalledTimes(1);
  expect(shell.getShellBuffer('reset-failure')).toBe('');
  await shell.ensureShellSession(api as never, { id: 'reset-failure' });
  expect(api.terminalCreate).toHaveBeenCalledTimes(2);
});
