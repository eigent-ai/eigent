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

import {
  hasCanonicalPermissionApproval,
  hasCompleteLegacyNormalRunCoverage,
} from '@/components/ChatBox/normalTimelineSourceArbitration';
import { describe, expect, it } from 'vitest';

describe('Normal timeline source arbitration', () => {
  it('keeps the exact legacy Normal renderer when every canonical Run is covered', () => {
    expect(
      hasCompleteLegacyNormalRunCoverage(
        ['run-1', 'run-2'],
        ['legacy-only', 'run-2', 'run-1']
      )
    ).toBe(true);
  });

  it('uses the event-native renderer for canonical-only history', () => {
    expect(hasCompleteLegacyNormalRunCoverage(['canonical-run'], [])).toBe(
      false
    );
  });

  it('uses the event-native renderer when mixed history leaves one Run uncovered', () => {
    expect(
      hasCompleteLegacyNormalRunCoverage(
        ['legacy-run', 'canonical-only-run'],
        ['legacy-run']
      )
    ).toBe(false);
  });

  it('requires canonical Normal when a permission approval has a durable request', () => {
    expect(
      hasCanonicalPermissionApproval([
        {
          kind: 'interaction',
          interactionType: 'approval',
          eventType: 'legacy.ask',
        },
        {
          kind: 'interaction',
          interactionType: 'approval',
          eventType: 'approval.requested',
        },
      ])
    ).toBe(true);
  });

  it('does not cut over for a legacy-only ASK mirror', () => {
    expect(
      hasCanonicalPermissionApproval([
        {
          kind: 'interaction',
          interactionType: 'approval',
          eventType: 'legacy.ask',
        },
      ])
    ).toBe(false);
  });
});
