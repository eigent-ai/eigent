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

import { configuredModelName, modelDisplayName } from '@/lib/modelDisplayName';
import { describe, expect, it } from 'vitest';

describe('modelDisplayName', () => {
  it.each([
    ['openai/gemini-4-carbon', 'gemini-4-carbon'],
    ['anthropic/claude-sonnet-4.5', 'claude-sonnet-4.5'],
    ['accounts/fireworks/models/llama-v3', 'llama-v3'],
    ['gpt-5', 'gpt-5'],
    ['qwen3:8b', 'qwen3:8b'],
    ['  openai/gpt-5  ', 'gpt-5'],
  ])('shows %s as %s', (id, name) => {
    expect(modelDisplayName(id)).toBe(name);
  });

  it('keeps an id that has nothing after its last slash', () => {
    expect(modelDisplayName('openai/')).toBe('openai/');
  });

  it.each([null, undefined, ''])('shows %s as empty', (id) => {
    expect(modelDisplayName(id)).toBe('');
  });
});

describe('configuredModelName', () => {
  const record = (id: number, provider_name: string, model_type: string) => ({
    id,
    provider_name,
    model_type,
  });

  it('shows the model name of a saved gateway model', () => {
    const gemini = record(1, 'openrouter', 'google/gemini-4-carbon');
    expect(configuredModelName(gemini, [gemini])).toBe('gemini-4-carbon');
  });

  it('keeps full ids when two models of one provider would share a name', () => {
    const openai = record(1, 'openrouter', 'openai/gpt-5');
    const azure = record(2, 'openrouter', 'azure/gpt-5');
    const other = record(3, 'openai-compatible-model', 'openai/gpt-5');
    const records = [openai, azure, other];

    expect(configuredModelName(openai, records)).toBe('openai/gpt-5');
    expect(configuredModelName(azure, records)).toBe('azure/gpt-5');
    // Another provider's model is listed under its own heading.
    expect(configuredModelName(other, records)).toBe('gpt-5');
  });

  it('leaves repeated saves of the same model to the configuration hint', () => {
    const first = record(1, 'openrouter', 'openai/gpt-5');
    const second = record(2, 'openrouter', 'openai/gpt-5');
    expect(configuredModelName(first, [first, second])).toBe('gpt-5');
  });
});
