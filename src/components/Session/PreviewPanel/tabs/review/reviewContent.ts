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

import type { ReviewFile } from './useReviewChanges';

const RASTER_IMAGE_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'webp',
]);

/** Raster images use the binary preview endpoint instead of the text diff. */
export function isRasterImagePreviewPath(path: string): boolean {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? '';
  return RASTER_IMAGE_EXTENSIONS.has(extension);
}

/**
 * Text of a file the `read-file` IPC returned, or null when the bytes are
 * binary. Only the head is probed: a NUL byte anywhere in it means no text
 * diff is possible.
 */
export function decodeFileText(data: unknown): string | null {
  if (typeof data === 'string') return data;
  // `ArrayBuffer.isView` rather than `instanceof Uint8Array`: the bytes cross
  // an IPC boundary and may arrive as a Buffer or from another realm, where
  // instanceof silently fails and would report every file as binary.
  if (!ArrayBuffer.isView(data)) return null;
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const probe = bytes.subarray(0, 8000);
  for (const byte of probe) {
    if (byte === 0) return null;
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * Which file supplies each side of a diff. Before = the earliest backup the
 * file toolkit left; after = the file on disk now. An added file has no
 * before-side and a deleted one no after-side, so those read as empty.
 */
export function diffSidePaths(file: ReviewFile): {
  original: string | null;
  modified: string | null;
} {
  return {
    original: file.status === 'added' ? null : file.bakPath,
    modified: file.status === 'deleted' ? null : file.absPath,
  };
}
