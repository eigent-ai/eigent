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

import { normalizeBrowserUrl } from '@/lib/browserUrl';
import { describe, expect, it } from 'vitest';

describe('normalizeBrowserUrl', () => {
  it('normalizes bare hostnames to HTTPS', () => {
    const result = normalizeBrowserUrl('example.com/path');
    expect(result).toEqual({
      ok: true,
      url: 'https://example.com/path',
    });
  });

  it('normalizes localhost and IP destinations to HTTP', () => {
    expect(normalizeBrowserUrl('localhost:3000')).toEqual({
      ok: true,
      url: 'http://localhost:3000/',
    });
    expect(normalizeBrowserUrl('127.0.0.1:8080/docs')).toEqual({
      ok: true,
      url: 'http://127.0.0.1:8080/docs',
    });
  });

  it('rejects unsupported protocols', () => {
    expect(normalizeBrowserUrl('javascript:alert(1)')).toEqual({
      ok: false,
      error: 'Only HTTP and HTTPS URLs are supported',
    });
    expect(normalizeBrowserUrl('file:///etc/passwd')).toEqual({
      ok: false,
      error: 'Only HTTP and HTTPS URLs are supported',
    });
  });
});
