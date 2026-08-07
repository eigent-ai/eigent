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

import { describe, expect, it } from 'vitest';
import { resolveFileByteRange } from '../../../electron/main/fileRange';

describe('resolveFileByteRange', () => {
  it('returns the full file when Range is absent', () => {
    expect(resolveFileByteRange(null, 10)).toEqual({
      status: 200,
      start: 0,
      end: 9,
    });
  });

  it('supports explicit and suffix ranges', () => {
    expect(resolveFileByteRange('bytes=2-5', 10)).toEqual({
      status: 206,
      start: 2,
      end: 5,
    });
    expect(resolveFileByteRange('bytes=-3', 10)).toEqual({
      status: 206,
      start: 7,
      end: 9,
    });
  });

  it('rejects invalid, multipart and out-of-bounds ranges', () => {
    expect(resolveFileByteRange('bytes=20-30', 10)).toEqual({ status: 416 });
    expect(resolveFileByteRange('bytes=0-1,3-4', 10)).toEqual({
      status: 416,
    });
    expect(resolveFileByteRange('bytes=0-1', 0)).toEqual({ status: 416 });
  });
});
