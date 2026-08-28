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
import { isTaskListRowHardFailure } from './taskLifecycleUi';

describe('task lifecycle failure projection', () => {
  it('ignores structured legacy message content instead of throwing', () => {
    expect(
      isTaskListRowHardFailure({
        messages: [
          {
            id: 'legacy-approval',
            role: 'agent',
            content: {
              interaction_id: 'approval-1',
              interaction_type: 'approval',
            } as unknown as string,
          },
        ],
      })
    ).toBe(false);
  });

  it('continues to identify explicit agent error messages', () => {
    expect(
      isTaskListRowHardFailure({
        messages: [
          {
            id: 'failure',
            role: 'agent',
            content: '  ❌ **Error**: provider failed',
          },
        ],
      })
    ).toBe(true);
  });
});
