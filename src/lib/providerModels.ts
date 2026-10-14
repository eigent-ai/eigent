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

import { fetchPost } from '@/api/http';
import i18next from 'i18next';

/**
 * Fetch + parse helper for cloud providers that expose an OpenAI-compatible
 * `/v1/models` listing endpoint (e.g. OrcaRouter). Returns chat-capable
 * models grouped by their `<provider>/<model>` prefix so the UI can render
 * provider tabs.
 */

/** Single model entry as returned by an OpenAI-compatible /v1/models call. */
type RawModel = {
  id: string;
  architecture?: {
    input_modalities?: string[] | null;
    output_modalities?: string[] | null;
  };
  context_length?: number;
  max_completion_tokens?: number;
};

export type ProviderModelInfo = {
  id: string;
  contextLength?: number;
  maxCompletionTokens?: number;
};

export type ProviderModelGroup = {
  provider: string;
  models: ProviderModelInfo[];
};

export class ProviderModelsError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'ProviderModelsError';
  }
}

/**
 * Decide whether a model is chat-capable enough to surface in the dropdown.
 * Keeps models that explicitly emit text, plus models that omit the
 * architecture field entirely (some upstream listings — e.g. deepseek-reasoner
 * — leave it null even though they are usable for chat).
 *
 * Filters out: TTS / image-only / video-only outputs.
 */
function isChatCapable(model: RawModel): boolean {
  const arch = model.architecture;
  if (!arch) return true;
  const out = arch.output_modalities;
  if (out == null) return true;
  return out.includes('text');
}

/** Split `anthropic/claude-opus-4.6` into `["anthropic", "claude-opus-4.6"]`. */
function splitProviderPrefix(id: string): [string, string] {
  const idx = id.indexOf('/');
  if (idx <= 0) return ['', id];
  return [id.slice(0, idx), id.slice(idx + 1)];
}

/**
 * Ask the local backend to fetch the provider's model list, then return
 * chat-capable models grouped by provider prefix, sorted alphabetically by
 * provider, with models within each group sorted alphabetically by id. Keeping
 * the third-party request out of the renderer avoids provider CORS policies.
 *
 * Throws on network failure or non-2xx response with a user-readable message.
 */
export async function fetchProviderModels(
  apiHost: string,
  modelsEndpoint: string,
  apiKey: string,
  modelIdPrefix?: string
): Promise<ProviderModelGroup[]> {
  if (!apiKey) {
    throw new Error(
      i18next.t('setting.models-api-key-required', {
        defaultValue: 'API key is required to fetch the model list.',
      })
    );
  }
  let payload: { data?: RawModel[] };
  try {
    payload = await fetchPost('/model/list', {
      api_host: apiHost,
      models_endpoint: modelsEndpoint,
      api_key: apiKey,
    });
  } catch (error: unknown) {
    const status =
      typeof error === 'object' && error !== null && 'status' in error
        ? Number(error.status)
        : undefined;
    if (status === 401) {
      throw new ProviderModelsError(
        i18next.t('setting.models-api-key-invalid', {
          defaultValue:
            'Invalid API key. Check your API key and click Refresh again.',
        }),
        status
      );
    }
    if (status === 403) {
      throw new ProviderModelsError(
        i18next.t('setting.models-access-denied', {
          defaultValue:
            'Access denied. Check your API key permissions and account access, then click Refresh again.',
        }),
        status
      );
    }
    throw new ProviderModelsError(
      i18next.t('setting.models-connection-failed', {
        defaultValue:
          'Could not load models. Check your connection and API host, then click Refresh again.',
      }),
      status
    );
  }
  const data: RawModel[] = Array.isArray(payload?.data) ? payload.data : [];

  const grouped = new Map<string, ProviderModelInfo[]>();
  for (const model of data) {
    if (
      !model?.id ||
      !isChatCapable(model) ||
      (modelIdPrefix && !model.id.startsWith(modelIdPrefix))
    ) {
      continue;
    }
    const [provider] = splitProviderPrefix(model.id);
    const bucket = provider || 'other';
    const info: ProviderModelInfo = {
      id: model.id,
      contextLength: model.context_length,
      maxCompletionTokens: model.max_completion_tokens,
    };
    const arr = grouped.get(bucket);
    if (arr) arr.push(info);
    else grouped.set(bucket, [info]);
  }

  const groups: ProviderModelGroup[] = Array.from(grouped.entries())
    .map(([provider, models]) => ({
      provider,
      models: models.sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider));

  return groups;
}

/** localStorage cache helpers — keyed per provider id to keep entries small. */
const CACHE_KEY_PREFIX = 'eigent-provider-models-v1:';

export function loadCachedModels(
  providerId: string,
  modelIdPrefix?: string
): ProviderModelGroup[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + providerId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const groups = parsed as ProviderModelGroup[];
    if (!modelIdPrefix) return groups;
    return groups
      .map((group) => ({
        ...group,
        models: group.models.filter((model) =>
          model.id.startsWith(modelIdPrefix)
        ),
      }))
      .filter((group) => group.models.length > 0);
  } catch {
    return null;
  }
}

export function saveCachedModels(
  providerId: string,
  groups: ProviderModelGroup[]
): void {
  try {
    localStorage.setItem(CACHE_KEY_PREFIX + providerId, JSON.stringify(groups));
  } catch {
    // localStorage may be unavailable (quota / private mode); silently ignore.
  }
}

export function clearCachedModels(providerId: string): void {
  try {
    localStorage.removeItem(CACHE_KEY_PREFIX + providerId);
  } catch {
    // Storage may be unavailable; the in-memory model list is still reset.
  }
}
