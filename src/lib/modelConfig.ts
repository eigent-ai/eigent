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

export const MODEL_CONFIG_DICT_KEY = 'model_config_dict' as const;

export type ModelConfigDict = Record<string, unknown>;

export type AgentModelConfig = {
  model_platform: string;
  model_type?: string;
  api_key?: string;
  api_url?: string;
  model_config_dict?: ModelConfigDict;
  extra_params?: Record<string, unknown>;
};

export type AgentModelConfigSource = {
  model_platform: string;
  model_type: string;
  api_key?: string;
  api_url?: string;
  model_config_dict?: ModelConfigDict;
  extra_params?: Record<string, unknown>;
};

export type StoredModelProvider = {
  provider_name?: unknown;
  model_type?: unknown;
  api_key?: unknown;
  endpoint_url?: unknown;
  api_url?: unknown;
  encrypted_config?: unknown;
};

export type ModelConfigJsonErrorCode = 'invalid_json' | 'not_object';

export class ModelConfigJsonError extends Error {
  readonly code: ModelConfigJsonErrorCode;

  constructor(code: ModelConfigJsonErrorCode, message: string) {
    super(message);
    this.name = 'ModelConfigJsonError';
    this.code = code;
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parse the BYOK model-parameters field. Blank input represents no overrides. */
export function parseModelConfigJson(input: string): ModelConfigDict {
  if (!input.trim()) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new ModelConfigJsonError(
      'invalid_json',
      'Model parameters must be valid JSON.'
    );
  }

  if (!isObjectRecord(parsed)) {
    throw new ModelConfigJsonError(
      'not_object',
      'Model parameters must be a JSON object.'
    );
  }

  return parsed;
}

/** Format persisted model parameters for the BYOK JSON editor. */
export function formatModelConfigJson(value: unknown): string {
  return JSON.stringify(isObjectRecord(value) ? value : {}, null, 2);
}

/**
 * Separate the reserved CAMEL model configuration from provider constructor
 * parameters stored in the provider's existing `encrypted_config` JSON field.
 */
export function splitProviderConfig(config: unknown): {
  modelConfigDict: ModelConfigDict;
  extraParams: Record<string, unknown>;
} {
  if (!isObjectRecord(config)) {
    return { modelConfigDict: {}, extraParams: {} };
  }

  const { [MODEL_CONFIG_DICT_KEY]: storedModelConfig, ...extraParams } = config;

  return {
    modelConfigDict: isObjectRecord(storedModelConfig)
      ? { ...storedModelConfig }
      : {},
    extraParams,
  };
}

/** Build the provider JSON while preventing extra parameters from shadowing the reserved key. */
export function buildProviderConfig(
  extraParams: Record<string, unknown>,
  modelConfigDict: ModelConfigDict
): Record<string, unknown> {
  const { extraParams: sanitizedExtraParams } =
    splitProviderConfig(extraParams);
  if (Object.keys(modelConfigDict).length === 0) {
    return sanitizedExtraParams;
  }

  return {
    ...sanitizedExtraParams,
    [MODEL_CONFIG_DICT_KEY]: { ...modelConfigDict },
  };
}

/** Build the per-agent payload while preserving explicit empty provider maps. */
export function buildAgentModelConfig(
  source: AgentModelConfigSource
): AgentModelConfig {
  const config: AgentModelConfig = {
    model_platform: source.model_platform,
    ...(source.model_type ? { model_type: source.model_type } : {}),
  };

  if (source.api_key !== undefined) config.api_key = source.api_key;
  if (source.api_url !== undefined) config.api_url = source.api_url;
  if (source.model_config_dict !== undefined) {
    config.model_config_dict = { ...source.model_config_dict };
  }
  if (source.extra_params !== undefined) {
    config.extra_params = { ...source.extra_params };
  }

  return config;
}

/** Resolve a stored custom/local provider into a transient per-agent config. */
export function buildAgentModelConfigFromProvider(
  provider: StoredModelProvider
): AgentModelConfig {
  const { modelConfigDict, extraParams } = splitProviderConfig(
    provider.encrypted_config
  );

  return buildAgentModelConfig({
    model_platform: String(
      extraParams.model_platform || provider.provider_name || ''
    ),
    model_type: String(extraParams.model_type || provider.model_type || ''),
    api_key: String(provider.api_key ?? ''),
    api_url: String(provider.endpoint_url || provider.api_url || ''),
    model_config_dict: modelConfigDict,
    extra_params: extraParams,
  });
}
