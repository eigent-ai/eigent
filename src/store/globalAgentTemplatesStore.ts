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
  /** Serialized ToolSelect rows so “Create from template” restores MCP/local tool picks */
  selected_tools_snapshot?: unknown[];
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

function normalizeMcpTools(mcp: unknown): GlobalAgentTemplate['mcp_tools'] {
  if (mcp === undefined || mcp === null) return { mcpServers: {} };
  if (typeof mcp !== 'object' || Array.isArray(mcp)) return { mcpServers: {} };
  const obj = mcp as Record<string, unknown>;
  const servers = obj.mcpServers;
  if (
    servers !== undefined &&
    servers !== null &&
    typeof servers === 'object' &&
    !Array.isArray(servers)
  ) {
    return { mcpServers: servers as Record<string, unknown> };
  }
  return { mcpServers: {} };
}

/** Validate JSON file content for “Import agent template” (export shape or backend-style). */
export function parseImportedAgentTemplateJson(
  data: unknown
): GlobalAgentTemplate | null {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }
  const o = data as Record<string, unknown>;
  const nameRaw = o.name;
  if (typeof nameRaw !== 'string' || nameRaw.trim().length === 0) {
    return null;
  }
  if (o.description !== undefined && typeof o.description !== 'string') {
    return null;
  }
  const tools = o.tools;
  if (tools !== undefined) {
    if (!Array.isArray(tools) || !tools.every((x) => typeof x === 'string')) {
      return null;
    }
  }
  const mcp = o.mcp_tools;
  if (
    mcp !== undefined &&
    (mcp === null || typeof mcp !== 'object' || Array.isArray(mcp))
  ) {
    return null;
  }
  const cmc = o.custom_model_config;
  if (
    cmc !== undefined &&
    (cmc === null || typeof cmc !== 'object' || Array.isArray(cmc))
  ) {
    return null;
  }
  const snap =
    o.selected_tools_snapshot !== undefined
      ? o.selected_tools_snapshot
      : o.selectedTools;
  if (snap !== undefined && (snap === null || !Array.isArray(snap))) {
    return null;
  }
  return {
    id: generateId(),
    name: nameRaw.trim(),
    description: typeof o.description === 'string' ? o.description : '',
    tools: Array.isArray(tools) ? [...tools] : [],
    mcp_tools: normalizeMcpTools(mcp),
    custom_model_config:
      cmc && typeof cmc === 'object' && !Array.isArray(cmc)
        ? (cmc as GlobalAgentTemplate['custom_model_config'])
        : undefined,
    selected_tools_snapshot: Array.isArray(snap)
      ? JSON.parse(JSON.stringify(snap))
      : undefined,
    updatedAt: Date.now(),
  };
}

function isPersistedTemplateRow(t: unknown): t is GlobalAgentTemplate {
  if (t === null || typeof t !== 'object' || Array.isArray(t)) return false;
  const o = t as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id.trim()) return false;
  if (typeof o.name !== 'string' || !o.name.trim()) return false;
  if (o.description !== undefined && typeof o.description !== 'string') {
    return false;
  }
  if (!Array.isArray(o.tools) || !o.tools.every((x) => typeof x === 'string')) {
    return false;
  }
  if (
    o.mcp_tools === null ||
    typeof o.mcp_tools !== 'object' ||
    Array.isArray(o.mcp_tools)
  ) {
    return false;
  }
  if (typeof o.updatedAt !== 'number' || Number.isNaN(o.updatedAt))
    return false;
  if (
    o.selected_tools_snapshot !== undefined &&
    !Array.isArray(o.selected_tools_snapshot)
  ) {
    return false;
  }
  return true;
}

function sanitizePersistedTemplates(rows: unknown[]): GlobalAgentTemplate[] {
  return rows.filter(isPersistedTemplateRow).map((r) => ({
    ...r,
    name: r.name.trim(),
    description: typeof r.description === 'string' ? r.description : '',
    tools: [...r.tools],
    mcp_tools:
      typeof r.mcp_tools === 'object' && r.mcp_tools !== null
        ? JSON.parse(JSON.stringify(r.mcp_tools))
        : { mcpServers: {} },
    selected_tools_snapshot: Array.isArray(r.selected_tools_snapshot)
      ? JSON.parse(JSON.stringify(r.selected_tools_snapshot))
      : undefined,
  }));
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
          const raw = result.templates as unknown[];
          const cleaned = sanitizePersistedTemplates(raw);
          set({ templates: cleaned });
          if (cleaned.length !== raw.length) {
            await window.electronAPI.agentTemplatesSave(userId, cleaned);
          }
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
