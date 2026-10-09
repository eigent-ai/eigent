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
 * Brain file URLs are loaded by <img>, <iframe>, media elements and the
 * system browser, none of which can send the Desktop capability header. The
 * Brain therefore reads a file only for a URL that carries a short-lived
 * grant for that file's project root, issued through the authenticated API.
 */

import { fetchPost, getBaseURL } from '@/api/http';
import { isRemotePreviewSource } from '@/lib/filePreviewLoader';

const ACCESS_PARAM = 'access';
const STREAM_ROUTE = '/files/stream';
const SCOPE_PARAMS = ['project_id', 'email', 'space_id', 'user_id'] as const;

function parseUrl(url: string): URL | null {
  try {
    return new URL(url, window.location.href);
  } catch {
    return null;
  }
}

function parseStreamUrl(url: string): URL | null {
  const parsed = parseUrl(url);
  return parsed?.pathname.endsWith(STREAM_ROUTE) &&
    parsed.searchParams.get('project_id') &&
    parsed.searchParams.get('email')
    ? parsed
    : null;
}

/** Keep a Brain-relative URL relative so path comparisons still match. */
function serializeLike(url: URL, original: string): string {
  return /^[a-z][a-z\d+.-]*:|^\/\//i.test(original)
    ? url.toString()
    : `${url.pathname}${url.search}${url.hash}`;
}

function encodePathSegments(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/**
 * Return `file` with a fresh grant on its URL when it is a file on the
 * connected Brain. Any other file, or a failed request, is returned unchanged.
 */
export async function authorizeBrainFile(file: FileInfo): Promise<FileInfo> {
  if (file.isFolder || !isRemotePreviewSource(file)) return file;
  const url = parseStreamUrl(file.path);
  if (!url) return file;
  const baseURL = await getBaseURL().catch(() => '');
  if (url.origin !== parseUrl(baseURL || window.location.href)?.origin) {
    return file;
  }

  const response = await fetchPost('/files/access', {
    project_id: url.searchParams.get('project_id'),
    email: url.searchParams.get('email'),
    space_id: url.searchParams.get('space_id') || undefined,
    user_id: url.searchParams.get('user_id') || undefined,
  }).catch(() => null);
  const access = response?.access;
  if (typeof access !== 'string' || !access) return file;

  url.searchParams.set(ACCESS_PARAM, access);
  return { ...file, path: serializeLike(url, file.path) };
}

/**
 * Give `url` the grant on `authorizedUrl` when both read the same Brain file
 * root, so an HTML preview can load the project files it references.
 */
export function shareBrainFileAccess(
  url: string,
  authorizedUrl: string
): string {
  const target = parseStreamUrl(url);
  const source = parseStreamUrl(authorizedUrl);
  const access = source?.searchParams.get(ACCESS_PARAM);
  if (!target || !source || !access) return url;
  if (
    target.origin !== source.origin ||
    target.pathname !== source.pathname ||
    SCOPE_PARAMS.some(
      (key) =>
        (target.searchParams.get(key) || '') !==
        (source.searchParams.get(key) || '')
    )
  ) {
    return url;
  }
  target.searchParams.set(ACCESS_PARAM, access);
  return serializeLike(target, url);
}

/**
 * Path-based URL for previewing `relativePath` from the root of `streamUrl`,
 * so relative links inside a previewed HTML page resolve on the Brain. The
 * grant is a path segment, which those relative links keep.
 */
export function getBrainFilePreviewUrl(
  streamUrl: string,
  relativePath: string
): string | undefined {
  const url = parseStreamUrl(streamUrl);
  const filePath = encodePathSegments(relativePath);
  if (!url || !filePath) return undefined;

  const routePrefix = url.pathname.slice(0, -STREAM_ROUTE.length);
  const previewRoot = `${url.origin}${routePrefix}/files/preview`;
  const access = url.searchParams.get(ACCESS_PARAM);
  if (access) {
    return `${previewRoot}/${encodeURIComponent(access)}/${filePath}`;
  }

  // A Brain that predates grants names the root in the path and query.
  const query = new URLSearchParams();
  const spaceId = url.searchParams.get('space_id');
  const userId = url.searchParams.get('user_id');
  if (spaceId) query.set('space_id', spaceId);
  if (userId) query.set('user_id', userId);
  const queryString = query.toString();
  return `${previewRoot}/${encodeURIComponent(url.searchParams.get('email') || '')}/${encodeURIComponent(url.searchParams.get('project_id') || '')}/${filePath}${queryString ? `?${queryString}` : ''}`;
}
