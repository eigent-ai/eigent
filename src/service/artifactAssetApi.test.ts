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

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { proxyFetchGetMock } = vi.hoisted(() => ({
  proxyFetchGetMock: vi.fn(),
}));

vi.mock('@/api/http', () => ({
  proxyFetchGet: proxyFetchGetMock,
}));

import { resolveArtifactAssetFile } from './artifactAssetApi';

describe('Artifact asset resolution', () => {
  beforeEach(() => {
    proxyFetchGetMock.mockReset();
  });

  it('keeps an available local Artifact on the local preview path', async () => {
    const file = {
      name: 'report.csv',
      type: 'csv',
      path: '/workspace/report.csv',
      localPathAvailable: true,
    } as FileInfo;

    await expect(resolveArtifactAssetFile(file)).resolves.toBe(file);
    expect(proxyFetchGetMock).not.toHaveBeenCalled();
  });

  it('resolves a Cloud-restored Artifact through the authenticated API', async () => {
    proxyFetchGetMock.mockResolvedValue({
      download_url: 'https://assets.example/report.csv?signature=one',
    });
    const file = {
      name: 'report.csv',
      type: 'csv',
      // Portable identity must not bypass Cloud asset resolution.
      path: 'reports/report.csv',
      localPathAvailable: false,
      assetRef: {
        chatFileId: 73,
        key: 'user/run/files/report.csv',
        size: 123,
        contentType: 'text/csv',
      },
    } as FileInfo;

    await expect(resolveArtifactAssetFile(file)).resolves.toMatchObject({
      path: 'https://assets.example/report.csv?signature=one',
      isRemote: true,
      size: 123,
      mimeType: 'text/csv',
    });
    expect(proxyFetchGetMock).toHaveBeenCalledWith(
      '/api/v1/chat/files/73/download'
    );
  });

  it('does not silently treat an unfinished upload as a local file', async () => {
    const file = {
      name: 'report.csv',
      type: 'csv',
      path: '',
      localPathAvailable: false,
    } as FileInfo;

    await expect(resolveArtifactAssetFile(file)).rejects.toThrow(
      'has not finished uploading'
    );
    expect(proxyFetchGetMock).not.toHaveBeenCalled();
  });
});
