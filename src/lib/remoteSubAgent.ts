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

export const GEMINI_REMOTE_SUB_AGENT_PROVIDER = 'gemini_agents';
export const MODELARK_REMOTE_SUB_AGENT_PROVIDER = 'modelark_agents';
export const REMOTE_SUB_AGENT_PROVIDER = GEMINI_REMOTE_SUB_AGENT_PROVIDER;
export const REMOTE_SUB_AGENT_PROVIDER_ID = REMOTE_SUB_AGENT_PROVIDER;
export const REMOTE_SUB_AGENT_DEFAULT_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta';
export const MODELARK_REMOTE_SUB_AGENT_DEFAULT_BASE_URL =
  'https://ark.ap-southeast.bytepluses.com/api/v3';
export const REMOTE_SUB_AGENT_DEFAULT_AGENT = '';
export const REMOTE_SUB_AGENT_DEFAULT_MAX_WALL_TIME_SECONDS = '900';
export const REMOTE_SUB_AGENT_DEFAULT_POLL_INTERVAL_SECONDS = '5';

export type RemoteSubAgentProviderName =
  | typeof GEMINI_REMOTE_SUB_AGENT_PROVIDER
  | typeof MODELARK_REMOTE_SUB_AGENT_PROVIDER;

export type RemoteSubAgentProviderDefinition = {
  id: RemoteSubAgentProviderName;
  /** Key in the shared model provider logo map. */
  logo: string;
  defaultBaseUrl: string;
  requiresEnvironment: boolean;
  usesPollInterval: boolean;
  docsUrl?: string;
};

export const REMOTE_SUB_AGENT_PROVIDERS: RemoteSubAgentProviderDefinition[] = [
  {
    id: GEMINI_REMOTE_SUB_AGENT_PROVIDER,
    logo: 'gemini',
    defaultBaseUrl: REMOTE_SUB_AGENT_DEFAULT_BASE_URL,
    requiresEnvironment: false,
    usesPollInterval: true,
  },
  {
    id: MODELARK_REMOTE_SUB_AGENT_PROVIDER,
    logo: 'ModelArk',
    defaultBaseUrl: MODELARK_REMOTE_SUB_AGENT_DEFAULT_BASE_URL,
    requiresEnvironment: true,
    usesPollInterval: false,
    docsUrl: 'https://docs.byteplus.com/en/docs/modelark/quick-start-code',
  },
];

export function remoteSubAgentProviderDefinition(
  provider: RemoteSubAgentProviderName
): RemoteSubAgentProviderDefinition {
  return (
    REMOTE_SUB_AGENT_PROVIDERS.find((item) => item.id === provider) ??
    REMOTE_SUB_AGENT_PROVIDERS[0]
  );
}

export function isRemoteSubAgentProviderName(
  value: unknown
): value is RemoteSubAgentProviderName {
  return REMOTE_SUB_AGENT_PROVIDERS.some((item) => item.id === value);
}

export type GeminiRemoteSubAgentSettings = {
  api_key: string;
  base_url: string;
  agent_name?: string;
  max_wall_time_seconds?: number;
  poll_interval_seconds?: number;
};

export type ModelArkRemoteSubAgentSettings = {
  api_key: string;
  base_url: string;
  agent_name: string;
  environment_id: string;
  max_wall_time_seconds?: number;
};

export type RemoteSubAgentSettings =
  | {
      enabled: boolean;
      provider: typeof GEMINI_REMOTE_SUB_AGENT_PROVIDER;
      gemini_agents: GeminiRemoteSubAgentSettings;
    }
  | {
      enabled: boolean;
      provider: typeof MODELARK_REMOTE_SUB_AGENT_PROVIDER;
      modelark_agents: ModelArkRemoteSubAgentSettings;
    };

export type RemoteSubAgentFormState = {
  provider_id?: number;
  enabled: boolean;
  provider: RemoteSubAgentProviderName;
  apiKey: string;
  baseUrl: string;
  agentName: string;
  environmentId: string;
  maxWallTimeSeconds: string;
  pollIntervalSeconds: string;
};

export const createDefaultRemoteSubAgentForm = (
  provider: RemoteSubAgentProviderName = GEMINI_REMOTE_SUB_AGENT_PROVIDER
): RemoteSubAgentFormState => ({
  enabled: false,
  provider,
  apiKey: '',
  baseUrl: remoteSubAgentProviderDefinition(provider).defaultBaseUrl,
  agentName: REMOTE_SUB_AGENT_DEFAULT_AGENT,
  environmentId: '',
  maxWallTimeSeconds: REMOTE_SUB_AGENT_DEFAULT_MAX_WALL_TIME_SECONDS,
  pollIntervalSeconds: REMOTE_SUB_AGENT_DEFAULT_POLL_INTERVAL_SECONDS,
});

