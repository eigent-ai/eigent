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

// What the account's server may know about a model set up on this device:
// which provider and model it is, its plain address and a few plain settings.
// It lets features that start work from the server pick the account's model.
// A key, a secret setting or an address with credentials is never sent, and
// nothing here is needed for a model to work on this device: every call is
// best effort and a server that refuses or does not know these routes is fine.

import {
  proxyFetchDelete,
  proxyFetchGet,
  proxyFetchPost,
  proxyFetchPut,
} from '@/api/http';
import { LOCAL_MODEL_OPTIONS } from '@/components/Settings/Models/localModels';
import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import {
  importLocalModelConfigurations,
  linkLocalModelConfiguration,
  SAVED_VALUE_MARKER,
  type LocalModelConfiguration,
  type ModelConfigurationImportRecord,
} from '@/lib/modelConfigurationStore';
import { getProviderValid, toProviderValidStatus } from '@/lib/providerStatus';
import { getAuthStore } from '@/store/authStore';

const ROUTE = '/api/v1/model-providers';
const PROVIDER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const FIRST_DEVICE_ID = 2 ** 31;

const PLAIN_TEXT_SETTINGS: Record<string, number> = {
  region_name: 64,
  api_version: 64,
  api_mode: 64,
  azure_deployment_name: 128,
};
const PLAIN_NUMBER_PARAMETERS = [
  'temperature',
  'top_p',
  'max_tokens',
  'max_completion_tokens',
  'seed',
  'frequency_penalty',
  'presence_penalty',
];

