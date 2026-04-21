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

import { createDefaultThemeContractV2 } from '@/lib/themeTokens/catalog';
import { buildThemeV2 } from '@/lib/themeTokens/engine';
import { verifyThemeEngine } from '@/lib/themeTokens/verifier';
import { describe, expect, it } from 'vitest';

describe('themeTokens v2 engine verifier', () => {
  it('produces zero errors across every registered theme/mode/contrast', () => {
    const report = verifyThemeEngine();
    const errors = report.findings.filter((f) => f.severity === 'error');
    if (errors.length > 0) {
      const preview = errors
        .slice(0, 5)
        .map(
          (e) =>
            `[${e.code}] ${e.mode}/${e.themeId}@${e.contrast}: ${e.message}`
        )
        .join('\n');
      throw new Error(
        `Theme engine emitted ${errors.length} errors. First few:\n${preview}`
      );
    }
    expect(errors).toHaveLength(0);
  });

  it('applies contrast clamping at bounds', () => {
    const low = buildThemeV2(
      createDefaultThemeContractV2('light', {
        themeId: 'eigent',
        contrast: -50,
      })
    );
    const high = buildThemeV2(
      createDefaultThemeContractV2('light', {
        themeId: 'eigent',
        contrast: 500,
      })
    );
    expect(low.contract.contrast).toBe(0);
    expect(high.contract.contrast).toBe(100);
  });

  it('falls back to a registered theme for unknown ids', () => {
    const resolved = buildThemeV2(
      createDefaultThemeContractV2('light', {
        themeId: 'this-theme-does-not-exist',
        contrast: 43,
      })
    );
    expect(resolved.tokens['bg.neutral.subtle.default']).toBeDefined();
  });
});
