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
 * Hit `${apiHost}${modelsEndpoint}` with a Bearer token and return chat-capable
 * models grouped by provider prefix, sorted alphabetically by provider, with
 * models within each group sorted alphabetically by id.
 *
 * Throws on network failure or non-2xx response with a user-readable message.
 */
export async function fetchProviderModels(
  apiHost: string,
  modelsEndpoint: string,
  apiKey: string
): Promise<ProviderModelGroup[]> {
  if (!apiKey) {
    throw new Error('API key is required to fetch model list.');
  }
  const trimmedHost = apiHost.replace(/\/+$/, '');
  const url = `${trimmedHost}${modelsEndpoint}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch models: ${response.status} ${response.statusText}`
    );
  }
  const payload = await response.json();
  const data: RawModel[] = Array.isArray(payload?.data) ? payload.data : [];

  const grouped = new Map<string, ProviderModelInfo[]>();
  for (const model of data) {
    if (!model?.id || !isChatCapable(model)) continue;
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
  providerId: string
): ProviderModelGroup[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + providerId);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as ProviderModelGroup[];
  } catch {
    return null;
  }
}

export function saveCachedModels(
  providerId: string,
  groups: ProviderModelGroup[]
): void {
  try {
    localStorage.setItem(
      CACHE_KEY_PREFIX + providerId,
      JSON.stringify(groups)
    );
  } catch {
    // localStorage may be unavailable (quota / private mode); silently ignore.
  }
}