export interface ModelProviderMetadata {
  provider_name: string;
  model_type: string;
  endpoint_url: string;
  config: Record<string, unknown>;
  is_valid: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function plainText(value: unknown, max: number): string | undefined {
  return typeof value === 'string' &&
    value !== '' &&
    value === value.trim() &&
    value !== SAVED_VALUE_MARKER &&
    value.length <= max &&
    !CONTROL_CHARACTERS.test(value)
    ? value
    : undefined;
}

/** An address with its sign-in part, query and fragment removed. */
export function plainEndpoint(endpoint: unknown): string {
  if (typeof endpoint !== 'string') return '';
  let parsed: URL;
  try {
    parsed = new URL(endpoint.trim());
  } catch {
    return '';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
  const plain = `${parsed.origin}${parsed.pathname}`;
  return plain.length <= 512 ? plain : '';
}

/**
 * The only fields that may leave the device for a configuration, or null when
 * even its name cannot be sent. Everything not listed here stays local.
 */
export function modelProviderMetadata(
  record: Pick<
    LocalModelConfiguration,
    'provider_name' | 'model_type' | 'endpoint_url' | 'encrypted_config'
  > & { is_valid?: unknown }
): ModelProviderMetadata | null {
  if (
    !PROVIDER_NAME.test(record.provider_name) ||
    record.model_type.length > 128 ||
    record.model_type !== record.model_type.trim() ||
    CONTROL_CHARACTERS.test(record.model_type)
  )
    return null;
  const source = isRecord(record.encrypted_config)
    ? record.encrypted_config
    : {};
  const config: Record<string, unknown> = {};
  const platform = plainText(source.model_platform, 64);
  if (platform && PROVIDER_NAME.test(platform))
    config.model_platform = platform;
  const modelType = plainText(source.model_type, 128);
  if (modelType) config.model_type = modelType;
  for (const [name, max] of Object.entries(PLAIN_TEXT_SETTINGS)) {
    const value = plainText(source[name], max);
    if (value) config[name] = value;
  }
  if (isRecord(source.model_config_dict)) {
    const parameters: Record<string, unknown> = {};
    for (const name of PLAIN_NUMBER_PARAMETERS) {
      const value = source.model_config_dict[name];
      if (typeof value === 'number' && Number.isFinite(value))
        parameters[name] = value;
    }
    if (typeof source.model_config_dict.stream === 'boolean')
      parameters.stream = source.model_config_dict.stream;
    const count = source.model_config_dict.n;
    if (
      typeof count === 'number' &&
      Number.isInteger(count) &&
      count >= 1 &&
      count <= 16
    )
      parameters.n = count;
    if (Object.keys(parameters).length > 0)
      config.model_config_dict = parameters;
  }
  return {
    provider_name: record.provider_name,
    model_type: record.model_type,
    endpoint_url: plainEndpoint(record.endpoint_url),
    config,
    is_valid: toProviderValidStatus(getProviderValid(record)),
  };
}

function failureStatus(error: unknown): number | undefined {
  const status = isRecord(error) ? error.status : undefined;
  return typeof status === 'number' ? status : undefined;
}

function serverId(value: unknown): number | null {
  const id = isRecord(value) ? value.id : undefined;
  return typeof id === 'number' &&
    Number.isInteger(id) &&
    id >= 1 &&
    id < FIRST_DEVICE_ID
    ? id
    : null;
}

/**
 * Tell the server about a configuration, or update what it knows. Returns the
 * server's identifier for it, or null when the server did not take it.
 */
export async function registerModelConfiguration(
  record: LocalModelConfiguration
): Promise<number | null> {
  const body = modelProviderMetadata(record);
  if (!body) return null;
  const accountKey = getAccountEnvironmentKey(getAuthStore());
  const options = { expectedAccountKey: accountKey };
  try {
    if (record.server_id != null) {
      try {
        const updated = await proxyFetchPut(
          `${ROUTE}/${record.server_id}`,
          body,
          undefined,
          options
        );
        if (serverId(updated) === record.server_id) return record.server_id;
        return null;
      } catch (error) {
        // The server no longer has it: register it again below.
        if (failureStatus(error) !== 404) throw error;
      }
    }
    const id = serverId(await proxyFetchPost(ROUTE, body, undefined, options));
    if (id === null || accountKey !== getAccountEnvironmentKey(getAuthStore()))
      return null;
    await linkLocalModelConfiguration(getAuthStore(), record.id, id);
    return id;
  } catch {
    return null;
  }
}

/** Tell the server which configuration is the account's default. */
export async function registerDefaultModelConfiguration(
  record: LocalModelConfiguration
): Promise<void> {
  const accountKey = getAccountEnvironmentKey(getAuthStore());
  try {
    const id = record.server_id ?? (await registerModelConfiguration(record));
    if (id === null) return;
    await proxyFetchPost(`${ROUTE}/prefer`, { provider_id: id }, undefined, {
      expectedAccountKey: accountKey,
    });
  } catch {
    // The default still applies on this device.
  }
}

/** Remove what the server knows about a configuration removed here. */
export async function unregisterModelConfiguration(
  serverRecordId: number | null | undefined
): Promise<void> {
  if (serverRecordId == null) return;
  try {
    await proxyFetchDelete(`${ROUTE}/${serverRecordId}`);
  } catch {
    // Nothing on this device depends on the server copy.
  }
}

const attemptedAccounts = new Set<string>();

/**
 * Take over the model list the account had before keys were kept on the
 * device: names and plain settings only. The server sends no key, and each
 * taken-over model asks for its key again. Tried once per account per app
 * start; returns whether a list was taken over.
 */
export async function importEarlierModelConfigurations(): Promise<boolean> {
  const accountKey = getAccountEnvironmentKey(getAuthStore());
  if (attemptedAccounts.has(accountKey)) return false;
  attemptedAccounts.add(accountKey);
  const options = { expectedAccountKey: accountKey };
  const records = new Map<number, ModelConfigurationImportRecord>();
  try {
    for (let page = 1; page <= 6; page++) {
      const response: unknown = await proxyFetchGet(
        ROUTE,
        { page, size: 100 },
        undefined,
        options
      );
      const items = isRecord(response) ? response.items : undefined;
      if (!Array.isArray(items)) return false;
      for (const item of items) {
        const id = serverId(item);
        if (id === null || !isRecord(item)) continue;
        const providerName = plainText(item.provider_name, 128);
        if (!providerName) continue;
        const metadata = modelProviderMetadata({
          provider_name: providerName,
          model_type:
            typeof item.model_type === 'string' ? item.model_type : '',
          endpoint_url:
            typeof item.endpoint_url === 'string' ? item.endpoint_url : '',
          encrypted_config: isRecord(item.config) ? item.config : {},
        });
        if (!metadata) continue;
        records.set(id, {
          id,
          provider_name: metadata.provider_name,
          model_type: metadata.model_type,
          endpoint_url: metadata.endpoint_url,
          config: metadata.config,
          prefer: item.prefer === true,
          needs_key: !LOCAL_MODEL_OPTIONS.some(
            (option) => option.id === metadata.provider_name
          ),
        });
      }
      const pages = isRecord(response) ? response.pages : undefined;
      if (
        items.length === 0 ||
        (typeof pages === 'number' ? page >= pages : items.length < 100)
      )
        break;
    }
    if (accountKey !== getAccountEnvironmentKey(getAuthStore())) return false;
    await importLocalModelConfigurations(getAuthStore(), [...records.values()]);
    return true;
  } catch {
    // An older server does not have this list. Nothing to take over.
    return false;
  }
}

/** Test seam: allow another take-over attempt in the same run. */
export function resetModelProviderRegistration(): void {
  attemptedAccounts.clear();
}
