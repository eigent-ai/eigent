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

vi.mock('@/lib/filePreviewLoader', () => ({
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
  }: {
    selectedFile: FileInfo | null;
    onRevealFile: () => void;
  }) => (
    <button type="button" disabled={!selectedFile} onClick={onRevealFile}>
      Reveal file
    </button>
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
});
