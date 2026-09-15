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

import { FilePreview } from '@/components/Folder/FilePreview';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  invokeMock,
  hostMock,
  loadFilePreviewMock,
  resolveArtifactAssetFileMock,
  toastErrorMock,
} = vi.hoisted(() => {
  const invokeMock = vi.fn();
  return {
    invokeMock,
    hostMock: { ipcRenderer: { invoke: invokeMock } },
    loadFilePreviewMock: vi.fn(),
    resolveArtifactAssetFileMock: vi.fn(),
    toastErrorMock: vi.fn(),
  };
});

vi.mock('@/host', () => ({
  useHost: () => hostMock,
}));

vi.mock('@/lib/filePreviewLoader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/filePreviewLoader')>()),
  loadFilePreview: loadFilePreviewMock,
}));

vi.mock('@/service/artifactAssetApi', () => ({
  resolveArtifactAssetFile: resolveArtifactAssetFileMock,
}));

vi.mock('sonner', () => ({
  toast: { error: toastErrorMock },
}));

vi.mock('@/components/Folder/index', () => ({
  downloadFromUrl: vi.fn(),
  downloadOpenedFile: vi.fn(),
  FileViewerPanel: ({
    selectedFile,
    onRevealFile,
    onOpenExternalFile,
    loadFailed,
    onRetry,
  }: {
    loadFailed?: boolean;
    onRetry?: () => void;
    selectedFile: FileInfo | null;
    onRevealFile: () => void;
    onOpenExternalFile: () => void;
  }) => (
    <>
      <span>{selectedFile?.name}</span>
      {loadFailed && (
        <div role="alert">
          Failed<button onClick={onRetry}>Retry</button>
        </div>
      )}
      <button type="button" disabled={!selectedFile} onClick={onRevealFile}>
        Reveal file
      </button>
      {selectedFile?.preview?.kind === 'blocked' && (
        <button type="button" onClick={onOpenExternalFile}>
          Open externally
        </button>
      )}
    </>
  ),
}));

describe('FilePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveArtifactAssetFileMock.mockImplementation(async (file) => file);
    loadFilePreviewMock.mockImplementation(async (file) => ({
      ...file,
      content: 'preview content',
    }));
    invokeMock.mockResolvedValue({ success: true });
  });

  it('shows feedback when a local file cannot be revealed', async () => {
    invokeMock.mockResolvedValue({
      success: false,
      error: 'Path is outside the active workspace',
    });
    render(
      <FilePreview
        file={{
          name: 'legacy-report.txt',
          path: '/legacy/legacy-report.txt',
          relativePath: 'legacy-report.txt',
          type: 'txt',
        }}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Reveal file' }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        'Path is outside the active workspace'
      )
    );
  });

  it('opens an unsupported local Blender file only through the existing workspace action on a user click', async () => {
    loadFilePreviewMock.mockImplementation(async (file) => ({
      ...file,
      content: undefined,
      preview: {
        kind: 'blocked',
        reason: 'unsupported',
        size: 2048,
        limit: null,
      },
    }));
    render(
      <FilePreview
        file={{
          name: 'scene.blend',
          type: 'blend',
          path: '/workspace/scene.blend',
          relativePath: 'scene.blend',
        }}
      />
    );
    const openButton = await screen.findByRole('button', {
      name: 'Open externally',
    });
    expect(invokeMock).not.toHaveBeenCalled();
    fireEvent.click(openButton);
    expect(invokeMock).toHaveBeenCalledWith(
      'open-local-file',
      '/workspace/scene.blend'
    );
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});

describe('file selection and loading recovery', () => {
  const file = {
    name: 'archive.zip',
    path: '/workspace/archive.zip',
    type: 'zip',
  };
  beforeEach(() => {
    vi.clearAllMocks();
    resolveArtifactAssetFileMock.mockImplementation(async (target) => target);
    loadFilePreviewMock.mockImplementation(async (target) => target);
  });
  it('preserves ZIP selection and sends it through the shared loader', async () => {
    render(<FilePreview file={file} />);
    await waitFor(() =>
      expect(loadFilePreviewMock).toHaveBeenCalledWith(file, expect.anything())
    );
    expect(screen.getByText('archive.zip')).toBeInTheDocument();
  });
  it('shows a load error and retries the selected file', async () => {
    loadFilePreviewMock
      .mockRejectedValueOnce(new Error('denied'))
      .mockResolvedValueOnce(file);
    render(<FilePreview file={file} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(loadFilePreviewMock).toHaveBeenCalledTimes(2);
  });
  it('does not restore a cleared selection when an old request finishes', async () => {
    let resolve!: (value: FileInfo) => void;
    loadFilePreviewMock.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    const { rerender } = render(<FilePreview file={file} />);
    await waitFor(() => expect(loadFilePreviewMock).toHaveBeenCalledTimes(1));
    rerender(<FilePreview file={null} />);
    resolve(file);
    await waitFor(() => expect(screen.queryByText('archive.zip')).toBeNull());
    expect(screen.getByRole('button', { name: 'Reveal file' })).toBeDisabled();
  });
});
