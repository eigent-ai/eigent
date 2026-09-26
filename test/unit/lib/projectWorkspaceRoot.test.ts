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

import { selectProjectWorkspaceRoot } from '@/lib/projectWorkspaceRoot';
import { describe, expect, it } from 'vitest';

const state = {
  activeSpaceId: 'space-active',
  projectIdIndex: { 'project-1': 'space-project' },
  spaces: {
    'space-active': { rootPath: '/workspace/active' },
    'space-project': { rootPath: '/workspace/project' },
    'space-runtime': { rootPath: '/workspace/runtime' },
  },
};

describe('Project workspace root selection', () => {
  it('uses the persisted Project owner when both bindings agree', () => {
    expect(
      selectProjectWorkspaceRoot(state, 'project-1', 'space-project')
    ).toBe('/workspace/project');
  });

  it('uses the runtime Project owner while persisted metadata is hydrating', () => {
    expect(
      selectProjectWorkspaceRoot(
        { ...state, projectIdIndex: {} },
        'project-new',
        'space-runtime'
      )
    ).toBe('/workspace/runtime');
  });

  it('fails closed when Project ownership bindings conflict', () => {
    expect(
      selectProjectWorkspaceRoot(state, 'project-1', 'space-runtime')
    ).toBeNull();
  });

  it('does not guess from the active Space for an unbound Project', () => {
    expect(
      selectProjectWorkspaceRoot(
        { ...state, projectIdIndex: {} },
        'project-new'
      )
    ).toBeNull();
  });

  it('does not borrow the active Space root when the Project Space is unbound', () => {
    expect(
      selectProjectWorkspaceRoot(
        {
          ...state,
          spaces: {
            ...state.spaces,
            'space-project': { rootPath: null },
          },
        },
        'project-1',
        'space-project'
      )
    ).toBeNull();
  });

  it('uses the active Space only when no Project is selected', () => {
    expect(selectProjectWorkspaceRoot(state, null)).toBe('/workspace/active');
  });
});
