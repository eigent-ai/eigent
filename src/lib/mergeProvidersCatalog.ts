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

/**
 * Single source of truth for merging GET /api/v1/providers into UI catalog
 * state (chat dropdown + Agents → Models). Keep in sync with Models.tsx.
 */

import {
  getDefaultLocalEndpoint,
  LOCAL_MODEL_OPTIONS,
} from '@/pages/Agents/localModels';
import type { Provider } from '@/types';

export type ProvidersCatalogFormRow = {
  apiKey: string;
  apiHost: string;
  is_valid: boolean;
  model_type: string;
  externalConfig?:
    | Array<{
        key: string;
        name: string;
        value: string;
        placeholder?: string;
        secret?: boolean;
        options?: { label: string; value: string }[];
      }>
    | undefined;
  provider_id?: number;
  prefer: boolean;
};

export type ProvidersCatalogModelType = 'cloud' | 'local' | 'custom';

export type ProvidersCatalogSnapshot = {
  form: ProvidersCatalogFormRow[];
  localEndpoints: Record<string, string>;
  localTypes: Record<string, string>;
  localProviderIds: Record<string, number | undefined>;
  cloudPrefer: boolean;
  localPrefer: boolean;
  localPlatform: string;
  /**
   * True iff the API response (`prefer=true`) contained at least one row.
   * Mirrors the legacy `useModelConfigCheck` heuristic so consumers can derive
   * `hasModelConfigured` for local/custom modes without a duplicate fetch.
   */
  hasPreferredProvider: boolean;
};

export function createInitialCatalogForm(
  items: Provider[]
): ProvidersCatalogFormRow[] {
  return items.map((p) => ({
    apiKey: p.apiKey,
    apiHost: p.apiHost,
    is_valid: p.is_valid ?? false,
    model_type: p.model_type ?? '',
    externalConfig: p.externalConfig
      ? p.externalConfig.map((ec) => ({ ...ec }))
      : undefined,
    provider_id: p.provider_id ?? undefined,
    prefer: p.prefer ?? false,
  }));
}

/** Normalized provider row from API (subset used for merge). */
export type ApiProviderRow = {
  id?: number;
  provider_name: string;
  api_key?: string;
  endpoint_url?: string;
  is_valid?: boolean;
  prefer?: boolean;
  model_type?: string;
  encrypted_config?: Record<string, string>;
};

function parseProviderList(res: unknown): ApiProviderRow[] {
  if (Array.isArray(res)) return res as ApiProviderRow[];
  const items = (res as { items?: ApiProviderRow[] })?.items;
  return Array.isArray(items) ? items : [];
}

/**
 * Merge provider API response + auth modelType into catalog snapshot.
 * Matches SettingModels load effect (superset: includes localEndpoints).
 */
export function buildProvidersCatalogSnapshot(
  items: Provider[],
  res: unknown,
  modelType: ProvidersCatalogModelType
): ProvidersCatalogSnapshot {
  const providerList = parseProviderList(res);

  let form: ProvidersCatalogFormRow[] = createInitialCatalogForm(items);

  form = form.map((fi, idx) => {
    const item = items[idx];
    const found = providerList.find((p) => p.provider_name === item.id);
    if (found) {
      return {
        ...fi,
        provider_id: found.id,
        apiKey: found.api_key || '',
        apiHost: found.endpoint_url || item.apiHost,
        is_valid: !!found?.is_valid,
        prefer: found.prefer ?? false,
        model_type: found.model_type ?? '',
        externalConfig: fi.externalConfig
          ? fi.externalConfig.map((ec) => {
              if (
                found.encrypted_config &&
                found.encrypted_config[ec.key] !== undefined
              ) {
                return { ...ec, value: found.encrypted_config[ec.key] };
              }
              return ec;
            })
          : undefined,
      };
    }
    return {
      ...fi,
      prefer: fi.prefer ?? false,
    };
  });

  const localProviders = providerList.filter((p) =>
    LOCAL_MODEL_OPTIONS.some((model) => model.id === p.provider_name)
  );

  // Always seed every known local platform with defaults so consumers can
  // index by any LOCAL_MODEL_OPTIONS id without missing keys after a partial
  // delete (e.g., user removes Ollama while LM Studio remains configured).
  const endpoints: Record<string, string> = {};
  const types: Record<string, string> = {};
  const providerIds: Record<string, number | undefined> = {};
  LOCAL_MODEL_OPTIONS.forEach((model) => {
    endpoints[model.id] = getDefaultLocalEndpoint(model.id);
    types[model.id] = '';
    providerIds[model.id] = undefined;
  });

  let preferredPlatform = '';
  let anyLocalPrefer = false;

  localProviders.forEach((local) => {
    const platform =
      local.encrypted_config?.model_platform || local.provider_name;
    endpoints[platform] =
      local.endpoint_url || getDefaultLocalEndpoint(platform);
    types[platform] = local.encrypted_config?.model_type || '';
    providerIds[platform] = local.id;

    if (!preferredPlatform) {
      preferredPlatform = platform;
    }

    if (local.prefer) {
      anyLocalPrefer = true;
      preferredPlatform = platform;
    }
  });

  let cloudPrefer = false;
  let localPrefer = false;
  let localPlatform = preferredPlatform;

  if (modelType === 'cloud') {
    cloudPrefer = true;
    form = form.map((fi) => ({ ...fi, prefer: false }));
    localPrefer = false;
  } else if (modelType === 'local') {
    form = form.map((fi) => ({ ...fi, prefer: false }));
    localPrefer = true;
    cloudPrefer = false;
    if (anyLocalPrefer) {
      localPlatform = preferredPlatform;
    }
  } else {
    localPrefer = false;
    cloudPrefer = false;
  }

  return {
    form,
    localEndpoints: endpoints,
    localTypes: types,
    localProviderIds: providerIds,
    cloudPrefer,
    localPrefer,
    localPlatform,
    hasPreferredProvider: providerList.length > 0,
  };
}
