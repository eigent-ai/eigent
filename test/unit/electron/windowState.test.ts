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
  captureWindowState,
  fitPreferredWindowSize,
  getWindowStatePath,
  loadWindowStartupState,
  parseWindowState,
  persistWindowState,
  readWindowState,
  resolveWindowStartupState,
  WINDOW_STATE_VERSION,
  type PersistedWindowStateV2,
  type WindowDisplayLike,
  type WindowStateIO,
} from '../../../electron/main/windowState';

const LARGE_PRIMARY: WindowDisplayLike = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1080 },
};

const NEGATIVE_SECONDARY: WindowDisplayLike = {
  id: 2,
  bounds: { x: -1600, y: 0, width: 1600, height: 900 },
  workArea: { x: -1600, y: 23, width: 1600, height: 877 },
};

function persisted(
  bounds: PersistedWindowStateV2['bounds'],
  isMaximized = false
): PersistedWindowStateV2 {
  return { version: WINDOW_STATE_VERSION, bounds, isMaximized };
}

function createMemoryIO(initialFiles: Record<string, string> = {}) {
  const files = new Map(Object.entries(initialFiles));
  const operations: string[] = [];
  let renameError: Error | null = null;

  const io: WindowStateIO = {
    readText(filePath) {
      operations.push(`read:${filePath}`);
      const contents = files.get(filePath);
      if (contents === undefined) throw new Error('ENOENT');
      return contents;
    },
    writeText(filePath, contents) {
      operations.push(`write:${filePath}`);
      files.set(filePath, contents);
    },
    rename(fromPath, toPath) {
      operations.push(`rename:${fromPath}->${toPath}`);
      if (renameError) throw renameError;
      const contents = files.get(fromPath);
      if (contents === undefined) throw new Error('Missing temporary file');
      files.set(toPath, contents);
      files.delete(fromPath);
    },
    remove(filePath) {
      operations.push(`remove:${filePath}`);
      files.delete(filePath);
    },
  };

  return {
    io,
    files,
    operations,
    failRename(error: Error) {
      renameError = error;
    },
  };
}

describe('window state schema', () => {
  it('accepts a versioned state and rounds integer-like values', () => {
    expect(
      parseWindowState({
        version: 2,
        bounds: {
          x: -1200.0004,
          y: 20.0004,
          width: 1280.0004,
          height: 960.0004,
        },
        isMaximized: true,
      })
    ).toEqual({
      version: 2,
      bounds: { x: -1200, y: 20, width: 1280, height: 960 },
      isMaximized: true,
    });
  });

  it.each([
    {
      version: 1,
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      isMaximized: false,
    },
    {
      version: 2,
      bounds: { x: 0.25, y: 0, width: 100, height: 100 },
      isMaximized: false,
    },
    {
      version: 2,
      bounds: { x: 0, y: 0, width: 0, height: 100 },
      isMaximized: false,
    },
    {
      version: 2,
      bounds: { x: 0, y: 0, width: Number.NaN, height: 100 },
      isMaximized: false,
    },
    {
      version: 2,
      bounds: { x: 0, y: 0, width: 100, height: Number.POSITIVE_INFINITY },
      isMaximized: false,
    },
    {
      version: 2,
      bounds: { x: '0', y: 0, width: 100, height: 100 },
      isMaximized: false,
    },
    {
      version: 2,
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      isMaximized: 'false',
    },
  ])('rejects invalid state %#', (value) => {
    expect(parseWindowState(value)).toBeNull();
  });

  it('treats missing, malformed, and unknown-version files as no state', () => {
    const statePath = getWindowStatePath('/user-data');
    const missing = createMemoryIO();
    const malformed = createMemoryIO({ [statePath]: '{bad json' });
    const unknown = createMemoryIO({
      [statePath]: JSON.stringify({
        version: 99,
        bounds: { x: 0, y: 0, width: 1200, height: 800 },
        isMaximized: false,
      }),
    });

    expect(readWindowState('/user-data', missing.io)).toBeNull();
    expect(readWindowState('/user-data', malformed.io)).toBeNull();
    expect(readWindowState('/user-data', unknown.io)).toBeNull();
  });
});

