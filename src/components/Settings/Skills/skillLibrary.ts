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

import type { WorkspaceConfigurationDraft } from '@/service/workspaceConfigurationApi';
import type { Skill } from '@/store/skillsStore';
import type { Space } from '@/store/spaceStore';

export type SkillLibraryEntry = {
  id: string;
  name: string;
  description: string;
} & (
  | { kind: 'global' | 'builtin'; skill: Skill }
  | {
      kind: 'space';
      spaceId: string;
      spaceName: string;
      ref: string;
      assignTo: string[];
    }
);
export type SkillLibraryFilter = 'all' | 'global' | 'builtin' | 'space';
export type SpaceSkillProfile = {
  space: Pick<Space, 'id' | 'name'>;
  draft: WorkspaceConfigurationDraft;
};

export function getSkillLibraryStats(entries: SkillLibraryEntry[]) {
  const sources = { builtin: 0, global: 0, space: 0 };
  const spaces = new Set<string>();
  let enabled = 0;
  let allAgents = 0;
  let selectedAgents = 0;
  let noAgents = 0;
  for (const entry of entries) {
    sources[entry.kind] += 1;
    if (entry.kind === 'space') {
      spaces.add(entry.spaceId);
      if (entry.assignTo.length) selectedAgents += 1;
      else allAgents += 1;
    } else {
      if (entry.skill.enabled) enabled += 1;
      if (entry.skill.scope.isGlobal) allAgents += 1;
      else if (entry.skill.scope.selectedAgents.length) selectedAgents += 1;
      else noAgents += 1;
    }
  }
  const globalTotal = sources.global + sources.builtin;
  return {
    total: entries.length,
    sources,
    globalTotal,
    enabled,
    disabled: globalTotal - enabled,
    spaces: spaces.size,
    allAgents,
    selectedAgents,
    noAgents,
  };
}

export function buildSkillLibrary(
  skills: Skill[],
  profiles: SpaceSkillProfile[]
): SkillLibraryEntry[] {
  return [
    ...skills.map((skill): SkillLibraryEntry => ({
      id: `global:${skill.skillDirName || skill.id}`,
      kind: skill.isExample ? 'builtin' : 'global',
      name: skill.name,
      description: skill.description,
      skill,
    })),
    ...profiles.flatMap(({ space, draft }) =>
      draft.document.spec.skills.map((assignment): SkillLibraryEntry => ({
        id: `space:${space.id}:${assignment.ref}`,
        kind: 'space',
        name:
          assignment.ref
            .replace(/\/SKILL\.md$/i, '')
            .split('/')
            .pop() || assignment.ref,
        // A profile assignment records only a package path, never a
        // description; `ref` carries the path so the two stay distinct.
        description: '',
        spaceId: space.id,
        spaceName: space.name,
        ref: assignment.ref,
        assignTo: assignment.assignTo,
      }))
    ),
  ].sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
  );
}

/**
 * Secondary line under a skill's name: its description, or — for a profile
 * assignment, which has no description — the package path it points at.
 */
export function getSkillLibrarySubtitle(entry: SkillLibraryEntry) {
  return entry.kind === 'space' ? entry.ref : entry.description;
}

export function filterSkillLibrary(
  entries: SkillLibraryEntry[],
  query: string,
  filter: SkillLibraryFilter,
  status = 'all',
  spaceId = 'all'
) {
  const term = query.trim().toLocaleLowerCase();
  return entries.filter(
    (entry) =>
      (filter === 'all' || entry.kind === filter) &&
      (spaceId === 'all' ||
        (entry.kind === 'space' && entry.spaceId === spaceId)) &&
      (status === 'all' ||
        (entry.kind === 'space'
          ? status === 'profile'
          : entry.skill.enabled
            ? status === 'enabled'
            : status === 'disabled')) &&
      (!term ||
        [
          entry.name,
          entry.description,
          ...(entry.kind === 'space' ? [entry.spaceName, entry.ref] : []),
        ].some((text) => text.toLocaleLowerCase().includes(term)))
  );
}
