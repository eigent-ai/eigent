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

import { generateUniqueId, hasStackKeys } from '@/lib/index';
import { describe, expect, it, vi } from 'vitest';

describe('generateUniqueId', () => {
  it('returns a 32-character hex string', () => {
    const id = generateUniqueId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('produces unique values on successive calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateUniqueId()));
    expect(ids.size).toBe(100);
  });

  it('uses crypto.getRandomValues instead of Math.random', () => {
    const spy = vi.spyOn(crypto, 'getRandomValues');
    generateUniqueId();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('hasStackKeys', () => {
  it('does not reference VITE_STACK_SECRET_SERVER_KEY', () => {
    // Read the source of hasStackKeys to ensure the secret key is removed
    const fnSource = hasStackKeys.toString();
    expect(fnSource).not.toContain('VITE_STACK_SECRET_SERVER_KEY');
  });
});
