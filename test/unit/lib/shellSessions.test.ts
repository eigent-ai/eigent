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

  emitExit({ id: 'uvicorn', exitCode: 0 });
  expect(getShellSessionState('uvicorn').url).toBeUndefined();
});
