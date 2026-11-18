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

export const DOWNLOAD_BACKEND_FILE_CHANNEL = 'download-backend-file';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);
const FILE_STREAM_PATH = /^(?:\/api\/v1)?\/files\/stream(?:\/[^/]+)?$/;

/**
 * Return `url` when it reads a file from the app's own local backend.
 *
 * The renderer asks the main process to save files that are too large to
 * load into memory. Only the file route of the backend this app started is
 * accepted, so the channel cannot be used to download an arbitrary URL.
 */
export function backendFileDownloadUrl(
  url: unknown,
  backendPort: number
): string | null {
  if (typeof url !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== 'http:' ||
    !LOOPBACK_HOSTS.has(parsed.hostname) ||
    parsed.port !== String(backendPort) ||
    parsed.username ||
    parsed.password ||
    !FILE_STREAM_PATH.test(parsed.pathname)
  ) {
    return null;
  }
  return parsed.toString();
}
