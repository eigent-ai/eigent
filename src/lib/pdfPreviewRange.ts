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

import { FILE_PREVIEW_LIMITS } from '@/shared/filePreviewContract';

/** Read exactly one authorized range. Never allocate an unbounded response if
 * an endpoint ignores Range or changes size after the metadata check. */
export async function readPdfRange(
  url: string,
  begin: number,
  end: number,
  size: number,
  signal: AbortSignal
): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > FILE_PREVIEW_LIMITS.pdfBytes ||
    !Number.isSafeInteger(begin) ||
    !Number.isSafeInteger(end) ||
    begin < 0 ||
    end <= begin ||
    end > size
  ) {
    throw new Error('Invalid PDF preview range');
  }
  const response = await fetch(url, {
    headers: { Range: `bytes=${begin}-${end - 1}` },
    credentials: 'same-origin',
    signal,
  });
  const validRange =
    response.status === 206 &&
    response.headers.get('content-range') ===
      `bytes ${begin}-${end - 1}/${size}`;
  const validFull = response.status === 200 && begin === 0 && end === size;
  if (!validRange && !validFull) {
    await response.body?.cancel();
    throw new Error('PDF range request failed');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('PDF response is empty');
  const bytes = new Uint8Array(end - begin);
  let offset = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.length > bytes.length)
        throw new Error('PDF response exceeds its range');
      bytes.set(value, offset);
      offset += value.length;
    }
  } finally {
    await reader.cancel();
  }
  if (offset !== bytes.length) throw new Error('PDF response is incomplete');
  return bytes;
}
