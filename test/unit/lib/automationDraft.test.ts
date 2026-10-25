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

import { parseAutomationDraft } from '@/lib/automationDraft';
import { describe, expect, it } from 'vitest';

const valid = {
  version: 1,
  kind: 'automation-draft',
  name: 'Weekly report',
  description: 'Summarize the week',
  taskPrompt: 'Prepare a weekly report',
  schedule: null,
  requiredInputs: [],
  unresolved: ['Choose a day and time'],
};

describe('parseAutomationDraft', () => {
  it('accepts a versioned draft embedded in the final result', () => {
    expect(
      parseAutomationDraft(
        `Review this draft:\n\n\`\`\`automation-draft\n${JSON.stringify(valid)}\n\`\`\``
      )
    ).toEqual(valid);
  });

  it('rejects malformed and oversized model output before opening the editor', () => {
    expect(
      parseAutomationDraft('```automation-draft\n{"version":2}\n```')
    ).toBeNull();
    expect(
      parseAutomationDraft(
        `\`\`\`automation-draft\n${JSON.stringify({ ...valid, taskPrompt: 'x'.repeat(9000) })}\n\`\`\``
      )
    ).toBeNull();
    expect(
      parseAutomationDraft('```automation-draft\n{"version":1')
    ).toBeNull();
  });
});
