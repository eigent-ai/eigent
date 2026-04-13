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

/** Models available on Eigent Cloud (matches Agents → Models cloud tab). */
export const EIGENT_CLOUD_MODEL_OPTIONS = [
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview' },
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview' },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
  { id: 'gpt-4.1', name: 'GPT-4.1' },
  { id: 'gpt-5', name: 'GPT-5' },
  { id: 'gpt-5.1', name: 'GPT-5.1' },
  { id: 'gpt-5.2', name: 'GPT-5.2' },
  { id: 'gpt-5.4', name: 'GPT-5.4' },
  { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
  { id: 'minimax_m2_5', name: 'Minimax M2.5' },
] as const;

export type EigentCloudModelId =
  (typeof EIGENT_CLOUD_MODEL_OPTIONS)[number]['id'];
