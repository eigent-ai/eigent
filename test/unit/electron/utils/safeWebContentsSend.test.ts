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

/**
 * Unit tests for electron/main/utils/safeWebContentsSend.ts
 *
 * Tests safeMainWindowSend:
 * - Sends message when main window exists and is not destroyed
 * - Returns false and warns when main window is null
 * - Returns false and warns when main window is destroyed
 * - Sends data payload correctly
 * - Sends without data payload
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockWebContentsSend = vi.fn();

const mockMainWindow = {
  isDestroyed: vi.fn().mockReturnValue(false),
  webContents: {
    send: mockWebContentsSend,
  },
};

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

let _getMainWindowOverride: typeof mockMainWindow | null = mockMainWindow;

vi.mock('../../../../electron/main/init', () => ({
  getMainWindow: () => _getMainWindowOverride,
}));

// ---------------------------------------------------------------------------
// Import module under test (after mocks)
// ---------------------------------------------------------------------------

import { safeMainWindowSend } from '../../../../electron/main/utils/safeWebContentsSend';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('safeMainWindowSend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _getMainWindowOverride = mockMainWindow;
    mockMainWindow.isDestroyed.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should send message to main window when it exists and is not destroyed', () => {
    const result = safeMainWindowSend('test-channel', { key: 'value' });

    expect(result).toBe(true);
    expect(mockWebContentsSend).toHaveBeenCalledWith('test-channel', {
      key: 'value',
    });
  });

  it('should send message without data payload', () => {
    const result = safeMainWindowSend('test-channel');

    expect(result).toBe(true);
    expect(mockWebContentsSend).toHaveBeenCalledWith('test-channel', undefined);
  });

  it('should return false when main window is null', () => {
    _getMainWindowOverride = null;

    const result = safeMainWindowSend('test-channel');

    expect(result).toBe(false);
    expect(mockWebContentsSend).not.toHaveBeenCalled();
  });

  it('should return false when main window is destroyed', () => {
    mockMainWindow.isDestroyed.mockReturnValue(true);

    const result = safeMainWindowSend('test-channel', 'data');

    expect(result).toBe(false);
    expect(mockWebContentsSend).not.toHaveBeenCalled();
  });

  it('should warn via electron-log when window is unavailable', async () => {
    const { default: log } = await import('electron-log');
    _getMainWindowOverride = null;

    safeMainWindowSend('some-channel', 'payload');

    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Cannot send message to main window: some-channel'
      ),
      'payload'
    );
  });

  it('should warn via electron-log when window is destroyed', async () => {
    const { default: log } = await import('electron-log');
    mockMainWindow.isDestroyed.mockReturnValue(true);

    safeMainWindowSend('destroyed-channel');

    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Cannot send message to main window: destroyed-channel'
      ),
      undefined
    );
  });
});
