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

import fs from 'node:fs';
import path from 'node:path';

// Version 2 invalidates pre-release state written from the legacy 4:3 fallback.
export const WINDOW_STATE_VERSION = 2 as const;
export const WINDOW_STATE_FILE_NAME = 'window-state.json';

export const DEFAULT_WINDOW_SIZE = {
  width: 1440,
  height: 810,
} as const;

export const DEFAULT_MINIMUM_WINDOW_SIZE = {
  width: 1100,
  height: 700,
} as const;

/** Keep fallback windows away from work-area edges on first/default launch. */
export const DEFAULT_WORK_AREA_FRACTION = 0.94;

const INTEGERISH_TOLERANCE = 0.001;

export interface WindowRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowSize {
  width: number;
  height: number;
}

/** The subset of Electron.Display used by the pure placement functions. */
export interface WindowDisplayLike {
  id?: number | string;
  bounds: WindowRectangle;
  workArea: WindowRectangle;
}

/** The subset of BrowserWindow required to take a restorable snapshot. */
export interface WindowStateSource {
  getNormalBounds(): WindowRectangle;
  isMaximized(): boolean;
}

export interface PersistedWindowStateV2 {
  version: typeof WINDOW_STATE_VERSION;
  bounds: WindowRectangle;
  isMaximized: boolean;
}

export interface WindowStateIO {
  readText(filePath: string): string;
  writeText(filePath: string, contents: string): void;
  rename(fromPath: string, toPath: string): void;
  remove(filePath: string): void;
}

export type WindowStartupSource = 'persisted' | 'default';

export interface ResolveWindowStartupStateOptions {
  persistedState: PersistedWindowStateV2 | null;
  displays: readonly WindowDisplayLike[];
  primaryDisplay: WindowDisplayLike;
  minimumSize?: WindowSize;
}

export interface LoadWindowStartupStateOptions extends Omit<
  ResolveWindowStartupStateOptions,
  'persistedState'
> {
  userDataPath: string;
  io?: WindowStateIO;
}

export interface WindowStartupState {
  bounds: WindowRectangle;
  minimumSize: WindowSize;
  shouldMaximize: boolean;
  source: WindowStartupSource;
}

