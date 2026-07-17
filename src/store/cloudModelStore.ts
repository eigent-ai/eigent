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

import { proxyFetchGet } from '@/api/http';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const CLOUD_MODEL_CACHE_TTL_MS = 60 * 1000;
export const LEGACY_DEFAULT_CLOUD_MODEL_ID = 'gpt-5.5';
let cloudModelsRefreshPromise: Promise<CloudModel[]> | null = null;

export interface CloudModel {
  id: string;
  display_name: string;
  model_type: string;
  model_platform: string;
  provider_family: string;
  kind: 'chat' | 'image' | string;
  capabilities?: Record<string, unknown> | null;
  is_default?: boolean;
  sort_order?: number;
  min_plan_key?: string | null;
  min_app_version?: string | null;
  replaced_by_model_id?: string | null;
}

export interface RetiredCloudModel {
  id: string;
  replaced_by_model_id?: string | null;
}

interface CloudModelsResponse {
  models?: CloudModel[];
  retired?: RetiredCloudModel[];
  default_model_id?: string;
  version?: string;
  not_modified?: boolean;
}

export type CloudModelResolutionSource = 'selected' | 'replaced' | 'default';

export interface ResolvedCloudModel {
  model: CloudModel;
  source: CloudModelResolutionSource;
  requestedModelId?: string;
}

type CloudModelFetchStatus = 'idle' | 'loading' | 'ready' | 'error';
type CloudModelSource = 'server' | 'cache' | 'legacy';
const CLOUD_MODEL_STORAGE_VERSION = 3;
type PersistedCloudModelState = Pick<
  CloudModelState,
  | 'models'
  | 'retired'
  | 'defaultModelId'
  | 'version'
  | 'lastFetchedAt'
  | 'source'
>;

interface CloudModelState {
  models: CloudModel[];
  retired: RetiredCloudModel[];
  defaultModelId: string;
  version: string;
  lastFetchedAt: number;
  status: CloudModelFetchStatus;
  source: CloudModelSource;
  error: string | null;
  fetchCloudModels: (force?: boolean) => Promise<CloudModel[]>;
  resolveCloudModel: (modelId?: string | null) => ResolvedCloudModel | null;
  getModelDisplayName: (modelId?: string | null) => string;
  /**
   * Returns the id of the enabled chat model that a persisted selection
   * effectively maps to (selected as-is, or via `replaced_by_model_id`, or
   * the current default when truly orphaned). Use this for UI selection
   * comparisons so retired/replaced ids still show as "selected" in dropdowns.
   */
  getEffectiveModelId: (modelId?: string | null) => string | null;
}