describe('window startup placement', () => {
  it('uses 1440x810 whenever there are no persisted bounds', () => {
    const startup = resolveWindowStartupState({
      persistedState: null,
      displays: [LARGE_PRIMARY],
      primaryDisplay: LARGE_PRIMARY,
    });

    expect(startup).toEqual({
      bounds: { x: 240, y: 135, width: 1440, height: 810 },
      minimumSize: { width: 1100, height: 700 },
      shouldMaximize: false,
      source: 'default',
    });
  });

  it('caps defaults near 94% and lets fitting shrink achievable minimums', () => {
    const mediumWorkArea = { x: 0, y: 0, width: 1200, height: 800 };
    expect(
      fitPreferredWindowSize({ width: 1440, height: 810 }, mediumWorkArea)
    ).toEqual({
      size: { width: 1128, height: 634 },
      minimumSize: { width: 1100, height: 634 },
    });

    const tinyDisplay: WindowDisplayLike = {
      id: 3,
      bounds: { x: 50, y: 25, width: 1000, height: 650 },
      workArea: { x: 50, y: 25, width: 1000, height: 650 },
    };
    const startup = resolveWindowStartupState({
      persistedState: null,
      displays: [tinyDisplay],
      primaryDisplay: tinyDisplay,
    });

    expect(startup.bounds).toEqual({
      x: 80,
      y: 86,
      width: 940,
      height: 528,
    });
    expect(startup.minimumSize).toEqual({ width: 940, height: 528 });
  });

  it('allows persisted user bounds to occupy the full work area', () => {
    const startup = resolveWindowStartupState({
      persistedState: persisted({
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
      }),
      displays: [LARGE_PRIMARY],
      primaryDisplay: LARGE_PRIMARY,
    });

    expect(startup.bounds).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
    });
  });

  it('selects a negative-coordinate display and clamps the full window into its work area', () => {
    const startup = resolveWindowStartupState({
      persistedState: persisted({
        x: -1700,
        y: -50,
        width: 1300,
        height: 900,
      }),
      displays: [LARGE_PRIMARY, NEGATIVE_SECONDARY],
      primaryDisplay: LARGE_PRIMARY,
    });

    expect(startup).toEqual({
      bounds: { x: -1600, y: 23, width: 1300, height: 877 },
      minimumSize: { width: 1100, height: 700 },
      shouldMaximize: false,
      source: 'persisted',
    });
  });

  it('centers state from a disconnected display on the primary work area', () => {
    const startup = resolveWindowStartupState({
      persistedState: persisted(
        { x: 5000, y: 4000, width: 1200, height: 800 },
        true
      ),
      displays: [LARGE_PRIMARY, NEGATIVE_SECONDARY],
      primaryDisplay: LARGE_PRIMARY,
    });

    expect(startup.bounds).toEqual({
      x: 360,
      y: 140,
      width: 1200,
      height: 800,
    });
    expect(startup.shouldMaximize).toBe(true);
    expect(startup.source).toBe('persisted');
  });

  it('expands undersized saved bounds to the effective minimum without overflowing', () => {
    const smallDisplay: WindowDisplayLike = {
      id: 4,
      bounds: { x: -1000, y: -650, width: 1000, height: 650 },
      workArea: { x: -1000, y: -650, width: 1000, height: 650 },
    };
    const startup = resolveWindowStartupState({
      persistedState: persisted({
        x: -900,
        y: -600,
        width: 400,
        height: 300,
      }),
      displays: [smallDisplay],
      primaryDisplay: smallDisplay,
    });

    expect(startup.bounds).toEqual({
      x: -1000,
      y: -650,
      width: 1000,
      height: 650,
    });
    expect(startup.minimumSize).toEqual({ width: 1000, height: 650 });
  });

  it('loads valid disk state and falls back to 1440x810 when disk state is corrupt', () => {
    const statePath = getWindowStatePath('/user-data');
    const validIO = createMemoryIO({
      [statePath]: JSON.stringify(
        persisted({ x: 100, y: 120, width: 1300, height: 800 })
      ),
    });
    const corruptIO = createMemoryIO({ [statePath]: 'not-json' });

    expect(
      loadWindowStartupState({
        userDataPath: '/user-data',
        io: validIO.io,
        displays: [LARGE_PRIMARY],
        primaryDisplay: LARGE_PRIMARY,
      }).source
    ).toBe('persisted');
    expect(
      loadWindowStartupState({
        userDataPath: '/user-data',
        io: corruptIO.io,
        displays: [LARGE_PRIMARY],
        primaryDisplay: LARGE_PRIMARY,
      })
    ).toMatchObject({
      bounds: { width: 1440, height: 810 },
      source: 'default',
    });
  });
});

describe('window state persistence', () => {
  it('captures normal bounds and maximized state without minimized/fullscreen fields', () => {
    const source = {
      getNormalBounds: vi.fn(() => ({
        x: -100.0004,
        y: 20,
        width: 1280,
        height: 960,
      })),
      isMaximized: vi.fn(() => true),
      isMinimized: vi.fn(() => true),
      isFullScreen: vi.fn(() => true),
    };

    const state = captureWindowState(source);

    expect(state).toEqual({
      version: 2,
      bounds: { x: -100, y: 20, width: 1280, height: 960 },
      isMaximized: true,
    });
    expect(state).not.toHaveProperty('isMinimized');
    expect(state).not.toHaveProperty('isFullScreen');
  });

  it('writes a versioned JSON file through temp then rename', () => {
    const memory = createMemoryIO();
    const state = persisted({ x: 10, y: 20, width: 1280, height: 960 });

    const saved = persistWindowState(
      '/user-data',
      {
        getNormalBounds: () => state.bounds,
        isMaximized: () => state.isMaximized,
      },
      memory.io
    );

    const statePath = getWindowStatePath('/user-data');
    expect(saved).toEqual(state);
    expect(memory.operations).toEqual([
      `write:${statePath}.tmp`,
      `rename:${statePath}.tmp->${statePath}`,
    ]);
    expect(memory.files.has(`${statePath}.tmp`)).toBe(false);
    expect(JSON.parse(memory.files.get(statePath)!)).toEqual(state);
  });

  it('removes a temporary file and preserves the original state when rename fails', () => {
    const statePath = getWindowStatePath('/user-data');
    const memory = createMemoryIO({ [statePath]: 'original-state' });
    memory.failRename(new Error('rename failed'));

    expect(() =>
      persistWindowState(
        '/user-data',
        {
          getNormalBounds: () => ({
            x: 10,
            y: 20,
            width: 1280,
            height: 960,
          }),
          isMaximized: () => false,
        },
        memory.io
      )
    ).toThrow('rename failed');
    expect(memory.files.get(statePath)).toBe('original-state');
    expect(memory.files.has(`${statePath}.tmp`)).toBe(false);
    expect(memory.operations.at(-1)).toBe(`remove:${statePath}.tmp`);
  });
});
