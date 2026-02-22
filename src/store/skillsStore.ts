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
  updateSkill: (id: string, updates: Partial<Skill>) => Promise<void>;
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
              await window.electronAPI.skillConfigUpdate(
                userId,
                newSkill.name,
                {
                  enabled: newSkill.enabled,
                  scope: newSkill.scope,
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

      updateSkill: async (id, updates) => {
        const skill = get().skills.find((s) => s.id === id);
        if (!skill) return;

        set((state) => ({
          skills: state.skills.map((s) =>
            s.id === id ? { ...s, ...updates } : s
          ),
        }));

        // Persist to configuration file if updating scope or enabled status
        if (
          hasSkillsFsApi() &&
          (updates.scope || updates.enabled !== undefined)
        ) {
          try {
            const userId = emailToUserId(useAuthStore.getState().email);
            if (!userId) return;

            const updatedSkill = { ...skill, ...updates };
            await window.electronAPI.skillConfigUpdate(userId, skill.name, {
              enabled: updatedSkill.enabled,
              scope: updatedSkill.scope,
              addedAt: updatedSkill.addedAt,
              isExample: updatedSkill.isExample,
            });
            console.log(
              `[Skills] Updated config for skill: ${skill.name}`,
              updates
            );
          } catch (error) {
            console.error('[Skills] Failed to update skill config:', error);
            // Revert on error
            set((state) => ({
              skills: state.skills.map((s) => (s.id === id ? skill : s)),
            }));
          }
        }
      },

      deleteSkill: async (id) => {
        const current = get().skills.find((s) => s.id === id);
        if (!current) return;

        // Example skills cannot be deleted, only enabled/disabled
        if (current.isExample) return;

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

      // Load skills from ~/.eigent/skills
      syncFromDisk: async () => {
        if (!hasSkillsFsApi()) return;
        try {
          const userId = emailToUserId(useAuthStore.getState().email);

          const result = await window.electronAPI.skillsScan();
          if (!result.success || !result.skills) return;

          if (userId) {
            console.log(`[Skills] Initializing config for user: ${userId}`);
            await window.electronAPI.skillConfigInit(userId);
          }

          let config: any = { global: null, project: null };
          try {
            if (userId) {
              console.log(`[Skills] Loading config for user: ${userId}`);
              const result = await window.electronAPI.skillConfigLoad(userId);
              if (result.success && result.config) {
                config.global = result.config;
                console.log(
                  `[Skills] Loaded config with ${Object.keys(result.config.skills || {}).length} skills configured`
                );
              } else {
                console.warn('[Skills] Failed to load config:', result.error);
              }
            } else {
              console.warn(
                '[Skills] No userId available, skipping config load'
              );
            }
          } catch (error) {
            console.error('[Skills] Error loading skill config:', error);
          }

          const prevByKey = new Map<string, Skill>(
            get().skills.map((s) => [s.skillDirName ?? s.id, s])
          );

          const diskSkills: Skill[] = [];
          for (const s of result.skills) {
            const existing = prevByKey.get(s.skillDirName);
            const isExample = (
              EXAMPLE_SKILL_DIR_NAMES as readonly string[]
            ).includes(s.skillDirName);

            // Get config from global/project (config key = skill name from SKILL.md)
            const globalConfig = config.global?.skills?.[s.name];
            const projectConfig = config.project?.skills?.[s.name];
            const skillConfig = projectConfig ?? globalConfig;

            // Register to config if not present (e.g. newly uploaded zip or single file)
            const isNewSkill = !skillConfig;
            if (isNewSkill && userId && hasSkillsFsApi()) {
              try {
                const addedAt = existing?.addedAt ?? Date.now();
                const newSkillConfig = {
                  enabled: true,
                  scope: { isGlobal: true, selectedAgents: [] },
                  addedAt,
                  isExample,
                };
                await window.electronAPI.skillConfigUpdate(
                  userId,
                  s.name,
                  newSkillConfig
                );
                // Update in-memory config so subsequent skills in same sync see it
                if (!config.global) config.global = { skills: {} };
                if (!config.global.skills) config.global.skills = {};
                config.global.skills[s.name] = newSkillConfig;
              } catch (error) {
                console.warn(
                  `[Skills] Failed to register skill ${s.name} to config:`,
                  error
                );
              }
            }

            const effectiveConfig = isNewSkill
              ? {
                  enabled: true,
                  scope: { isGlobal: true, selectedAgents: [] },
                  addedAt: existing?.addedAt ?? Date.now(),
                  isExample,
                }
              : skillConfig;

            const enabledFromConfig = effectiveConfig?.enabled ?? true;
            let scopeFromConfig: SkillScope;
            if (
              effectiveConfig?.scope &&
              typeof effectiveConfig.scope === 'object'
            ) {
              scopeFromConfig = {
                isGlobal: effectiveConfig.scope.isGlobal ?? true,
                selectedAgents: effectiveConfig.scope.selectedAgents ?? [],
              };
            } else {
              scopeFromConfig = {
                isGlobal: true,
                selectedAgents: [],
              };
            }

            diskSkills.push({
              id: `disk-${s.skillDirName}`,
              name: s.name,
              description: s.description,
              filePath: s.path,
              fileContent: existing?.fileContent ?? '',
              skillDirName: s.skillDirName,
              addedAt:
                effectiveConfig?.addedAt ?? existing?.addedAt ?? Date.now(),
              scope: scopeFromConfig,
              enabled: enabledFromConfig,
              isExample: effectiveConfig?.isExample ?? isExample,
            });
          }
          diskSkills.sort((a: Skill, b: Skill) => a.name.localeCompare(b.name));

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
