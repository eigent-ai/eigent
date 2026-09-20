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

import { proxyFetchGet, proxyFetchPost } from '@/api/http';
import { LOCAL_MODEL_OPTIONS } from '@/components/Settings/Models/localModels';
import { INIT_PROVODERS } from '@/lib/llm';
import { getAuthStore } from '@/store/authStore';
import type { Provider } from '@/types';

export type ConfiguredProvider = {
  id: number;
  provider_name: string;
  model_type: string;
  api_key: string;
  endpoint_url: string;
  encrypted_config?: Record<string, unknown> | null;
  prefer?: boolean;
  is_valid?: number | boolean;
  is_vaild?: number | boolean;
};

export const MODEL_CONFIGURATIONS_CHANGED =
  'eigent:model-configurations-changed';
export function notifyModelConfigurationsChanged() {
  window.dispatchEvent(new Event(MODEL_CONFIGURATIONS_CHANGED));
}

export const modelProviders: Provider[] = [
  ...INIT_PROVODERS.filter((provider) => provider.id !== 'local'),
  ...LOCAL_MODEL_OPTIONS.map((provider) => ({
    id: provider.id,
    name: provider.name,
    apiKey: '',
    apiHost: provider.defaultEndpoint,
    description: '',
  })),
];

export function providerDefinition(id: string): Provider {
  return (
    modelProviders.find((provider) => provider.id === id) ?? {
      id,
      name: id,
      apiKey: '',
      apiHost: '',
      description: '',
    }
  );
}

export function providerCategory(id: string): 'local' | 'custom' {
  return LOCAL_MODEL_OPTIONS.some((provider) => provider.id === id)
    ? 'local'
    : 'custom';
}

/** Do not collapse records by provider name: credentials belong to a record ID. */
export async function fetchConfiguredProviders(): Promise<
  ConfiguredProvider[]
> {
  const records = new Map<number, ConfiguredProvider>();
  for (let page = 1; ; page++) {
    const response = await proxyFetchGet('/api/v1/providers', {
      page,
      size: 100,
    });
    const items: ConfiguredProvider[] = Array.isArray(response)
      ? response
      : (response.items ?? []);
    const previousSize = records.size;
    for (const record of items) records.set(record.id, record);
    if (page > 1 && items.length > 0 && previousSize === records.size) {
      throw new Error('Provider pagination did not advance');
    }
    if (
      Array.isArray(response) ||
      items.length === 0 ||
      (response.pages != null && page >= response.pages) ||
      (response.total != null && records.size >= response.total) ||
      (response.pages == null && response.total == null)
    )
      break;
  }
  return [...records.values()];
}

export async function setConfiguredProviderDefault(
  provider: ConfiguredProvider
) {
  const { user_id: account, email } = getAuthStore();
  await proxyFetchPost('/api/v1/provider/prefer', { provider_id: provider.id });
  if (getAuthStore().user_id === account && getAuthStore().email === email) {
    getAuthStore().setModelType(providerCategory(provider.provider_name));
  }
  notifyModelConfigurationsChanged();
}
