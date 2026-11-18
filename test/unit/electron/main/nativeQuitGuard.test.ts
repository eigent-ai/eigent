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

import { describe, expect, it, vi } from 'vitest';
import { confirmNativeQuit } from '../../../../electron/main/nativeQuitGuard';

describe('native quit registry guard', () => {
  it('quits idle Brain without showing a dialog', async () => {
    const confirm = vi.fn();
    expect(
      await confirmNativeQuit({
        lookup: async () => ({ active: false }),
        confirm,
      })
    ).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    'shows active work and respects native decision %s',
    async (approved) => {
      const confirm = vi.fn(async () => approved);
      expect(
        await confirmNativeQuit({
          lookup: async () => ({ active: true }),
          confirm,
        })
      ).toBe(approved);
      expect(confirm).toHaveBeenCalledWith(false);
    }
  );
  it.each([
    async () => {
      throw new Error('timeout');
    },
    async () => ({}),
  ])('confirms unknown registry state', async (lookup) => {
    const confirm = vi.fn(async () => false);
    expect(await confirmNativeQuit({ lookup, confirm })).toBe(false);
    expect(confirm).toHaveBeenCalledWith(true);
  });
});
