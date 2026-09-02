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

import SkillAccessMenu from '@/components/Settings/Skills/components/SkillAccessMenu';
import type { Skill } from '@/store/skillsStore';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/Settings/Skills/SkillsProvider', () => ({
  useSkillsLibrary: () => ({
    updateGlobal: vi.fn(),
    pendingIds: new Set<string>(),
    loading: false,
  }),
}));

vi.mock('@/store/authStore', () => ({
  useWorkerList: () => [],
  getAuthStore: () => ({ language: 'en' }),
}));

const skill: Skill = {
  id: 'disk-research',
  name: 'research',
  description: 'Find sources',
  skillDirName: 'research',
  filePath: 'research/SKILL.md',
  fileContent: '',
  addedAt: 0,
  enabled: true,
  isExample: false,
  scope: { isGlobal: true, selectedAgents: [] },
};

describe('SkillAccessMenu accessible name', () => {
  it('includes the current access state so assistive tech can hear it', () => {
    render(<SkillAccessMenu skill={skill} />);
    expect(
      screen.getByRole('button', {
        name: 'Agent access for research: All agents',
      })
    ).toBeVisible();
  });

  it('names a restricted skill by how many agents can use it', () => {
    render(
      <SkillAccessMenu
        skill={{
          ...skill,
          scope: {
            isGlobal: false,
            selectedAgents: ['research_agent', 'writing_agent'],
          },
        }}
      />
    );
    expect(
      screen.getByRole('button', {
        name: 'Agent access for research: Agents: 2',
      })
    ).toBeVisible();
  });
});
