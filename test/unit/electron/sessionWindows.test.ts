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
import {
  isSessionWindowTarget,
  SessionWindowManager,
  sessionWindowRoute,
  type SessionWindowLike,
  type SessionWindowTarget,
} from '../../../electron/main/sessionWindows';

let nextContentsId = 1;

class FakeWindow implements SessionWindowLike {
  readonly webContents = { id: nextContentsId++ };
  destroyed = false;
  minimized = false;
  focus = vi.fn();
  restore = vi.fn();
  private listeners = new Map<string, Array<() => void>>();
  constructor(public bounds = { x: 10, y: 20, width: 900, height: 700 }) {}
  isDestroyed() {
    return this.destroyed;
  }
  isMinimized() {
    return this.minimized;
  }
  isMaximized() {
    return false;
  }
  getNormalBounds() {
    return this.bounds;
  }
  on(event: string, listener: () => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }
  emit(event: string) {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }
  close() {
    this.destroyed = true;
    this.emit('closed');
  }
}

function harness(initialFile?: string) {
  const files = new Map<string, string>();
  if (initialFile !== undefined)
    files.set('/user/session-windows.json', initialFile);
  const created: Array<{ target: SessionWindowTarget; window: FakeWindow }> =
    [];
  const onClosed = vi.fn();
  const manager = new SessionWindowManager<FakeWindow>({
    userDataPath: '/user',
    createWindow: (target, state) => {
      const window = new FakeWindow(state?.bounds);
      created.push({ target, window });
      return window;
    },
    onClosed,
    io: {
      readFileSync: ((file: string) => {
        const content = files.get(file);
        if (content === undefined) throw new Error('missing');
        return content;
      }) as never,
      writeFileSync: ((file: string, content: string) =>
        files.set(file, content)) as never,
      mkdirSync: (() => undefined) as never,
    },
  });
  const saved = () =>
    JSON.parse(files.get('/user/session-windows.json') ?? 'null');
  return { manager, created, onClosed, saved };
}

const A = { spaceId: 'space_1', projectId: 'project-a' };
const B = { spaceId: 'space_1', projectId: 'project-b' };

describe('Session windows', () => {
  it('accepts only plain Space and Session ids as targets', () => {
    expect(isSessionWindowTarget(A)).toBe(true);
    expect(isSessionWindowTarget({ spaceId: '../x', projectId: 'a' })).toBe(
      false
    );
    expect(isSessionWindowTarget({ spaceId: 'a' })).toBe(false);
    expect(sessionWindowRoute(A)).toBe('/session-window/space_1/project-a');
  });

  it('opens one window per Session and focuses it on a second request', () => {
    const { manager, created } = harness();
    const first = manager.open(A);
    first.minimized = true;
    expect(manager.open(A)).toBe(first);
    expect(created).toHaveLength(1);
    expect(first.restore).toHaveBeenCalledOnce();
    expect(first.focus).toHaveBeenCalledOnce();
    expect(manager.ownsContents(first.webContents.id)).toBe(true);
    expect(manager.targetForContents(first.webContents.id)).toEqual(A);
  });

  it('forgets a window the user closed and reports it', () => {
    const { manager, onClosed, saved } = harness();
    manager.open(A);
    manager.open(B);
    manager.close(A.projectId);
    expect(onClosed).toHaveBeenCalledWith(A);
    expect(manager.openProjectIds()).toEqual([B.projectId]);
    expect(
      saved().windows.map((w: SessionWindowTarget) => w.projectId)
    ).toEqual([B.projectId]);
  });

  it('keeps the list as it was at quit and reopens it with its placement', () => {
    const first = harness();
    const window = first.manager.open(A);
    window.bounds = { x: 40, y: 50, width: 800, height: 600 };
    window.emit('resize');
    first.manager.open(B);
    first.manager.markQuitting();
    for (const open of first.manager.allWindows()) open.close();
    expect(first.onClosed).not.toHaveBeenCalled();

    const next = harness(JSON.stringify(first.saved()));
    next.manager.restore();
    next.manager.restore();
    expect(next.created.map(({ target }) => target)).toEqual([A, B]);
    expect(next.created[0].window.bounds).toEqual({
      x: 40,
      y: 50,
      width: 800,
      height: 600,
    });
  });

  it('ignores a damaged or foreign saved list', () => {
    for (const file of [
      '{',
      JSON.stringify({ version: 99, windows: [A] }),
      JSON.stringify({
        version: 1,
        windows: [{ spaceId: '/etc', projectId: 'x' }, A, A],
      }),
    ]) {
      const { manager, created } = harness(file);
      manager.restore();
      expect(created.length).toBeLessThanOrEqual(1);
      if (created.length) expect(created[0].target).toEqual(A);
    }
  });
});