export const LEGACY_CLOUD_MODELS: CloudModel[] = [
  {
    id: 'gpt-5.5',
    display_name: 'GPT-5.5',
    model_type: 'gpt-5.5',
    model_platform: 'azure',
    provider_family: 'openai',
    kind: 'chat',
    is_default: true,
    sort_order: 10,
  },
  {
    id: 'gpt-5.4',
    display_name: 'GPT-5.4',
    model_type: 'gpt-5.4',
    model_platform: 'azure',
    provider_family: 'openai',
    kind: 'chat',
    sort_order: 20,
  },
  {
    id: 'gemini-3.5-flash',
    display_name: 'Gemini 3.5 Flash',
    model_type: 'gemini-3.5-flash',
    model_platform: 'gemini',
    provider_family: 'google',
    kind: 'chat',
    sort_order: 30,
  },
  {
    id: 'gemini-3.1-pro-preview',
    display_name: 'Gemini 3.1 Pro Preview',
    model_type: 'gemini-3.1-pro-preview',
    model_platform: 'gemini',
    provider_family: 'google',
    kind: 'chat',
    sort_order: 40,
  },
  {
    id: 'gemini-3-pro-preview',
    display_name: 'Gemini 3 Pro Preview',
    model_type: 'gemini-3-pro-preview',
    model_platform: 'gemini',
    provider_family: 'google',
    kind: 'chat',
    sort_order: 50,
  },
  {
    id: 'gemini-3-flash-preview',
    display_name: 'Gemini 3 Flash Preview',
    model_type: 'gemini-3-flash-preview',
    model_platform: 'gemini',
    provider_family: 'google',
    kind: 'chat',
    sort_order: 60,
  },
  {
    id: 'claude-haiku-4-5',
    display_name: 'Claude Haiku 4.5',
    model_type: 'claude-haiku-4-5',
    model_platform: 'aws-bedrock-converse',
    provider_family: 'anthropic',
    kind: 'chat',
    sort_order: 70,
  },
  {
    id: 'claude-sonnet-4-5',
    display_name: 'Claude Sonnet 4.5',
    model_type: 'claude-sonnet-4-5',
    model_platform: 'aws-bedrock-converse',
    provider_family: 'anthropic',
    kind: 'chat',
    sort_order: 80,
  },
  {
    id: 'claude-sonnet-4-6',
    display_name: 'Claude Sonnet 4.6',
    model_type: 'claude-sonnet-4-6',
    model_platform: 'aws-bedrock-converse',
    provider_family: 'anthropic',
    kind: 'chat',
    sort_order: 90,
  },
  {
    id: 'claude-opus-4-6',
    display_name: 'Claude Opus 4.6',
    model_type: 'claude-opus-4-6',
    model_platform: 'aws-bedrock-converse',
    provider_family: 'anthropic',
    kind: 'chat',
    sort_order: 100,
  },
  {
    id: 'claude-opus-4-8',
    display_name: 'Claude Opus 4.8',
    model_type: 'claude-opus-4-8',
    model_platform: 'aws-bedrock-converse',
    provider_family: 'anthropic',
    kind: 'chat',
    sort_order: 110,
  },
  {
    id: 'claude-opus-4-7',
    display_name: 'Claude Opus 4.7',
    model_type: 'claude-opus-4-7',
    model_platform: 'aws-bedrock-converse',
    provider_family: 'anthropic',
    kind: 'chat',
    sort_order: 120,
  },
  {
    id: 'gpt-5-mini',
    display_name: 'GPT-5 Mini',
    model_type: 'gpt-5-mini',
    model_platform: 'azure',
    provider_family: 'openai',
    kind: 'chat',
    sort_order: 130,
  },
  {
    id: 'deepseek-v4-pro',
    display_name: 'DeepSeek V4 Pro',
    model_type: 'deepseek-v4-pro',
    model_platform: 'deepseek',
    provider_family: 'deepseek',
    kind: 'chat',
    sort_order: 140,
  },
  {
    id: 'minimax_m2_7',
    display_name: 'Minimax M2.7',
    model_type: 'minimax_m2_7',
    model_platform: 'minimax',
    provider_family: 'minimax',
    kind: 'chat',
    sort_order: 150,
  },
];

function fallbackModels(): CloudModel[] {
  return LEGACY_CLOUD_MODELS.map((model) => ({ ...model }));
}

function normalizeModel(raw: unknown): CloudModel | null {
  if (!raw || typeof raw !== 'object') return null;
  const model = raw as Partial<CloudModel>;
  if (
    typeof model.id !== 'string' ||
    typeof model.display_name !== 'string' ||
    typeof model.model_type !== 'string' ||
    typeof model.model_platform !== 'string' ||
    typeof model.provider_family !== 'string'
  ) {
    return null;
  }
  return {
    ...model,
    id: model.id,
    display_name: model.display_name,
    model_type: model.model_type,
    model_platform: model.model_platform,
    provider_family: model.provider_family,
    kind: model.kind || 'chat',
    sort_order: model.sort_order ?? 1000,
  };
}

