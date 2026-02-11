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
  buildSkillMd,
  hasSkillsFsApi,
  parseSkillMd,
  skillNameToDirName,
} from '@/lib/skillToolkit';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Skill scope interface
export interface SkillScope {
  isGlobal: boolean;
  selectedAgents: string[];
}

// Skill interface
export interface Skill {
  id: string;
  name: string;
  description: string;
  filePath: string;
  fileContent: string;
  // Optional: folder name under ~/.eigent/skills
  skillDirName?: string;
  addedAt: number;
  scope: SkillScope;
  enabled: boolean;
  isExample: boolean;
}

// Dir names of default skills seeded by main process under ~/.eigent/skills.
// These are shown in the "Example skills" section; all other disk skills are "Your skills".
export const EXAMPLE_SKILL_DIR_NAMES = [
  'web-scraper',
  'file-organizer',
  'data-analyzer',
] as const;

// Skills state interface
interface SkillsState {
  skills: Skill[];
  addSkill: (skill: Omit<Skill, 'id' | 'addedAt' | 'isExample'>) => void;
  updateSkill: (id: string, updates: Partial<Skill>) => void;
  deleteSkill: (id: string) => void;
  toggleSkill: (id: string) => void;
  getSkillsByType: (isExample: boolean) => Skill[];
  // Sync skills from filesystem (Electron) based on SKILL.md files
  syncFromDisk: () => Promise<void>;
}

// Generate unique ID
const generateId = () =>
  `skill-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// Create store
export const useSkillsStore = create<SkillsState>()(
  persist(
    (set, get) => ({
      skills: [],

      addSkill: (skill) => {
        // Persist to filesystem (Electron) as CAMEL-compatible SKILL.md
        if (hasSkillsFsApi()) {
          const meta = parseSkillMd(skill.fileContent);
          const name = meta?.name || skill.name;
          const description = meta?.description || skill.description;
          const body = meta?.body || skill.fileContent;
          const content = buildSkillMd(name, description, body);
          const dirName =
            skill.skillDirName || skillNameToDirName(name || 'skill');
          window.electronAPI.skillWrite(dirName, content).catch(() => {
            // Ignore errors here; UI still holds the in-memory skill
          });
          skill = {
            ...skill,
            filePath: `${dirName}/SKILL.md`,
            fileContent: content,
            skillDirName: dirName,
          };
        }

        const newSkill: Skill = {
          ...skill,
          id: generateId(),
          addedAt: Date.now(),
          isExample: false,
        };
        set((state) => ({
          skills: [newSkill, ...state.skills],
        }));
      },

      updateSkill: (id, updates) => {
        set((state) => ({
          skills: state.skills.map((skill) =>
            skill.id === id ? { ...skill, ...updates } : skill
          ),
        }));
      },

      deleteSkill: (id) => {
        const current = get().skills.find((s) => s.id === id);
        if (current?.skillDirName && hasSkillsFsApi()) {
          window.electronAPI.skillDelete(current.skillDirName).catch(() => {
            // Ignore deletion errors; state will still be updated
          });
        }
        set((state) => ({
          skills: state.skills.filter((skill) => skill.id !== id),
        }));
      },

      toggleSkill: (id) => {
        set((state) => ({
          skills: state.skills.map((skill) =>
            skill.id === id ? { ...skill, enabled: !skill.enabled } : skill
          ),
        }));
      },

      getSkillsByType: (isExample) => {
        return get().skills.filter((skill) => skill.isExample === isExample);
      },

      // Load skills from ~/.eigent/skills (main process seeds example skills when empty)
      syncFromDisk: async () => {
        if (!hasSkillsFsApi()) return;
        try {
          const result = await window.electronAPI.skillsScan();
          if (!result.success || !result.skills) return;

          const prevByKey = new Map<string, Skill>(
            get().skills.map((s) => [s.skillDirName ?? s.id, s])
          );

          const diskSkills: Skill[] = result.skills
            .map(
              (s: {
                name: string;
                description: string;
                path: string;
                scope: string;
                skillDirName: string;
              }) => {
                const existing = prevByKey.get(s.skillDirName);
                const isExample = (
                  EXAMPLE_SKILL_DIR_NAMES as readonly string[]
                ).includes(s.skillDirName);
                return {
                  id: `disk-${s.skillDirName}`,
                  name: s.name,
                  description: s.description,
                  filePath: s.path,
                  fileContent: existing?.fileContent ?? '',
                  skillDirName: s.skillDirName,
                  addedAt: existing?.addedAt ?? Date.now(),
                  scope: existing?.scope ?? {
                    isGlobal: true,
                    selectedAgents: [],
                  },
                  enabled: existing?.enabled ?? (isExample ? true : true),
                  isExample,
                };
              }
            )
            .sort((a: Skill, b: Skill) => a.name.localeCompare(b.name));

          set({ skills: diskSkills });
        } catch {
          // Ignore sync errors; keep existing state
        }
      },
    }),
    {
      name: 'skills-storage',
      partialize: (state) => ({
        skills: state.skills,
      }),
    }
  )
);

// Non-hook version for use outside React components
export const getSkillsStore = () => useSkillsStore.getState();
