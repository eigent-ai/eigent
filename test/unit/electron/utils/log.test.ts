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
 * Unit tests for electron/main/utils/log.ts
 *
 * Tests zipFolder utility:
 * - Resolves with output path on successful archive close
 * - Rejects on archive error
 * - Pipes archive to output stream
 * - Calls archive.directory and archive.finalize
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockOutputOn = vi.fn();
const mockArchivePipe = vi.fn();
const mockArchiveDirectory = vi.fn();
const mockArchiveFinalize = vi.fn();
const mockArchiveOn = vi.fn();

vi.mock('node:fs', () => {
  const mockCreateWriteStream = vi.fn(() => ({
    on: mockOutputOn,
  }));
  return {
    default: {
      createWriteStream: mockCreateWriteStream,
    },
    createWriteStream: mockCreateWriteStream,
  };
});

vi.mock('archiver', () => {
  return {
    default: vi.fn(() => ({
      on: mockArchiveOn,
      pipe: mockArchivePipe,
      directory: mockArchiveDirectory,
      finalize: mockArchiveFinalize,
    })),
  };
});

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import module under test (after mocks)
// ---------------------------------------------------------------------------

import { zipFolder } from '../../../../electron/main/utils/log';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('zipFolder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should resolve with output path when archive closes successfully', async () => {
    // Simulate the 'close' event on the output stream
    mockOutputOn.mockImplementation((event: string, handler: Function) => {
      if (event === 'close') {
        setTimeout(() => handler(), 0);
      }
    });
    mockArchiveOn.mockImplementation(() => {});
    mockArchiveFinalize.mockImplementation(() => {});

    const result = await zipFolder('/input/folder', '/output/archive.zip');

    expect(result).toBe('/output/archive.zip');
  });

  it('should reject when archive encounters an error', async () => {
    const testError = new Error('archive write error');

    mockOutputOn.mockImplementation(() => {});
    mockArchiveOn.mockImplementation((event: string, handler: Function) => {
      if (event === 'error') {
        setTimeout(() => handler(testError), 0);
      }
    });
    mockArchiveFinalize.mockImplementation(() => {});

    await expect(
      zipFolder('/input/folder', '/output/archive.zip')
    ).rejects.toThrow('archive write error');
  });

  it('should create a write stream to the output path', async () => {
    mockOutputOn.mockImplementation((event: string, handler: Function) => {
      if (event === 'close') {
        setTimeout(() => handler(), 0);
      }
    });
    mockArchiveOn.mockImplementation(() => {});
    mockArchiveFinalize.mockImplementation(() => {});

    await zipFolder('/input/folder', '/output/archive.zip');

    const { createWriteStream } = await import('node:fs');
    expect(createWriteStream).toHaveBeenCalledWith('/output/archive.zip');
  });

  it('should pipe archive to the output stream', async () => {
    mockOutputOn.mockImplementation((event: string, handler: Function) => {
      if (event === 'close') {
        setTimeout(() => handler(), 0);
      }
    });
    mockArchiveOn.mockImplementation(() => {});
    mockArchiveFinalize.mockImplementation(() => {});

    await zipFolder('/input/folder', '/output/archive.zip');

    expect(mockArchivePipe).toHaveBeenCalled();
  });

  it('should call archive.directory with the folder path and false', async () => {
    mockOutputOn.mockImplementation((event: string, handler: Function) => {
      if (event === 'close') {
        setTimeout(() => handler(), 0);
      }
    });
    mockArchiveOn.mockImplementation(() => {});
    mockArchiveFinalize.mockImplementation(() => {});

    await zipFolder('/my/folder', '/my/output.zip');

    expect(mockArchiveDirectory).toHaveBeenCalledWith('/my/folder', false);
  });

  it('should call archive.finalize', async () => {
    mockOutputOn.mockImplementation((event: string, handler: Function) => {
      if (event === 'close') {
        setTimeout(() => handler(), 0);
      }
    });
    mockArchiveOn.mockImplementation(() => {});
    mockArchiveFinalize.mockImplementation(() => {});

    await zipFolder('/input', '/output.zip');

    expect(mockArchiveFinalize).toHaveBeenCalled();
  });

  it('should create archiver with zip format and max compression', async () => {
    const archiver = (await import('archiver')).default;

    mockOutputOn.mockImplementation((event: string, handler: Function) => {
      if (event === 'close') {
        setTimeout(() => handler(), 0);
      }
    });
    mockArchiveOn.mockImplementation(() => {});
    mockArchiveFinalize.mockImplementation(() => {});

    await zipFolder('/input', '/output.zip');

    expect(archiver).toHaveBeenCalledWith('zip', { zlib: { level: 9 } });
  });

  it('should log error via electron-log when archive errors', async () => {
    const { default: log } = await import('electron-log');
    const testError = new Error('compression failed');

    mockOutputOn.mockImplementation(() => {});
    mockArchiveOn.mockImplementation((event: string, handler: Function) => {
      if (event === 'error') {
        setTimeout(() => handler(testError), 0);
      }
    });
    mockArchiveFinalize.mockImplementation(() => {});

    try {
      await zipFolder('/input', '/output.zip');
    } catch {
      // Expected rejection
    }

    expect(log.error).toHaveBeenCalledWith('Archive error:', testError);
  });
});