const NODE_WINDOW_STATE_IO: WindowStateIO = {
  readText: (filePath) => fs.readFileSync(filePath, 'utf8'),
  writeText: (filePath, contents) =>
    fs.writeFileSync(filePath, contents, {
      encoding: 'utf8',
      mode: 0o600,
    }),
  rename: (fromPath, toPath) => fs.renameSync(fromPath, toPath),
  remove: (filePath) => fs.rmSync(filePath, { force: true }),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeIntegerish(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (
    !Number.isSafeInteger(rounded) ||
    Math.abs(value - rounded) > INTEGERISH_TOLERANCE
  ) {
    return null;
  }
  return rounded;
}

export function normalizeWindowRectangle(
  value: unknown
): WindowRectangle | null {
  if (!isRecord(value)) return null;

  const x = normalizeIntegerish(value.x);
  const y = normalizeIntegerish(value.y);
  const width = normalizeIntegerish(value.width);
  const height = normalizeIntegerish(value.height);

  if (
    x === null ||
    y === null ||
    width === null ||
    height === null ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return { x, y, width, height };
}

function normalizeWindowSize(value: unknown): WindowSize | null {
  if (!isRecord(value)) return null;
  const width = normalizeIntegerish(value.width);
  const height = normalizeIntegerish(value.height);
  if (width === null || height === null || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

export function parseWindowState(
  value: unknown
): PersistedWindowStateV2 | null {
  if (
    !isRecord(value) ||
    value.version !== WINDOW_STATE_VERSION ||
    typeof value.isMaximized !== 'boolean'
  ) {
    return null;
  }

  const bounds = normalizeWindowRectangle(value.bounds);
  if (!bounds) return null;

  return {
    version: WINDOW_STATE_VERSION,
    bounds,
    isMaximized: value.isMaximized,
  };
}

export function getWindowStatePath(userDataPath: string): string {
  return path.join(userDataPath, WINDOW_STATE_FILE_NAME);
}

/** Missing, unreadable, unknown-version, and corrupt files all mean no state. */
export function readWindowState(
  userDataPath: string,
  io: WindowStateIO = NODE_WINDOW_STATE_IO
): PersistedWindowStateV2 | null {
  try {
    const parsed: unknown = JSON.parse(
      io.readText(getWindowStatePath(userDataPath))
    );
    return parseWindowState(parsed);
  } catch {
    return null;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function intersectionArea(a: WindowRectangle, b: WindowRectangle): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function sameDisplay(a: WindowDisplayLike, b: WindowDisplayLike): boolean {
  if (a.id !== undefined && b.id !== undefined) return a.id === b.id;
  return (
    a.bounds.x === b.bounds.x &&
    a.bounds.y === b.bounds.y &&
    a.bounds.width === b.bounds.width &&
    a.bounds.height === b.bounds.height
  );
}

function normalizeDisplay(
  display: WindowDisplayLike
): WindowDisplayLike | null {
  const bounds = normalizeWindowRectangle(display.bounds);
  const workArea = normalizeWindowRectangle(display.workArea);
  if (!bounds || !workArea) return null;
  return { id: display.id, bounds, workArea };
}

function normalizedDisplays(
  displays: readonly WindowDisplayLike[],
  primaryDisplay: WindowDisplayLike
): { displays: WindowDisplayLike[]; primary: WindowDisplayLike } {
  const primary = normalizeDisplay(primaryDisplay);
  if (!primary) throw new Error('Primary display has invalid bounds');

  const result = [primary];
  for (const display of displays) {
    const normalized = normalizeDisplay(display);
    if (
      !normalized ||
      result.some((candidate) => sameDisplay(candidate, normalized))
    ) {
      continue;
    }
    result.push(normalized);
  }
  return { displays: result, primary };
}

function effectiveMinimumSize(
  requested: WindowSize,
  workArea: WindowRectangle
): WindowSize {
  return {
    width: Math.min(requested.width, workArea.width),
    height: Math.min(requested.height, workArea.height),
  };
}

/**
 * Fit a preferred fallback size into roughly 94% of a work area while always
 * preserving its aspect ratio. On smaller displays the effective minimum must
 * shrink with the fitted size, otherwise BrowserWindow would expand one axis
 * and turn the 16:9 default back into a distorted shape. Persisted bounds use a
 * separate path and may occupy the full work area.
 */
export function fitPreferredWindowSize(
  preferredSize: WindowSize,
  workArea: WindowRectangle,
  minimumSize: WindowSize = DEFAULT_MINIMUM_WINDOW_SIZE
): { size: WindowSize; minimumSize: WindowSize } {
  const preferred = normalizeWindowSize(preferredSize);
  const normalizedWorkArea = normalizeWindowRectangle(workArea);
  const requestedMinimum = normalizeWindowSize(minimumSize);
  if (!preferred || !normalizedWorkArea || !requestedMinimum) {
    throw new Error(
      'Window sizing inputs must be positive integer-like values'
    );
  }

  const defaultArea = {
    width: Math.max(
      1,
      Math.floor(normalizedWorkArea.width * DEFAULT_WORK_AREA_FRACTION)
    ),
    height: Math.max(
      1,
      Math.floor(normalizedWorkArea.height * DEFAULT_WORK_AREA_FRACTION)
    ),
  };
  const scale = Math.min(
    1,
    defaultArea.width / preferred.width,
    defaultArea.height / preferred.height
  );
  const ratioFitted = {
    width: Math.max(1, Math.floor(preferred.width * scale)),
    height: Math.max(1, Math.floor(preferred.height * scale)),
  };
  const effectiveMinimum = effectiveMinimumSize(requestedMinimum, {
    x: 0,
    y: 0,
    ...ratioFitted,
  });

  return {
    size: ratioFitted,
    minimumSize: effectiveMinimum,
  };
}

function centerBounds(
  size: WindowSize,
  workArea: WindowRectangle
): WindowRectangle {
  return {
    x: Math.round(workArea.x + (workArea.width - size.width) / 2),
    y: Math.round(workArea.y + (workArea.height - size.height) / 2),
    width: size.width,
    height: size.height,
  };
}

function displayForBounds(
  bounds: WindowRectangle,
  displays: readonly WindowDisplayLike[],
  primary: WindowDisplayLike
): { display: WindowDisplayLike; intersects: boolean } {
  let selected = primary;
  let largestIntersection = 0;

  for (const display of displays) {
    const area = intersectionArea(bounds, display.bounds);
    if (area > largestIntersection) {
      selected = display;
      largestIntersection = area;
    }
  }

  return { display: selected, intersects: largestIntersection > 0 };
}

function fitPersistedBounds(
  bounds: WindowRectangle,
  workArea: WindowRectangle,
  minimumSize: WindowSize,
  center: boolean
): { bounds: WindowRectangle; minimumSize: WindowSize } {
  const effectiveMinimum = effectiveMinimumSize(minimumSize, workArea);
  const size = {
    width: clamp(bounds.width, effectiveMinimum.width, workArea.width),
    height: clamp(bounds.height, effectiveMinimum.height, workArea.height),
  };

  if (center) {
    return {
      bounds: centerBounds(size, workArea),
      minimumSize: effectiveMinimum,
    };
  }

  return {
    bounds: {
      x: clamp(bounds.x, workArea.x, workArea.x + workArea.width - size.width),
      y: clamp(
        bounds.y,
        workArea.y,
        workArea.y + workArea.height - size.height
      ),
      ...size,
    },
    minimumSize: effectiveMinimum,
  };
}

export function resolveWindowStartupState(
  options: ResolveWindowStartupStateOptions
): WindowStartupState {
  const { displays, primary } = normalizedDisplays(
    options.displays,
    options.primaryDisplay
  );
  const minimumSize =
    normalizeWindowSize(options.minimumSize ?? DEFAULT_MINIMUM_WINDOW_SIZE) ??
    DEFAULT_MINIMUM_WINDOW_SIZE;

  if (options.persistedState) {
    const persistedState = parseWindowState(options.persistedState);
    if (persistedState) {
      const match = displayForBounds(persistedState.bounds, displays, primary);
      const fitted = fitPersistedBounds(
        persistedState.bounds,
        match.display.workArea,
        minimumSize,
        !match.intersects
      );
      return {
        ...fitted,
        shouldMaximize: persistedState.isMaximized,
        source: 'persisted',
      };
    }
  }

  const fitted = fitPreferredWindowSize(
    DEFAULT_WINDOW_SIZE,
    primary.workArea,
    minimumSize
  );

  return {
    bounds: centerBounds(fitted.size, primary.workArea),
    minimumSize: fitted.minimumSize,
    shouldMaximize: false,
    source: 'default',
  };
}

/**
 * Lenient startup helper: invalid or missing disk state resolves to the
 * 1440x810 default, fitted to the primary display while preserving 16:9.
 *
 * Integration outline (call only after `app.whenReady()` so `screen` is ready):
 *
 * ```ts
 * const startup = loadWindowStartupState({
 *   userDataPath: app.getPath('userData'),
 *   displays: screen.getAllDisplays(),
 *   primaryDisplay: screen.getPrimaryDisplay(),
 * });
 * win = new BrowserWindow({
 *   ...startup.bounds,
 *   minWidth: startup.minimumSize.width,
 *   minHeight: startup.minimumSize.height,
 *   show: false,
 * });
 * // Only maximize after content is ready: maximize() also shows the window.
 * if (startup.shouldMaximize) win.maximize();
 * else win.show();
 * ```
 *
 * Call `persistWindowState()` before the app's quit cleanup destroys the
 * BrowserWindow. It is also safe to call from a debounced move/resize handler.
 */
export function loadWindowStartupState(
  options: LoadWindowStartupStateOptions
): WindowStartupState {
  return resolveWindowStartupState({
    ...options,
    persistedState: readWindowState(options.userDataPath, options.io),
  });
}

export function captureWindowState(
  source: WindowStateSource
): PersistedWindowStateV2 {
  const bounds = normalizeWindowRectangle(source.getNormalBounds());
  if (!bounds) throw new Error('BrowserWindow returned invalid normal bounds');

  // Deliberately persist neither minimized nor fullscreen state. Normal bounds
  // plus maximized is the complete restorable schema for this release.
  return {
    version: WINDOW_STATE_VERSION,
    bounds,
    isMaximized: Boolean(source.isMaximized()),
  };
}

/** Write to a same-directory temporary file, then atomically replace the state. */
export function writeWindowState(
  userDataPath: string,
  state: PersistedWindowStateV2,
  io: WindowStateIO = NODE_WINDOW_STATE_IO
): void {
  const normalized = parseWindowState(state);
  if (!normalized) throw new Error('Cannot persist invalid window state');

  const statePath = getWindowStatePath(userDataPath);
  const temporaryPath = `${statePath}.tmp`;
  try {
    io.writeText(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`);
    io.rename(temporaryPath, statePath);
  } catch (error) {
    try {
      io.remove(temporaryPath);
    } catch {
      // Keep the original persistence error; a stale temp file is recoverable.
    }
    throw error;
  }
}

export function persistWindowState(
  userDataPath: string,
  source: WindowStateSource,
  io: WindowStateIO = NODE_WINDOW_STATE_IO
): PersistedWindowStateV2 {
  const state = captureWindowState(source);
  writeWindowState(userDataPath, state, io);
  return state;
}
