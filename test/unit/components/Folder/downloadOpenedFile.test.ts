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

import { downloadOpenedFile } from '@/components/Folder';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { authorizeBrainFileMock } = vi.hoisted(() => ({
  authorizeBrainFileMock: vi.fn(),
}));

vi.mock('@/lib/brainFileAccess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/brainFileAccess')>()),
  authorizeBrainFile: authorizeBrainFileMock,
}));

const brain = 'http://127.0.0.1:5001';
const scope = 'path=report.pdf&project_id=p1&email=u%40e.com';

function pdfFile(access: string): FileInfo {
  return {
    name: 'report.pdf',
    path: `${brain}/files/stream?${scope}&access=${access}`,
    relativePath: 'report.pdf',
    type: 'pdf',
    isRemote: true,
  } as FileInfo;
}

describe('downloadOpenedFile', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockResolvedValue(
      new Response(new Blob(['%PDF']), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = vi.fn(() => 'blob:download');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('downloads a Brain file with a fresh grant, not the preview one', async () => {
    authorizeBrainFileMock.mockImplementation(async (file: FileInfo) => ({
      ...file,
      path: file.path.replace('access=OLD', 'access=NEW'),
    }));

    await downloadOpenedFile(pdfFile('OLD'));

    expect(authorizeBrainFileMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requested = new URL(fetchMock.mock.calls[0][0]);
    expect(requested.searchParams.get('access')).toBe('NEW');
  });

  describe('a file whose preview was blocked', () => {
    const blocked = (path: string): FileInfo =>
      ({
        ...pdfFile('OLD'),
        path,
        preview: { kind: 'blocked', reason: 'too-large', size: 9, limit: 1 },
      }) as FileInfo;
    const brainPath = pdfFile('OLD').path;
    const openMock = vi.fn();

    beforeEach(() => {
      vi.stubGlobal('open', openMock);
      authorizeBrainFileMock.mockImplementation(async (file: FileInfo) => ({
        ...file,
        path: file.path.replace('access=OLD', 'access=NEW'),
      }));
    });

    it('is saved by the desktop host with a fresh grant, never fetched', async () => {
      const invoke = vi.fn().mockResolvedValue({ success: true });

      await downloadOpenedFile(blocked(brainPath), { invoke });

      expect(invoke).toHaveBeenCalledTimes(1);
      const [channel, url] = invoke.mock.calls[0];
      expect(channel).toBe('download-backend-file');
      expect(new URL(url).searchParams.get('access')).toBe('NEW');
      expect(openMock).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('opens in the browser at once when there is no desktop host', () => {
      void downloadOpenedFile(blocked(brainPath), null);

      // Synchronous, so the browser still treats it as the user's click.
      expect(openMock).toHaveBeenCalledWith(
        brainPath,
        '_blank',
        'noopener,noreferrer'
      );
      expect(authorizeBrainFileMock).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('leaves a file from another site to the browser on desktop', () => {
      const invoke = vi.fn();
      const cloudPath = 'https://files.example.com/a/report.pdf?sig=1';

      void downloadOpenedFile(blocked(cloudPath), { invoke });

      expect(openMock).toHaveBeenCalledWith(
        cloudPath,
        '_blank',
        'noopener,noreferrer'
      );
      expect(invoke).not.toHaveBeenCalled();
    });

    it('falls back to opening the URL when the desktop host refuses it', async () => {
      const invoke = vi.fn().mockResolvedValue({ success: false });
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      await downloadOpenedFile(blocked(brainPath), { invoke });

      expect(openMock).toHaveBeenCalledTimes(1);
    });
  });

  it('still tries the existing URL when a fresh grant cannot be obtained', async () => {
    authorizeBrainFileMock.mockRejectedValue(new Error('offline'));

    await downloadOpenedFile(pdfFile('OLD'));

    const requested = new URL(fetchMock.mock.calls[0][0]);
    expect(requested.searchParams.get('access')).toBe('OLD');
  });
});
