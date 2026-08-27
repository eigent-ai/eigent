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

export type FileByteRange =
  | { status: 200; start: number; end: number }
  | { status: 206; start: number; end: number }
  | { status: 416 };

/** Resolve one RFC 7233 byte range. Multipart ranges are intentionally rejected. */
export function resolveFileByteRange(
  rangeHeader: string | null,
  size: number
): FileByteRange {
  if (!rangeHeader) {
    return { status: 200, start: 0, end: Math.max(0, size - 1) };
  }
  if (size <= 0) return { status: 416 };

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match || (!match[1] && !match[2])) return { status: 416 };

  let start = 0;
  let end = size - 1;
  if (!match[1] && match[2]) {
    const suffixLength = Number(match[2]);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return { status: 416 };
    }
    start = Math.max(0, size - suffixLength);
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : end;
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return { status: 416 };
  }
  return { status: 206, start, end: Math.min(end, size - 1) };
}
