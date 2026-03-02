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

import { create } from 'zustand';
import { useAuthStore } from './authStore';

function emailToUserId(email: string | null): string | null {
  if (!email) return null;
  return email
    .split('@')[0]
    .replace(/[\\/*?:"<>|\s]/g, '_')
    .replace(/^\.+|\.+$/g, '');
}

export interface GlobalAgentTemplate {
  id: string;
  name: string;
  description: string;
  tools: string[];
  mcp_tools: Record<string, unknown> | { mcpServers?: Record<string, unknown> };
  custom_model_config?: {
    model_platform?: string;
    model_type?: string;
    api_key?: string;
    api_url?: string;
    extra_params?: Record<string, unknown>;
  };
  updatedAt: number;
}

interface GlobalAgentTemplatesState {
  templates: GlobalAgentTemplate[];
  isLoading: boolean;
  loadTemplates: () => Promise<void>;
  saveTemplates: (templates: GlobalAgentTemplate[]) => Promise<boolean>;
  addTemplate: (
    template: Omit<GlobalAgentTemplate, 'id' | 'updatedAt'>
  ) => Promise<GlobalAgentTemplate | null>;
  updateTemplate: (
    id: string,
    patch: Partial<GlobalAgentTemplate>
  ) => Promise<boolean>;
  removeTemplate: (id: string) => Promise<boolean>;
  duplicateTemplate: (id: string) => Promise<GlobalAgentTemplate | null>;
  getTemplate: (id: string) => GlobalAgentTemplate | undefined;
}

function generateId(): string {
  return `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function hasAgentTemplatesApi(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!(window as unknown as { electronAPI?: { agentTemplatesLoad?: unknown } })
      .electronAPI?.agentTemplatesLoad
  );
}

export const useGlobalAgentTemplatesStore = create<GlobalAgentTemplatesState>()(
  (set, get) => ({
    templates: [],
    isLoading: false,

    loadTemplates: async () => {
      if (!hasAgentTemplatesApi()) return;
      const userId = emailToUserId(useAuthStore.getState().email);
      if (!userId) return;
      set({ isLoading: true });
      try {
        const result = await window.electronAPI.agentTemplatesLoad(userId);
        if (result.success && result.templates) {
          set({ templates: result.templates });
        }
      } catch (error) {
        console.error('[GlobalAgentTemplates] Load failed:', error);
      } finally {
        set({ isLoading: false });
      }
    },

    saveTemplates: async (templates: GlobalAgentTemplate[]) => {
      if (!hasAgentTemplatesApi()) return false;
      const userId = emailToUserId(useAuthStore.getState().email);
      if (!userId) return false;
      try {
        const result = await window.electronAPI.agentTemplatesSave(
          userId,
          templates
        );
        if (result.success) set({ templates });
        return result.success ?? false;
      } catch (error) {
        console.error('[GlobalAgentTemplates] Save failed:', error);
        return false;
      }
    },

    addTemplate: async (template) => {
      const tpl: GlobalAgentTemplate = {
        ...template,
        id: generateId(),
        updatedAt: Date.now(),
        mcp_tools: template.mcp_tools ?? { mcpServers: {} },
      };
      const templates = [...get().templates, tpl];
      const ok = await get().saveTemplates(templates);
      return ok ? tpl : null;
    },

    updateTemplate: async (id: string, patch: Partial<GlobalAgentTemplate>) => {
      const templates = get().templates.map((t) =>
        t.id === id ? { ...t, ...patch, updatedAt: Date.now() } : t
      );
      return get().saveTemplates(templates);
    },

    removeTemplate: async (id: string) => {
      const templates = get().templates.filter((t) => t.id !== id);
      return get().saveTemplates(templates);
    },

    duplicateTemplate: async (id: string) => {
      const t = get().templates.find((x) => x.id === id);
      if (!t) return null;
      const copy: GlobalAgentTemplate = {
        ...JSON.parse(JSON.stringify(t)),
        id: generateId(),
        name: `${t.name} (copy)`,
        updatedAt: Date.now(),
      };
      const templates = [...get().templates, copy];
      const ok = await get().saveTemplates(templates);
      return ok ? copy : null;
    },

    getTemplate: (id: string) => get().templates.find((t) => t.id === id),
  })
);

export function getGlobalAgentTemplatesStore() {
  return useGlobalAgentTemplatesStore.getState();
}

export function hasGlobalAgentTemplatesApi(): boolean {
  return hasAgentTemplatesApi();
}
