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

import anthropicImage from '@/assets/model/anthropic.svg';
import azureImage from '@/assets/model/azure.svg';
import bedrockImage from '@/assets/model/bedrock.svg';
import deepseekImage from '@/assets/model/deepseek.svg';
import eigentImage from '@/assets/model/eigent.svg';
import ernieImage from '@/assets/model/ernie.png';
import geminiImage from '@/assets/model/gemini.svg';
import llamaCppImage from '@/assets/model/llamacpp.svg';
import lmstudioImage from '@/assets/model/lmstudio.svg';
import minimaxImage from '@/assets/model/minimax.svg';
import modelarkImage from '@/assets/model/modelark.svg';
import moonshotImage from '@/assets/model/moonshot.svg';
import ollamaImage from '@/assets/model/ollama.svg';
import openaiImage from '@/assets/model/openai.svg';
import openrouterImage from '@/assets/model/openrouter.svg';
import qwenImage from '@/assets/model/qwen.svg';
import sglangImage from '@/assets/model/sglang.svg';
import vllmImage from '@/assets/model/vllm.svg';
import zaiImage from '@/assets/model/zai.svg';
import {
  DARK_FILL_MODELS,
  LLAMA_CPP_PROVIDER_ID,
  PROVIDER_AVATAR_URLS,
} from '@/pages/Agents/localModels';

const MODEL_PROVIDER_IMAGE_MAP: Record<string, string> = {
  cloud: eigentImage,
  openai: openaiImage,
  anthropic: anthropicImage,
  gemini: geminiImage,
  openrouter: openrouterImage,
  'tongyi-qianwen': qwenImage,
  deepseek: deepseekImage,
  ernie: ernieImage,
  minimax: minimaxImage,
  'z.ai': zaiImage,
  moonshot: moonshotImage,
  ModelArk: modelarkImage,
  'samba-nova': PROVIDER_AVATAR_URLS['samba-nova'],
  grok: PROVIDER_AVATAR_URLS.grok,
  mistral: PROVIDER_AVATAR_URLS.mistral,
  'aws-bedrock': bedrockImage,
  azure: azureImage,
  'openai-compatible-model': openaiImage,
  ollama: ollamaImage,
  vllm: vllmImage,
  sglang: sglangImage,
  lmstudio: lmstudioImage,
  [LLAMA_CPP_PROVIDER_ID]: llamaCppImage,
  'local-ollama': ollamaImage,
  'local-vllm': vllmImage,
  'local-sglang': sglangImage,
  'local-lmstudio': lmstudioImage,
  'local-llama.cpp': llamaCppImage,
};

/** Resolve provider / tab id to a logo URL for dropdowns and sidebars. */
export function getModelImage(modelId: string | null): string | null {
  if (!modelId) return null;
  return MODEL_PROVIDER_IMAGE_MAP[modelId] ?? null;
}

/** Whether a logo should be inverted in dark mode (fill-style logos). */
export function needsInvertModelImage(
  modelId: string | null,
  appearance: string | undefined
): boolean {
  if (!modelId || appearance !== 'dark') return false;
  const key = modelId.startsWith('local-')
    ? modelId.replace('local-', '')
    : modelId;
  return DARK_FILL_MODELS.has(key);
}
