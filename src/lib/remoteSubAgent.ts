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

export const REMOTE_SUB_AGENT_PROVIDER = 'gemini_agents';
export const REMOTE_SUB_AGENT_PROVIDER_ID = REMOTE_SUB_AGENT_PROVIDER;
export const REMOTE_SUB_AGENT_DEFAULT_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta';
export const REMOTE_SUB_AGENT_DEFAULT_AGENT = '';
export const REMOTE_SUB_AGENT_DEFAULT_MAX_WALL_TIME_SECONDS = '900';
export const REMOTE_SUB_AGENT_DEFAULT_POLL_INTERVAL_SECONDS = '5';

export type GeminiRemoteSubAgentSettings = {
  api_key: string;
  base_url: string;
  agent_name?: string;
  max_wall_time_seconds?: number;
  poll_interval_seconds?: number;
};

export type RemoteSubAgentSettings = {
  enabled: boolean;
  provider: typeof REMOTE_SUB_AGENT_PROVIDER;
  gemini_agents: GeminiRemoteSubAgentSettings;
};

export type RemoteSubAgentFormState = {
  provider_id?: number;
  enabled: boolean;
  provider: typeof REMOTE_SUB_AGENT_PROVIDER;
  apiKey: string;
  baseUrl: string;
  agentName: string;
  maxWallTimeSeconds: string;
  pollIntervalSeconds: string;
};

export const createDefaultRemoteSubAgentForm = (): RemoteSubAgentFormState => ({
  enabled: false,
  provider: REMOTE_SUB_AGENT_PROVIDER,
  apiKey: '',
  baseUrl: REMOTE_SUB_AGENT_DEFAULT_BASE_URL,
  agentName: REMOTE_SUB_AGENT_DEFAULT_AGENT,
  maxWallTimeSeconds: REMOTE_SUB_AGENT_DEFAULT_MAX_WALL_TIME_SECONDS,
  pollIntervalSeconds: REMOTE_SUB_AGENT_DEFAULT_POLL_INTERVAL_SECONDS,
});

export function normalizeRemoteSubAgentProvider(provider: any) {
  if (!provider) {
    return createDefaultRemoteSubAgentForm();
  }

  const config = provider.config || provider.encrypted_config || {};
  return {
    provider_id: provider.id,
    enabled: Boolean(provider.enabled ?? config.enabled),
    provider: REMOTE_SUB_AGENT_PROVIDER,
    apiKey: provider.api_key || '',
    baseUrl:
      provider.endpoint_url ||
      config.base_url ||
      REMOTE_SUB_AGENT_DEFAULT_BASE_URL,
    agentName:
      provider.agent_name ||
      config.agent_name ||
      provider.model_type ||
      REMOTE_SUB_AGENT_DEFAULT_AGENT,
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

export function isRemoteSubAgentConfigured(
  form: RemoteSubAgentFormState
): boolean {
  return Boolean(
    form.enabled &&
    form.apiKey.trim() &&
    form.baseUrl.trim() &&
    form.agentName.trim()
  );
}

export function toRemoteSubAgentProviderPayload(form: RemoteSubAgentFormState) {
  const agentName = form.agentName.trim();
  const maxWallTimeSeconds = Number(form.maxWallTimeSeconds);
  const pollIntervalSeconds = Number(form.pollIntervalSeconds);
  const fallbackMaxWallTimeSeconds = Number(
    REMOTE_SUB_AGENT_DEFAULT_MAX_WALL_TIME_SECONDS
  );
  const fallbackPollIntervalSeconds = Number(
    REMOTE_SUB_AGENT_DEFAULT_POLL_INTERVAL_SECONDS
  );

  return {
    provider_name: REMOTE_SUB_AGENT_PROVIDER_ID,
    enabled: form.enabled,
    api_key: form.apiKey.trim(),
    endpoint_url: form.baseUrl.trim() || REMOTE_SUB_AGENT_DEFAULT_BASE_URL,
    agent_name: agentName,
    model_name: '',
    config: {
      max_wall_time_seconds:
        Number.isFinite(maxWallTimeSeconds) && maxWallTimeSeconds > 0
          ? maxWallTimeSeconds
          : fallbackMaxWallTimeSeconds,
      poll_interval_seconds:
        Number.isFinite(pollIntervalSeconds) && pollIntervalSeconds > 0
          ? pollIntervalSeconds
          : fallbackPollIntervalSeconds,
    },
  };
}

export function toRemoteSubAgentRuntimeConfig(
  form: RemoteSubAgentFormState
): RemoteSubAgentSettings | null {
  if (!isRemoteSubAgentConfigured(form)) {
    return null;
  }

  const payload = toRemoteSubAgentProviderPayload(form);
  return {
    enabled: true,
    provider: REMOTE_SUB_AGENT_PROVIDER,
    gemini_agents: {
      api_key: payload.api_key,
      base_url: payload.endpoint_url,
      agent_name: payload.agent_name,
      max_wall_time_seconds: payload.config.max_wall_time_seconds,
      poll_interval_seconds: payload.config.poll_interval_seconds,
    },
  };
}
