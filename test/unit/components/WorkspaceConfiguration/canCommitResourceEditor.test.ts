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

import { canCommitResourceEditor } from '@/components/WorkspaceConfiguration/WorkspaceResourceEditorPanel';
import type { WorkspaceConfigurationDocument } from '@/service/workspaceConfigurationApi';
import { describe, expect, it } from 'vitest';

const document = {
  spec: {
    skills: [
      { ref: 'bundle://skills/research/SKILL.md', assignTo: [] },
      { ref: 'bundle://skills/writing/SKILL.md', assignTo: ['analyst'] },
    ],
  },
} as WorkspaceConfigurationDocument;

describe('canCommitResourceEditor skill references', () => {
  it('rejects a new skill that reuses an existing reference', () => {
    expect(
      canCommitResourceEditor(
        {
          kind: 'skill',
          mode: 'create',
          step: 'editor',
          item: {
            ref: 'bundle://skills/research/SKILL.md',
            assignTo: [],
          },
        },
        document
      )
    ).toBe(false);
  });

  it('lets the current skill keep its own reference while editing', () => {
    expect(
      canCommitResourceEditor(
        {
          kind: 'skill',
          mode: 'edit',
          step: 'editor',
          index: 0,
          item: {
            ref: 'bundle://skills/research/SKILL.md',
            assignTo: ['analyst'],
          },
        },
        document
      )
    ).toBe(true);
  });
});
