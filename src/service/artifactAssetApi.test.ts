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

import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { proxyFetchGetMock, fetchGetBlobMock } = vi.hoisted(() => ({
  proxyFetchGetMock: vi.fn(),
  fetchGetBlobMock: vi.fn(),
}));

vi.mock('@/api/http', () => ({
  proxyFetchGet: proxyFetchGetMock,
  fetchGetBlob: fetchGetBlobMock,
}));
vi.mock('@/store/authStore', () => ({ getAuthStore: () => ({}) }));
vi.mock('@/lib/authEnvironment', () => ({
  getAccountEnvironmentKey: () => 'synthetic-account',
}));

import { resolveArtifactAssetFile } from './artifactAssetApi';

describe('Artifact asset resolution', () => {
  beforeEach(() => {
    proxyFetchGetMock.mockReset();
    fetchGetBlobMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('opens verified Run bytes and releases the object URL when its preview closes', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const createObjectURL = vi.fn(() => 'blob:saved-run');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const blob = {
      size: 5,
      arrayBuffer: async () => new TextEncoder().encode('run-1').buffer,
    };
    fetchGetBlobMock.mockResolvedValue(blob);
    const controller = new AbortController();
    const file: FileInfo = {
      name: 'result.txt',
      type: 'txt',
      path: '/space/result.txt',
      artifactId: 'artifact-1',
      workspaceArtifact: {
        runId: 'run-1',
        contentDigest:
          '4e65d3fbe8ad6535681b021b30785b12b6c0e3f8878859a4148b3f58b8835db0',
      },
    };
    await expect(
      resolveArtifactAssetFile(file, controller.signal)
    ).resolves.toMatchObject({ path: 'blob:saved-run', isRemote: true });
    expect(fetchGetBlobMock).toHaveBeenCalledWith(
      '/runs/run-1/artifacts/artifact-1/content',
      undefined,
      {
        signal: controller.signal,
        expectedAccountKey: 'synthetic-account',
      }
    );
    controller.abort();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:saved-run');
    const next = new AbortController();
    await expect(
      resolveArtifactAssetFile(
        {
          ...file,
          workspaceArtifact: {
            ...file.workspaceArtifact!,
            contentDigest: 'changed',
          },
        },
        next.signal
      )
    ).rejects.toThrow('Artifact content changed');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
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
