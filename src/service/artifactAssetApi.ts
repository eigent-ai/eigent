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

import { proxyFetchGet } from '@/api/http';

type ArtifactDownloadResponse = {
  download_url: string;
  content_digest?: string | null;
};

/** Resolve a Cloud-restored Artifact into the same bounded preview pipeline. */
export async function resolveArtifactAssetFile(
  file: FileInfo
): Promise<FileInfo> {
  if (file.localPathAvailable !== false) return file;
  if (/^https?:\/\//i.test(file.path)) return file;
  const chatFileId = file.assetRef?.chatFileId;
  if (typeof chatFileId !== 'number') {
    throw new Error('This Artifact has not finished uploading yet.');
  }
  const result = (await proxyFetchGet(
    `/api/v1/chat/files/${encodeURIComponent(chatFileId)}/download`
  )) as ArtifactDownloadResponse;
  if (!result?.download_url) {
    throw new Error('Artifact download URL is unavailable.');
  }
  return {
    ...file,
    path: result.download_url,
    isRemote: true,
    size: file.assetRef?.size ?? file.size,
    mimeType: file.assetRef?.contentType ?? file.mimeType,
  };
}
