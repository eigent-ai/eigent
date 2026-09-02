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
  buildSkillLibrary,
  filterSkillLibrary,
  getSkillLibraryStats,
  type SpaceSkillProfile,
} from '@/components/Settings/Skills/skillLibrary';
import type { Skill } from '@/store/skillsStore';
import { describe, expect, it } from 'vitest';
const custom: Skill = {
  id: 'disk-research',
  name: 'research',
  description: 'Find sources',
  skillDirName: 'research',
  filePath: 'research/SKILL.md',
  fileContent: '',
  addedAt: 0,
  enabled: true,
  isExample: false,
  scope: { isGlobal: false, selectedAgents: ['research_agent'] },
};
const builtin: Skill = {
  ...custom,
  id: 'disk-writing',
  name: 'writing',
  skillDirName: 'writing',
  isExample: true,
  enabled: false,
};
const profile = (id: string): SpaceSkillProfile => ({
  space: { id, name: `Space ${id}` },
  draft: {
    document: {
      spec: {
        skills: [
          { ref: 'bundle://skills/research/SKILL.md', assignTo: ['analyst'] },
        ],
      },
    },
  } as SpaceSkillProfile['draft'],
});

describe('skill library dashboard counts', () => {
  it('counts distinct Spaces and configured access without treating profile entries as enabled global skills', () => {
    const alpha = profile('alpha');
    alpha.draft.document.spec.skills.push({
      ref: 'bundle://skills/writing/SKILL.md',
      assignTo: [],
    });
    const entries = buildSkillLibrary(
      [
        custom,
        builtin,
        {
          ...custom,
          id: 'all',
          skillDirName: 'all',
          enabled: false,
          scope: { isGlobal: true, selectedAgents: ['stale'] },
        },
        {
          ...custom,
          id: 'none',
          skillDirName: 'none',
          scope: { isGlobal: false, selectedAgents: [] },
        },
      ],
      [alpha, profile('beta')]
    );
    expect(getSkillLibraryStats(entries)).toEqual({
      total: 7,
      sources: { global: 3, builtin: 1, space: 3 },
      globalTotal: 4,
      enabled: 2,
      disabled: 2,
      spaces: 2,
      allAgents: 2,
      selectedAgents: 4,
      noAgents: 1,
    });
  });
});
describe('skill library source identity', () => {
  const entries = buildSkillLibrary(
    [custom, builtin],
    [profile('alpha'), profile('beta')]
  );
  it('keeps same-named global and Space packages distinct without confusing agent scope with ownership', () => {
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(4);
    expect(entries.filter((entry) => entry.name === 'research')).toHaveLength(
      3
    );
    expect(
      filterSkillLibrary(entries, '', 'global').map((entry) => entry.id)
    ).toEqual(['global:research']);
    expect(
      filterSkillLibrary(entries, '', 'builtin').map((entry) => entry.name)
    ).toEqual(['writing']);
  });
  it('combines source, Space, status and search filters without inventing Space enabled status', () => {
    expect(
      filterSkillLibrary(entries, 'research', 'space', 'profile', 'beta').map(
        (entry) => entry.id
      )
    ).toEqual(['space:beta:bundle://skills/research/SKILL.md']);
    expect(filterSkillLibrary(entries, '', 'space', 'enabled')).toEqual([]);
    expect(filterSkillLibrary(entries, 'Space ALPHA', 'all')).toHaveLength(1);
    expect(
      filterSkillLibrary(entries, '', 'all', 'disabled').map(
        (entry) => entry.name
      )
    ).toEqual(['writing']);
  });
});