export function normalizeRemoteSubAgentProvider(
  provider: any,
  fallbackProvider: RemoteSubAgentProviderName = GEMINI_REMOTE_SUB_AGENT_PROVIDER
): RemoteSubAgentFormState {
  const providerName = isRemoteSubAgentProviderName(provider?.provider_name)
    ? provider.provider_name
    : fallbackProvider;
  if (!provider) {
    return createDefaultRemoteSubAgentForm(providerName);
  }

  const config = provider.config || provider.encrypted_config || {};
  return {
    provider_id: provider.id,
    enabled: Boolean(provider.enabled ?? config.enabled),
    provider: providerName,
    apiKey: provider.api_key || '',
    baseUrl:
      provider.endpoint_url ||
      config.base_url ||
      remoteSubAgentProviderDefinition(providerName).defaultBaseUrl,
    agentName:
      provider.agent_name ||
      config.agent_name ||
      provider.model_type ||
      REMOTE_SUB_AGENT_DEFAULT_AGENT,
    environmentId: String(config.environment_id || ''),
    maxWallTimeSeconds: String(
      config.max_wall_time_seconds ||
        REMOTE_SUB_AGENT_DEFAULT_MAX_WALL_TIME_SECONDS
    ),
    pollIntervalSeconds: String(
      config.poll_interval_seconds ||
        REMOTE_SUB_AGENT_DEFAULT_POLL_INTERVAL_SECONDS
    ),
  } satisfies RemoteSubAgentFormState;
}

/** Saved provider records grouped by provider, newest record first. */
export function normalizeRemoteSubAgentProviders(
  providers: any[]
): Record<RemoteSubAgentProviderName, RemoteSubAgentFormState> {
  return Object.fromEntries(
    REMOTE_SUB_AGENT_PROVIDERS.map(({ id }) => [
      id,
      normalizeRemoteSubAgentProvider(
        providers.find((provider) => provider?.provider_name === id),
        id
      ),
    ])
  ) as Record<RemoteSubAgentProviderName, RemoteSubAgentFormState>;
}

/** The provider fields a hand-off needs, whether or not it is switched on. */
export function hasRemoteSubAgentSettings(
  form: RemoteSubAgentFormState
): boolean {
  const definition = remoteSubAgentProviderDefinition(form.provider);
  return Boolean(
    form.apiKey.trim() &&
    form.baseUrl.trim() &&
    form.agentName.trim() &&
    (!definition.requiresEnvironment || form.environmentId.trim())
  );
}

export function isRemoteSubAgentConfigured(
  form: RemoteSubAgentFormState
): boolean {
  return Boolean(form.enabled && hasRemoteSubAgentSettings(form));
}

function positiveNumber(value: string, fallback: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Number(fallback);
}

export function toRemoteSubAgentProviderPayload(form: RemoteSubAgentFormState) {
  const definition = remoteSubAgentProviderDefinition(form.provider);
  const config: Record<string, number | string> = {
    max_wall_time_seconds: positiveNumber(
      form.maxWallTimeSeconds,
      REMOTE_SUB_AGENT_DEFAULT_MAX_WALL_TIME_SECONDS
    ),
  };
  if (definition.usesPollInterval) {
    config.poll_interval_seconds = positiveNumber(
      form.pollIntervalSeconds,
      REMOTE_SUB_AGENT_DEFAULT_POLL_INTERVAL_SECONDS
    );
  }
  if (definition.requiresEnvironment) {
    config.environment_id = form.environmentId.trim();
  }

  return {
    provider_name: form.provider,
    enabled: form.enabled,
    api_key: form.apiKey.trim(),
    endpoint_url: form.baseUrl.trim() || definition.defaultBaseUrl,
    agent_name: form.agentName.trim(),
    model_name: '',
    config,
  };
}

export function toRemoteSubAgentRuntimeConfig(
  form: RemoteSubAgentFormState
): RemoteSubAgentSettings | null {
  if (!isRemoteSubAgentConfigured(form)) {
    return null;
  }

  const payload = toRemoteSubAgentProviderPayload(form);
  if (form.provider === MODELARK_REMOTE_SUB_AGENT_PROVIDER) {
    return {
      enabled: true,
      provider: MODELARK_REMOTE_SUB_AGENT_PROVIDER,
      modelark_agents: {
        api_key: payload.api_key,
        base_url: payload.endpoint_url,
        agent_name: payload.agent_name,
        environment_id: String(payload.config.environment_id),
        max_wall_time_seconds: Number(payload.config.max_wall_time_seconds),
      },
    };
  }

  return {
    enabled: true,
    provider: GEMINI_REMOTE_SUB_AGENT_PROVIDER,
    gemini_agents: {
      api_key: payload.api_key,
      base_url: payload.endpoint_url,
      agent_name: payload.agent_name,
      max_wall_time_seconds: Number(payload.config.max_wall_time_seconds),
      poll_interval_seconds: Number(payload.config.poll_interval_seconds),
    },
  };
}

/**
 * Runtime settings for the provider that is switched on. Only one provider
 * is enabled at a time; the server turns the others off when one is enabled.
 */
export function enabledRemoteSubAgentRuntimeConfig(
  providers: any[]
): RemoteSubAgentSettings | null {
  for (const provider of providers) {
    if (!provider?.enabled) continue;
    if (!isRemoteSubAgentProviderName(provider.provider_name)) continue;
    const config = toRemoteSubAgentRuntimeConfig(
      normalizeRemoteSubAgentProvider(provider)
    );
    if (config) return config;
  }
  return null;
}
