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

import { LOCAL_MODEL_OPTIONS } from '@/components/Settings/Models/localModels';
import { isCloudModelAvailable } from '@/lib/cloudModelAvailability';
import { INIT_PROVODERS } from '@/lib/llm';
import {
  deleteLocalModelConfiguration,
  saveLocalModelConfiguration,
  setLocalModelConfigurationDefault,
  type ModelConfigurationInput,
} from '@/lib/modelConfigurationStore';
import { configuredModelName, modelDisplayName } from '@/lib/modelDisplayName';
import {
  registerDefaultModelConfiguration,
  registerModelConfiguration,
  unregisterModelConfiguration,
} from '@/lib/modelProviderRegistration';
import { getProviderValid } from '@/lib/providerStatus';
import {
  fetchSavedModelInventory,
  fetchSavedModels,
  type ModelKeyStorage,
  type SavedModel,
} from '@/lib/savedModels';
import { getAuthStore } from '@/store/authStore';
import type { CloudModel } from '@/store/cloudModelStore';
import type { Provider } from '@/types';

/**
 * One of the user's own model configurations. It is kept on this device and
 * carries no key: a run names it by `model_credential` instead.
 */
export type ConfiguredProvider = SavedModel;

export type { ModelKeyStorage };

export type ConfiguredModelChoice =
  | { id: string; group: 'eigent'; name: string; cloudModel: CloudModel }
  | { id: string; group: string; name: string; record: ConfiguredProvider }
  | { id: 'codex'; group: 'codex-subscription'; name: string };

export function selectableConfiguredModels({
  records,
  cloudModels,
  hidden,
  cloudAvailable,
  codexConnected,
  codexModelType,
  planKey,
}: {
  records: ConfiguredProvider[];
  cloudModels: CloudModel[];
  hidden: string[];
  cloudAvailable: boolean;
  codexConnected: boolean;
  codexModelType: string;
  planKey?: string | null;
}): ConfiguredModelChoice[] {
  const validRecords = records.filter(getProviderValid);
  return [
    ...(cloudAvailable
      ? cloudModels
          .filter(
            (model) =>
              !hidden.includes(model.id) &&
              isCloudModelAvailable(model, planKey)
          )
          .map((model) => ({
            id: `cloud:${model.id}`,
            group: 'eigent' as const,
            name: modelDisplayName(model.display_name),
            cloudModel: model,
          }))
      : []),
    ...validRecords.map((record) => ({
      id: `provider:${record.id}`,
      group: record.provider_name,
      name: configuredModelName(record, validRecords),
      record,
    })),
    ...(codexConnected
      ? [
          {
            id: 'codex' as const,
            group: 'codex-subscription' as const,
            name: modelDisplayName(codexModelType),
          },
        ]
      : []),
  ];
}

function endpointHost(endpoint: string) {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint.trim();
  }
}

/**
 * Tells a record apart from saved records with the same provider and model:
 * its endpoint host, else its position among them. Empty when unique. No part
 * of a key is shown: this window does not have the key.
 */
export function configurationHint(
  record: ConfiguredProvider,
  records: ConfiguredProvider[]
): string {
  const twins = records.filter(
    (other) =>
      other.id !== record.id &&
      other.provider_name === record.provider_name &&
      other.model_type === record.model_type
  );
  if (!twins.length) return '';
  const host = endpointHost(record.endpoint_url ?? '');
  if (
    host &&
    twins.every((other) => endpointHost(other.endpoint_url ?? '') !== host)
  )
    return host;
  const position =
    [record, ...twins]
      .map((item) => item.id)
      .sort((left, right) => left - right)
      .indexOf(record.id) + 1;
  return `#${position}`;
}

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

/** The user's own model configurations, read from this device. */
export const fetchConfiguredProviders = fetchSavedModels;

/** The same list with where its keys are kept. */
export const fetchConfiguredModelInventory = fetchSavedModelInventory;

/** Save a configuration on this device. The key never leaves it. */
export async function saveConfiguredProvider(
  input: ModelConfigurationInput
): Promise<ConfiguredProvider> {
  const saved = await saveLocalModelConfiguration(getAuthStore(), input);
  // The server only learns the name and plain settings, and only if it can.
  void registerModelConfiguration(saved);
  notifyModelConfigurationsChanged();
  return saved;
}

export async function deleteConfiguredProvider(
  provider: Pick<ConfiguredProvider, 'id' | 'server_id'>
) {
  await deleteLocalModelConfiguration(getAuthStore(), provider.id);
  void unregisterModelConfiguration(provider.server_id);
  notifyModelConfigurationsChanged();
}

export async function setConfiguredProviderDefault(
  provider: ConfiguredProvider
) {
  const { user_id: account, email } = getAuthStore();
  await setLocalModelConfigurationDefault(getAuthStore(), provider.id);
  void registerDefaultModelConfiguration(provider);
  if (getAuthStore().user_id === account && getAuthStore().email === email) {
    getAuthStore().setModelType(providerCategory(provider.provider_name));
  }
  notifyModelConfigurationsChanged();
}
