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

// --- Provider IDs ---

export const OLLAMA_PROVIDER_ID = 'ollama' as const;
export const VLLM_PROVIDER_ID = 'vllm' as const;
export const SGLANG_PROVIDER_ID = 'sglang' as const;
export const LMSTUDIO_PROVIDER_ID = 'lmstudio' as const;
export const LLAMA_CPP_PROVIDER_ID = 'llama.cpp' as const;

// --- Ollama endpoint auto-fix ---

// Toast strings shown when the Ollama endpoint input auto-appends "/v1".
// Triggered on blur when a user enters a bare Ollama URL (e.g. http://localhost:11434)
// that is missing the required /v1 suffix for the OpenAI-compatible API.
export const OLLAMA_ENDPOINT_AUTO_FIX_TITLE = 'Ollama endpoint updated';
export const OLLAMA_ENDPOINT_AUTO_FIX_DESC =
  'Added /v1 once. You can remove it if not needed.';

// --- Local model config ---

// Model fetch config per local provider.
// - fetchPath: the API path (relative to the base URL) to list available models.
// - parseModels: extracts model name strings from the JSON response.
// Ollama uses a proprietary /api/tags endpoint; LLaMA.cpp uses the OpenAI-compatible
// /v1/models endpoint. vLLM, SGLang, and LM Studio also expose /v1/models and can
// be added here to enable model listing for those providers.
export type LocalModelOption = {
  id: string;
  name: string;
  defaultEndpoint: string;
  fetchPath?: string;
  parseModels?: (data: any) => string[];
};

const parseOllamaModels = (data: any): string[] =>
  data.models?.map((m: any) => m.name) || [];

const parseOpenAICompatibleModels = (data: any): string[] =>
  data?.data
    ?.map((m: any) => m?.id)
    .filter((name: string | undefined) => !!name) || [];

export const LOCAL_MODEL_OPTIONS: LocalModelOption[] = [
  {
    id: OLLAMA_PROVIDER_ID,
    name: 'Ollama',
    defaultEndpoint: 'http://localhost:11434/v1',
    fetchPath: '/api/tags',
    parseModels: parseOllamaModels,
  },
  {
    id: VLLM_PROVIDER_ID,
    name: 'vLLM',
    defaultEndpoint: 'http://localhost:8000/v1',
  },
  {
    id: SGLANG_PROVIDER_ID,
    name: 'SGLang',
    defaultEndpoint: 'http://localhost:30000/v1',
  },
  {
    id: LMSTUDIO_PROVIDER_ID,
    name: 'LM Studio',
    defaultEndpoint: 'http://localhost:1234/v1',
  },
  {
    id: LLAMA_CPP_PROVIDER_ID,
    name: 'LLaMA.cpp',
    defaultEndpoint: 'http://localhost:8080/v1',
    // Uses the OpenAI-compatible /v1/models endpoint.
    // vLLM, SGLang, and LM Studio also support this same endpoint — to enable
    // model listing for them, add fetchPath and parseModels to their entries above.
    fetchPath: '/v1/models',
    parseModels: parseOpenAICompatibleModels,
  },
];

// Provider logos that use dark fills (black or currentColor) and need inversion in dark mode
export const DARK_FILL_MODELS = new Set([
  'openai',
  'anthropic',
  'moonshot',
  OLLAMA_PROVIDER_ID,
  'openrouter',
  LMSTUDIO_PROVIDER_ID,
  'z.ai',
  'openai-compatible-model',
]);

export const PROVIDER_AVATAR_URLS: Record<string, string> = {
  'samba-nova': 'https://github.com/sambanova.png',
  mistral: 'https://github.com/mistralai.png',
  grok: 'https://github.com/xai-org.png',
};

// --- Helper functions ---

// Strip trailing /v1 (and optional slash) to get the base server URL.
// e.g. "http://localhost:8080/v1" -> "http://localhost:8080"
export const toEndpointBaseUrl = (endpoint: string): string =>
  endpoint.replace(/\/v1\/?$/, '').replace(/\/$/, '');

// Look up the default endpoint URL for a local provider by its platform ID.
export const getDefaultLocalEndpoint = (platform: string): string =>
  LOCAL_MODEL_OPTIONS.find((model) => model.id === platform)?.defaultEndpoint ||
  '';

// Look up the display name for a local provider by its platform ID.
export const getLocalPlatformName = (platform: string): string =>
  LOCAL_MODEL_OPTIONS.find((m) => m.id === platform)?.name || platform;

// --- Ollama endpoint helpers ---

export const isOllamaEndpointMissingV1 = (endpoint: string): boolean => {
  const trimmed = endpoint.trim();
  if (!trimmed) return false;
  try {
    const normalizedPath = new URL(trimmed).pathname.replace(/\/+$/, '');
    return !normalizedPath.endsWith('/v1');
  } catch {
    return !trimmed.replace(/\/+$/, '').endsWith('/v1');
  }
};

export const canAutoFixOllamaEndpoint = (endpoint: string): boolean => {
  const trimmed = endpoint.trim();
  if (!trimmed || !isOllamaEndpointMissingV1(trimmed)) return false;
  try {
    // Auto-fix only when endpoint has no extra path, e.g. http://localhost:11434
    const normalizedPath = new URL(trimmed).pathname.replace(/\/+$/, '');
    return normalizedPath === '';
  } catch {
    const withoutQueryOrHash = trimmed.split(/[?#]/)[0] || '';
    const normalized = withoutQueryOrHash.replace(/\/+$/, '');
    return !normalized.includes('/');
  }
};

export const appendV1ToEndpoint = (endpoint: string): string => {
  const trimmed = endpoint.trim();
  if (!trimmed) return trimmed;
  try {
    const parsed = new URL(trimmed);
    const normalizedPath = parsed.pathname.replace(/\/+$/, '');
    parsed.pathname = `${normalizedPath}/v1`.replace(/\/{2,}/g, '/');
    return parsed.toString();
  } catch {
    return `${trimmed.replace(/\/+$/, '')}/v1`;
  }
};
