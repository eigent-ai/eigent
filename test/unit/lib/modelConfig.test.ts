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

import {
  MODEL_CONFIG_DICT_KEY,
  ModelConfigJsonError,
  buildAgentModelConfig,
  buildAgentModelConfigFromProvider,
  buildProviderConfig,
  formatModelConfigJson,
  parseModelConfigJson,
  splitProviderConfig,
} from '@/lib/modelConfig';
import { describe, expect, it } from 'vitest';

describe('modelConfig', () => {
  describe('parseModelConfigJson', () => {
    it('treats blank input as an empty object', () => {
      expect(parseModelConfigJson('  \n ')).toEqual({});
    });

    it('parses a JSON object without changing nested values', () => {
      expect(
        parseModelConfigJson(
          '{"temperature":0.2,"response_format":{"type":"json_object"}}'
        )
      ).toEqual({
        temperature: 0.2,
        response_format: { type: 'json_object' },
      });
    });

    it('reports malformed JSON separately from a non-object root', () => {
      expect(() => parseModelConfigJson('{')).toThrowError(
        expect.objectContaining<ModelConfigJsonError>({
          code: 'invalid_json',
        })
      );

      for (const value of ['null', '[]', 'true', '1', '"text"']) {
        expect(() => parseModelConfigJson(value)).toThrowError(
          expect.objectContaining<ModelConfigJsonError>({
            code: 'not_object',
          })
        );
      }
    });
  });

  it('pretty-prints objects and safely defaults invalid persisted values', () => {
    expect(formatModelConfigJson({ temperature: 0.2 })).toBe(
      '{\n  "temperature": 0.2\n}'
    );
    expect(formatModelConfigJson(null)).toBe('{}');
    expect(formatModelConfigJson([])).toBe('{}');
  });

  it('splits the reserved model config from provider extra parameters', () => {
    expect(
      splitProviderConfig({
        api_version: '2025-01-01',
        [MODEL_CONFIG_DICT_KEY]: { temperature: 0.2 },
      })
    ).toEqual({
      modelConfigDict: { temperature: 0.2 },
      extraParams: { api_version: '2025-01-01' },
    });
    expect(splitProviderConfig(null)).toEqual({
      modelConfigDict: {},
      extraParams: {},
    });
  });

  it('builds a round-trippable provider config and omits empty overrides', () => {
    const config = buildProviderConfig(
      {
        region_name: 'us-east-1',
        [MODEL_CONFIG_DICT_KEY]: { ignored: true },
      },
      { max_tokens: 4096 }
    );

    expect(config).toEqual({
      region_name: 'us-east-1',
      [MODEL_CONFIG_DICT_KEY]: { max_tokens: 4096 },
    });
    expect(splitProviderConfig(config)).toEqual({
      modelConfigDict: { max_tokens: 4096 },
      extraParams: { region_name: 'us-east-1' },
    });
    expect(buildProviderConfig({ api_version: 'v1' }, {})).toEqual({
      api_version: 'v1',
    });
  });

  it('builds a provider-backed agent config with explicit empty maps', () => {
    expect(
      buildAgentModelConfig({
        model_platform: 'openai',
        model_type: 'gpt-4o',
        api_key: 'provider-key',
        api_url: 'https://api.openai.com/v1',
        model_config_dict: {},
        extra_params: {},
      })
    ).toEqual({
      model_platform: 'openai',
      model_type: 'gpt-4o',
      api_key: 'provider-key',
      api_url: 'https://api.openai.com/v1',
      model_config_dict: {},
      extra_params: {},
    });
  });

  it('keeps cloud agent config limited to its existing model selection', () => {
    expect(
      buildAgentModelConfig({
        model_platform: 'azure',
        model_type: 'gpt-5.5',
      })
    ).toEqual({
      model_platform: 'azure',
      model_type: 'gpt-5.5',
    });
  });

  it('builds transient agent config from a stored local provider', () => {
    expect(
      buildAgentModelConfigFromProvider({
        provider_name: 'ollama',
        model_type: 'fallback-model',
        api_key: 'not-required',
        endpoint_url: 'http://127.0.0.1:11434/v1',
        encrypted_config: {
          model_platform: 'openai-compatible-model',
          model_type: 'qwen3:8b',
          keep_alive: '10m',
          model_config_dict: { temperature: 0.1 },
        },
      })
    ).toEqual({
      model_platform: 'openai-compatible-model',
      model_type: 'qwen3:8b',
      api_key: 'not-required',
      api_url: 'http://127.0.0.1:11434/v1',
      model_config_dict: { temperature: 0.1 },
      extra_params: {
        model_platform: 'openai-compatible-model',
        model_type: 'qwen3:8b',
        keep_alive: '10m',
      },
    });
  });
});