function normalizeRetired(raw: unknown): RetiredCloudModel | null {
  if (!raw || typeof raw !== 'object') return null;
  const retired = raw as Partial<RetiredCloudModel>;
  if (typeof retired.id !== 'string') return null;
  return {
    id: retired.id,
    replaced_by_model_id:
      typeof retired.replaced_by_model_id === 'string'
        ? retired.replaced_by_model_id
        : null,
  };
}

function sortCloudModels(models: CloudModel[]): CloudModel[] {
  return [...models].sort(
    (a, b) =>
      (a.sort_order ?? 1000) - (b.sort_order ?? 1000) ||
      a.display_name.localeCompare(b.display_name)
  );
}

function chooseDefaultModelId(
  models: CloudModel[],
  requestedDefault?: string
): string {
  if (
    requestedDefault &&
    models.some((model) => model.id === requestedDefault)
  ) {
    return requestedDefault;
  }
  return (
    models.find((model) => model.is_default)?.id ||
    models[0]?.id ||
    LEGACY_DEFAULT_CLOUD_MODEL_ID
  );
}

function humanizeModelId(modelId?: string | null): string {
  if (!modelId) return '';
  return modelId
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizePersistedState(
  persistedState: unknown
): PersistedCloudModelState {
  if (!persistedState || typeof persistedState !== 'object') {
    return {
      models: fallbackModels(),
      retired: [],
      defaultModelId: LEGACY_DEFAULT_CLOUD_MODEL_ID,
      version: 'legacy-fallback',
      lastFetchedAt: 0,
      source: 'legacy',
    };
  }
  const state = persistedState as Partial<CloudModelState>;
  const models = sortCloudModels(
    (Array.isArray(state.models) ? state.models : [])
      .map(normalizeModel)
      .filter((model): model is CloudModel => Boolean(model))
      .filter((model) => model.kind === 'chat')
  );
  const normalizedModels = models.length > 0 ? models : fallbackModels();
  const retired = (Array.isArray(state.retired) ? state.retired : [])
    .map(normalizeRetired)
    .filter((model): model is RetiredCloudModel => Boolean(model));
  const defaultModelId = chooseDefaultModelId(
    normalizedModels,
    typeof state.defaultModelId === 'string' ? state.defaultModelId : undefined
  );
  const source =
    state.source === 'server' || state.source === 'cache'
      ? state.source
      : 'legacy';

  return {
    models: normalizedModels,
    retired,
    defaultModelId,
    version:
      typeof state.version === 'string' ? state.version : 'legacy-fallback',
    lastFetchedAt:
      source === 'legacy' || state.version === 'legacy-fallback'
        ? 0
        : typeof state.lastFetchedAt === 'number'
          ? state.lastFetchedAt
          : 0,
    source,
  };
}

function etagHeaderForVersion(version: string): Record<string, string> {
  if (!version || version === 'legacy-fallback') return {};
  const normalized = version.replace(/^W\//, '').replace(/^"|"$/g, '');
  return normalized ? { 'If-None-Match': `"${normalized}"` } : {};
}

export const useCloudModelStore = create<CloudModelState>()(
  persist(
    (set, get) => ({
      models: fallbackModels(),
      retired: [],
      defaultModelId: LEGACY_DEFAULT_CLOUD_MODEL_ID,
      version: 'legacy-fallback',
      lastFetchedAt: 0,
      status: 'idle',
      source: 'legacy',
      error: null,

      fetchCloudModels: async (force = false) => {
        const state = get();
        const now = Date.now();
        const hasCachedModels =
          state.models.length > 0 && state.lastFetchedAt > 0;
        const hasFreshServerCache =
          state.source === 'server' &&
          hasCachedModels &&
          now - state.lastFetchedAt < CLOUD_MODEL_CACHE_TTL_MS;
        if (!force && hasFreshServerCache) {
          return state.models;
        }
        if (!force && hasCachedModels) {
          void get().fetchCloudModels(true);
          return state.models;
        }
        if (cloudModelsRefreshPromise) {
          return cloudModelsRefreshPromise;
        }

        cloudModelsRefreshPromise = (async () => {
          const beforeFetch = get();
          set({
            status:
              beforeFetch.models.length > 0 ? beforeFetch.status : 'loading',
            error: null,
          });
          try {
            const response = (await proxyFetchGet(
              '/api/v1/cloud-models',
              { kind: 'chat' },
              etagHeaderForVersion(beforeFetch.version)
            )) as CloudModelsResponse;
            if (response?.not_modified) {
              set({
                lastFetchedAt: Date.now(),
                status: 'ready',
                source:
                  beforeFetch.source === 'legacy'
                    ? 'cache'
                    : beforeFetch.source,
                error: null,
              });
              return get().models;
            }
            const models = sortCloudModels(
              (Array.isArray(response?.models) ? response.models : [])
                .map(normalizeModel)
                .filter((model): model is CloudModel => Boolean(model))
                .filter((model) => model.kind === 'chat')
            );
            if (models.length === 0) {
              throw new Error('Cloud model API returned no chat models');
            }
            const retired = (
              Array.isArray(response?.retired) ? response.retired : []
            )
              .map(normalizeRetired)
              .filter((model): model is RetiredCloudModel => Boolean(model));
            const defaultModelId = chooseDefaultModelId(
              models,
              response.default_model_id
            );
            set({
              models,
              retired,
              defaultModelId,
              version: response.version || 'server',
              lastFetchedAt: Date.now(),
              status: 'ready',
              source: 'server',
              error: null,
            });
            return models;
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : 'Failed to load cloud models';
            const current = get();
            const models =
              current.models.length > 0 ? current.models : fallbackModels();
            set({
              models,
              defaultModelId: chooseDefaultModelId(
                models,
                current.defaultModelId || LEGACY_DEFAULT_CLOUD_MODEL_ID
              ),
              lastFetchedAt: Date.now(),
              status: 'error',
              source: current.source === 'server' ? 'cache' : 'legacy',
              error: message,
            });
            return models;
          } finally {
            cloudModelsRefreshPromise = null;
          }
        })();
        return cloudModelsRefreshPromise;
      },

      resolveCloudModel: (modelId) => {
        const { models, retired, defaultModelId } = get();
        const requestedModelId =
          typeof modelId === 'string' && modelId.length > 0
            ? modelId
            : undefined;
        const selected = requestedModelId
          ? models.find((model) => model.id === requestedModelId)
          : undefined;
        if (selected) {
          return {
            model: selected,
            source: 'selected',
            requestedModelId,
          };
        }

        const retiredModel = requestedModelId
          ? retired.find((model) => model.id === requestedModelId)
          : undefined;
        const replacement = retiredModel?.replaced_by_model_id
          ? models.find(
              (model) => model.id === retiredModel.replaced_by_model_id
            )
          : undefined;
        if (replacement) {
          return {
            model: replacement,
            source: 'replaced',
            requestedModelId,
          };
        }

        const defaultModel =
          models.find((model) => model.id === defaultModelId) ||
          models.find((model) => model.is_default) ||
          models[0] ||
          null;
        return defaultModel
          ? {
              model: defaultModel,
              source: 'default',
              requestedModelId,
            }
          : null;
      },

      getModelDisplayName: (modelId) => {
        const resolved = get().resolveCloudModel(modelId);
        return resolved?.model.display_name || humanizeModelId(modelId);
      },

      getEffectiveModelId: (modelId) => {
        return get().resolveCloudModel(modelId)?.model.id ?? null;
      },
    }),
    {
      name: 'cloud-model-storage',
      version: CLOUD_MODEL_STORAGE_VERSION,
      migrate: (persistedState) => normalizePersistedState(persistedState),
      partialize: (state) => ({
        models: state.models,
        retired: state.retired,
        defaultModelId: state.defaultModelId,
        version: state.version,
        lastFetchedAt: state.lastFetchedAt,
        source: state.source,
      }),
    }
  )
);

export const getCloudModelStore = () => useCloudModelStore.getState();
