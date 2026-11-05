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

import { runProjectionStore } from '@/lib/runEvents/projectionStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { refreshProjectNavLead } from '@/store/projectStore';
import { describe, expect, it } from 'vitest';

describe('refreshProjectNavLead', () => {
  it('shows the result of a Session that is neither loaded nor in the active Space', () => {
    runProjectionStore.upsertRunSummaries('cold-session', [
      {
        project_id: 'cold-session',
        run_id: 'run-1',
        status: 'failed',
        version: 1,
        updated_at: 1_000,
      },
    ]);

    refreshProjectNavLead('cold-session');

    expect(
      useProjectRuntimeStore.getState().navLeadByProjectId['cold-session']?.kind
    ).toBe('error');
  });
});
