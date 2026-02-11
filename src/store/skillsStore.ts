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
import { useAuthStore } from './authStore';

// Helper function to normalize email to user_id format
// Matches the logic in backend's file_save_path
function emailToUserId(email: string | null): string | null {
  if (!email) return null;
  return email
    .split('@')[0]
    .replace(/[\\/*?:"<>|\s]/g, '_')
    .replace(/^\.+|\.+$/g, '');
}

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
  'code-reviewer',
  'report-writer',
  'data-analyzer',
] as const;

// Skills state interface
interface SkillsState {
  skills: Skill[];
  addSkill: (
    skill: Omit<Skill, 'id' | 'addedAt' | 'isExample'>
  ) => Promise<void>;
  updateSkill: (id: string, updates: Partial<Skill>) => void;
  deleteSkill: (id: string) => Promise<void>;
  toggleSkill: (id: string) => Promise<void>;
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

      addSkill: async (skill) => {
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

        // Update local configuration via Electron IPC
        if (hasSkillsFsApi()) {
          try {
            const userId = emailToUserId(useAuthStore.getState().email);
            if (userId) {
              const scope = newSkill.scope.isGlobal ? 'global' : 'project';
              await window.electronAPI.skillConfigUpdate(
                userId,
                newSkill.name,
                {
                  enabled: newSkill.enabled,
                  scope,
                  addedAt: newSkill.addedAt,
                  isExample: false,
                }
              );
            }
          } catch (error) {
            console.warn('Failed to update skill config:', error);
            // Continue anyway - skill is added to UI
          }
        }

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

      deleteSkill: async (id) => {
        const current = get().skills.find((s) => s.id === id);
        if (!current) return;

        // Delete from filesystem
        if (current.skillDirName && hasSkillsFsApi()) {
          window.electronAPI.skillDelete(current.skillDirName).catch(() => {
            // Ignore deletion errors; state will still be updated
          });
        }

        // Delete from local configuration via Electron IPC
        if (hasSkillsFsApi()) {
          try {
            const userId = emailToUserId(useAuthStore.getState().email);
            if (userId) {
              await window.electronAPI.skillConfigDelete(userId, current.name);
            }
          } catch (error) {
            console.warn('Failed to delete skill config:', error);
            // Continue anyway - skill is removed from UI
          }
        }

        set((state) => ({
          skills: state.skills.filter((skill) => skill.id !== id),
        }));
      },

      toggleSkill: async (id) => {
        const skill = get().skills.find((s) => s.id === id);
        if (!skill) return;

        const newEnabled = !skill.enabled;

        // Optimistically update UI
        set((state) => ({
          skills: state.skills.map((s) =>
            s.id === id ? { ...s, enabled: newEnabled } : s
          ),
        }));

        // Persist to local configuration via Electron IPC
        if (hasSkillsFsApi()) {
          try {
            const userId = emailToUserId(useAuthStore.getState().email);
            if (userId) {
              const result = await window.electronAPI.skillConfigToggle(
                userId,
                skill.name,
                newEnabled
              );
              if (!result.success) {
                throw new Error(
                  result.error || 'Failed to toggle skill configuration'
                );
              }
              console.log('Skill configuration updated:', result);
            }
          } catch (error) {
            // Revert on error
            console.error('Failed to toggle skill:', error);
            set((state) => ({
              skills: state.skills.map((s) =>
                s.id === id ? { ...s, enabled: !newEnabled } : s
              ),
            }));
          }
        }
      },

      getSkillsByType: (isExample) => {
        return get().skills.filter((skill) => skill.isExample === isExample);
      },

      // Load skills from ~/.eigent/skills (main process seeds example skills when empty)
      syncFromDisk: async () => {
        if (!hasSkillsFsApi()) return;
        try {
          // 1. Scan skills from filesystem
          const result = await window.electronAPI.skillsScan();
          if (!result.success || !result.skills) return;

          // 2. Load configuration from local file via Electron IPC
          let config: any = { global: null, project: null };
          try {
            const userId = emailToUserId(useAuthStore.getState().email);
            if (userId) {
              const result = await window.electronAPI.skillConfigLoad(userId);
              if (result.success && result.config) {
                config.global = result.config;
              }
            }
          } catch (error) {
            console.warn('Failed to load skill config, using defaults:', error);
          }

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

                // Get enabled status from config (project overrides global)
                const globalConfig = config.global?.skills?.[s.name];
                const projectConfig = config.project?.skills?.[s.name];
                const enabledFromConfig =
                  projectConfig?.enabled ?? globalConfig?.enabled ?? true;

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
                  enabled: enabledFromConfig,
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
