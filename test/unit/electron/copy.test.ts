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

import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';

vi.mock('fs-extra', () => ({
  default: {
    existsSync: vi.fn(),
    copy: vi.fn(),
  },
}));

import fs from 'fs-extra';
import path from 'path';
import { copyBrowserData } from '../../../electron/main/copy';

const mockExistsSync = fs.existsSync as Mock;
const mockCopy = fs.copy as Mock;

describe('copyBrowserData', () => {
  const browserName = 'chrome';
  const browserPath = '/home/user/.config/google-chrome';
  const electronUserDataPath = '/home/user/.eigent';

  beforeEach(() => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockCopy.mockResolvedValue(undefined);
  });

  it('copies Local Storage directory when source exists', async () => {
    mockExistsSync.mockImplementation(
      (p: string) => p === path.join(browserPath, 'Local Storage')
    );

    await copyBrowserData(browserName, browserPath, electronUserDataPath);

    expect(mockCopy).toHaveBeenCalledWith(
      path.join(browserPath, 'Local Storage'),
      path.join(electronUserDataPath, browserName, 'Local Storage'),
      { overwrite: true }
    );
  });

  it('copies IndexedDB directory when source exists', async () => {
    mockExistsSync.mockImplementation(
      (p: string) => p === path.join(browserPath, 'IndexedDB')
    );

    await copyBrowserData(browserName, browserPath, electronUserDataPath);

    expect(mockCopy).toHaveBeenCalledWith(
      path.join(browserPath, 'IndexedDB'),
      path.join(electronUserDataPath, browserName, 'IndexedDB'),
      { overwrite: true }
    );
  });

  it('copies Cookies file when source exists', async () => {
    mockExistsSync.mockImplementation(
      (p: string) => p === path.join(browserPath, 'Cookies')
    );

    await copyBrowserData(browserName, browserPath, electronUserDataPath);

    expect(mockCopy).toHaveBeenCalledWith(
      path.join(browserPath, 'Cookies'),
      path.join(electronUserDataPath, browserName, 'Cookies'),
      { overwrite: true }
    );
  });

  it('skips subdirs that do not exist at source', async () => {
    mockExistsSync.mockReturnValue(false);

    await copyBrowserData(browserName, browserPath, electronUserDataPath);

    expect(mockCopy).not.toHaveBeenCalled();
  });

  it('handles mixed existence — only copies what exists', async () => {
    mockExistsSync.mockImplementation((p: string) => {
      if (p.endsWith('Local Storage')) return true;
      if (p.endsWith('IndexedDB')) return false;
      if (p.endsWith('Cookies')) return true;
      return false;
    });

    await copyBrowserData(browserName, browserPath, electronUserDataPath);

    expect(mockCopy).toHaveBeenCalledTimes(2);
    expect(mockCopy).toHaveBeenCalledWith(
      path.join(browserPath, 'Local Storage'),
      path.join(electronUserDataPath, browserName, 'Local Storage'),
      { overwrite: true }
    );
    expect(mockCopy).toHaveBeenCalledWith(
      path.join(browserPath, 'Cookies'),
      path.join(electronUserDataPath, browserName, 'Cookies'),
      { overwrite: true }
    );
    // IndexedDB should NOT have been copied
    expect(mockCopy).not.toHaveBeenCalledWith(
      path.join(browserPath, 'IndexedDB'),
      expect.anything(),
      expect.anything()
    );
  });

  it('logs success message for each copied item', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockExistsSync.mockReturnValue(true);

    await copyBrowserData(browserName, browserPath, electronUserDataPath);

    expect(logSpy).toHaveBeenCalledWith(
      `[${browserName}] copy Local Storage success`
    );
    expect(logSpy).toHaveBeenCalledWith(
      `[${browserName}] copy IndexedDB success`
    );
    expect(logSpy).toHaveBeenCalledWith(
      `[${browserName}] copy Cookies success`
    );

    logSpy.mockRestore();
  });

  it('does not log for skipped items', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockExistsSync.mockImplementation((p: string) => p.endsWith('Cookies'));

    await copyBrowserData(browserName, browserPath, electronUserDataPath);

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      `[${browserName}] copy Cookies success`
    );
    // Should NOT log for Local Storage or IndexedDB
    expect(logSpy).not.toHaveBeenCalledWith(
      `[${browserName}] copy Local Storage success`
    );
    expect(logSpy).not.toHaveBeenCalledWith(
      `[${browserName}] copy IndexedDB success`
    );

    logSpy.mockRestore();
  });

  it('nests destination under browserName subdirectory', async () => {
    mockExistsSync.mockReturnValue(true);

    await copyBrowserData('firefox', '/b', '/e');

    // Every destination path must start with /e/firefox
    const calls = mockCopy.mock.calls as [string, string, object][];
    for (const [, dest] of calls) {
      expect(dest.startsWith(path.join('/e', 'firefox'))).toBe(true);
    }
  });

  it('passes overwrite: true to every fs.copy call', async () => {
    mockExistsSync.mockReturnValue(true);

    await copyBrowserData(browserName, browserPath, electronUserDataPath);

    const calls = mockCopy.mock.calls as [
      string,
      string,
      { overwrite: boolean },
    ][];
    for (const call of calls) {
      expect(call[2]).toEqual({ overwrite: true });
    }
  });
});
