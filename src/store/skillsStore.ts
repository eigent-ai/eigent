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
  skillConfigDelete as brainSkillConfigDelete,
  skillConfigInit as brainSkillConfigInit,
  skillConfigLoad as brainSkillConfigLoad,
  skillConfigUpdate as brainSkillConfigUpdate,
  skillDelete as brainSkillDelete,
  skillRead as brainSkillRead,
  skillsScan as brainSkillsScan,
  skillWrite as brainSkillWrite,
} from '@/api/brain';
import {
  buildSkillMd,
  hasSkillsFsApi,
  parseSkillMd,
  skillNameToDirName,
} from '@/lib/skillToolkit';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useAuthStore } from './authStore';

function sanitizeSkillConfigId(value: string | number | null): string | null {
  if (value === null || value === undefined) return null;
  const sanitized = String(value)
    .replace(/[\\/*?:"<>|\s]/g, '_')
    .replace(/^\.+|\.+$/g, '');
  return sanitized || null;
}

function legacyEmailSkillConfigId(email: string | null): string | null {
  if (!email) return null;
  return sanitizeSkillConfigId(email.split('@')[0]);
}

function getSkillConfigUserIds(): {
  userId: string | null;
  legacyUserId: string | null;
} {
  const { email, user_id } = useAuthStore.getState();
  const sanitizedUserId = sanitizeSkillConfigId(user_id);
  return {
    userId: sanitizedUserId ? `user_${sanitizedUserId}` : null,
    legacyUserId: legacyEmailSkillConfigId(email),
  };
}

/**
 * A skill setting could not be persisted because no account is signed in.
 * Callers surface the sign-in prompt instead of a generic retry message.
 */
export class SkillSignInRequiredError extends Error {
  constructor() {
    super('Sign in to save skill settings');
    this.name = 'SkillSignInRequiredError';
  }
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

// isExample is now determined dynamically by skills-scan based on whether
// the skill dir exists in resources/example-skills (no hardcoded list needed)

// Skills state interface
interface SkillsState {
  skills: Skill[];
  addSkill: (
    skill: Omit<Skill, 'id' | 'addedAt' | 'isExample'>
  ) => Promise<void>;
  updateSkill: (id: string, updates: Partial<Skill>) => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
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
        let previousContent: string | null = null;
        let wrotePackage = false;
        let dirName: string | undefined;
        if (hasSkillsFsApi()) {
          const meta = parseSkillMd(skill.fileContent);
          const name = meta?.name || skill.name;
          const description = meta?.description || skill.description;
          const body = meta?.body || skill.fileContent;
          const content = buildSkillMd(name, description, body);
          dirName = skill.skillDirName || skillNameToDirName(name || 'skill');
          try {
            const existing = await brainSkillRead(dirName);
            if (
              existing?.success === true &&
              typeof existing.content === 'string'
            ) {
              previousContent = existing.content;
            }
          } catch {
            // New package — nothing to restore if the later config write fails.
          }
          try {
            const result = await brainSkillWrite(dirName, content);
            if (!result.success)
              throw new Error('Failed to write skill package');
            wrotePackage = true;
          } catch (e) {
            console.warn('[Skills] brainSkillWrite failed:', e);
            throw e;
          }
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

        // Update local configuration via Brain REST API
        if (hasSkillsFsApi()) {
          try {
            const { userId, legacyUserId } = getSkillConfigUserIds();
            if (userId) {
              const result = await brainSkillConfigUpdate(
                userId,
                newSkill.name,
                {
                  enabled: newSkill.enabled,
                  scope: newSkill.scope,
                  addedAt: newSkill.addedAt,
                  isExample: false,
                },
                legacyUserId
              );
              if (!result.success)
                throw new Error('Failed to save skill settings');
            }
          } catch (error) {
            console.warn('[Skills] Failed to update skill config:', error);
            if (wrotePackage && dirName) {
              try {
                if (previousContent !== null) {
                  await brainSkillWrite(dirName, previousContent);
                } else {
                  await brainSkillDelete(dirName);
                }
              } catch (rollbackError) {
                console.warn(
                  '[Skills] Failed to roll back skill package:',
                  rollbackError
                );
              }
            }
            throw error;
          }
        }

        set((state) => ({
          skills: [
            newSkill,
            ...state.skills.filter(
              (existing) =>
                !newSkill.skillDirName ||
                existing.skillDirName !== newSkill.skillDirName
            ),
          ],
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
            const { userId, legacyUserId } = getSkillConfigUserIds();
            if (!userId) throw new SkillSignInRequiredError();

            const updatedSkill = { ...skill, ...updates };
            const result = await brainSkillConfigUpdate(
              userId,
              skill.name,
              {
                enabled: updatedSkill.enabled,
                scope: updatedSkill.scope,
                addedAt: updatedSkill.addedAt,
                isExample: updatedSkill.isExample,
              },
              legacyUserId
            );
            if (!result.success)
              throw new Error('Failed to save skill settings');
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
            throw error;
          }
        }
      },

      deleteSkill: async (id) => {
        const current = get().skills.find((s) => s.id === id);
        if (!current) return;

        // Example skills cannot be deleted, only enabled/disabled
        if (current.isExample) return;

        // Delete from filesystem via Brain REST API
        if (current.skillDirName && hasSkillsFsApi()) {
          try {
            const result = await brainSkillDelete(current.skillDirName);
            if (!result.success) throw new Error('Failed to delete skill');
          } catch (e) {
            console.warn('[Skills] brainSkillDelete failed:', e);
            throw e;
          }
        }

        // Delete from local configuration via Brain REST API
        if (hasSkillsFsApi()) {
          try {
            const { userId, legacyUserId } = getSkillConfigUserIds();
            if (userId) {
              await brainSkillConfigDelete(userId, current.name, legacyUserId);
            }
          } catch (error) {
            console.warn('[Skills] Failed to delete skill config:', error);
            // Continue anyway - skill is removed from UI
          }
        }

        set((state) => ({
          skills: state.skills.filter((skill) => skill.id !== id),
        }));
      },

      // Load skills from ~/.eigent/skills via Brain REST API
      // Rejects on failure so the caller can keep the last known list on
      // screen and offer a retry; it never leaves partial state behind.
      syncFromDisk: async () => {
        if (!hasSkillsFsApi()) return;
        const { userId, legacyUserId } = getSkillConfigUserIds();

        const result = await brainSkillsScan();
        if (!result.success || !result.skills)
          throw new Error('Failed to load skills');

        if (userId) {
          console.log(`[Skills] Initializing config for user: ${userId}`);
          await brainSkillConfigInit(userId, legacyUserId);
        }

        let config: any = { global: null, project: null };
        if (userId) {
          console.log(`[Skills] Loading config for user: ${userId}`);
          const loadResult = await brainSkillConfigLoad(userId, legacyUserId);
          if (!loadResult.success || !loadResult.config)
            throw new Error('Failed to load skill settings');
          config.global = loadResult.config;
          console.log(
            `[Skills] Loaded config with ${Object.keys(loadResult.config.skills || {}).length} skills configured`
          );
        } else {
          console.warn('[Skills] No userId available, skipping config load');
        }

        // A scan started for another account must not replace this account's view.
        if (getSkillConfigUserIds().userId !== userId) return;
        const prevByKey = new Map<string, Skill>(
          get().skills.map((s) => [s.skillDirName ?? s.id, s])
        );

        const diskSkills: Skill[] = [];
        for (const s of result.skills) {
          const existing = prevByKey.get(s.skillDirName);
          const isExample = s.isExample ?? false;

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
              await brainSkillConfigUpdate(
                userId,
                s.name,
                newSkillConfig,
                legacyUserId
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
            isExample,
          });
        }
        if (getSkillConfigUserIds().userId !== userId) return;
        diskSkills.sort((a: Skill, b: Skill) => a.name.localeCompare(b.name));

        set({ skills: diskSkills });
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
