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

import { fetchGet } from '@/api/http';
import { create } from 'zustand';

export interface ProjectWidgetManifest {
  name?: string;
  description?: string;
  version?: number | string;
  preview?: string;
  entry?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface ProjectWidget {
  exists: boolean;
  manifest?: ProjectWidgetManifest;
  previewHtml?: string;
  entryHtml?: string;
  previewUrl?: string;
  entryUrl?: string;
  updatedAt?: string;
}

interface WidgetState {
  widgetsByProjectId: Record<string, ProjectWidget>;
  loadingByProjectId: Record<string, boolean>;
  errorByProjectId: Record<string, string | null>;
  lastLoadedByProjectId: Record<string, number>;
  loadProjectWidget: (
    projectId: string,
    email: string,
    options?: { quietMissing?: boolean }
  ) => Promise<ProjectWidget>;
  refreshProjectWidget: (
    projectId: string,
    email: string
  ) => Promise<ProjectWidget>;
  getProjectWidget: (projectId?: string | null) => ProjectWidget | null;
  getProjectWidgetLoading: (projectId?: string | null) => boolean;
  getProjectWidgetError: (projectId?: string | null) => string | null;
}

function normalizeWidgetResponse(response: any): ProjectWidget {
  if (!response || response.exists === false) {
    return { exists: false };
  }

  return {
    exists: true,
    manifest: response.manifest ?? {},
    previewHtml: response.previewHtml ?? '',
    entryHtml: response.entryHtml ?? '',
    previewUrl: response.previewUrl,
    entryUrl: response.entryUrl,
    updatedAt: response.updatedAt ?? response.manifest?.updatedAt,
  };
}

export const useWidgetStore = create<WidgetState>()((set, get) => ({
  widgetsByProjectId: {},
  loadingByProjectId: {},
  errorByProjectId: {},
  lastLoadedByProjectId: {},

  loadProjectWidget: async (projectId, email, options) => {
    if (!projectId || !email) {
      return { exists: false };
    }

    set((state) => ({
      loadingByProjectId: { ...state.loadingByProjectId, [projectId]: true },
      errorByProjectId: { ...state.errorByProjectId, [projectId]: null },
    }));

    try {
      const response = await fetchGet(
        `/projects/${encodeURIComponent(projectId)}/widget`,
        { email }
      );
      const widget = normalizeWidgetResponse(response);

      set((state) => ({
        widgetsByProjectId: {
          ...state.widgetsByProjectId,
          [projectId]: widget,
        },
        loadingByProjectId: {
          ...state.loadingByProjectId,
          [projectId]: false,
        },
        errorByProjectId: {
          ...state.errorByProjectId,
          [projectId]: null,
        },
        lastLoadedByProjectId: {
          ...state.lastLoadedByProjectId,
          [projectId]: Date.now(),
        },
      }));

      if (!widget.exists && !options?.quietMissing) {
        return widget;
      }

      return widget;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load widget';
      set((state) => ({
        loadingByProjectId: {
          ...state.loadingByProjectId,
          [projectId]: false,
        },
        errorByProjectId: {
          ...state.errorByProjectId,
          [projectId]: message,
        },
      }));
      throw error;
    }
  },

  refreshProjectWidget: async (projectId, email) =>
    get().loadProjectWidget(projectId, email),

  getProjectWidget: (projectId) => {
    if (!projectId) return null;
    return get().widgetsByProjectId[projectId] ?? null;
  },

  getProjectWidgetLoading: (projectId) => {
    if (!projectId) return false;
    return Boolean(get().loadingByProjectId[projectId]);
  },

  getProjectWidgetError: (projectId) => {
    if (!projectId) return null;
    return get().errorByProjectId[projectId] ?? null;
  },
}));
