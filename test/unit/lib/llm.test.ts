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

import { INIT_PROVODERS } from '@/lib/llm';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// INIT_PROVODERS (note: typo matches source export name)
// ---------------------------------------------------------------------------
describe('INIT_PROVODERS', () => {
  const EXPECTED_IDS = [
    'gemini',
    'openai',
    'anthropic',
    'openrouter',
    'tongyi-qianwen',
    'deepseek',
    'minimax',
    'z.ai',
    'moonshot',
    'grok',
    'mistral',
    'aws-bedrock',
    'azure',
    'ernie',
    'openai-compatible-model',
  ];

  it('has 18 providers', () => {
    expect(INIT_PROVODERS).toHaveLength(18);
  });

  it('every provider has required base fields', () => {
    for (const p of INIT_PROVODERS) {
      expect(p).toHaveProperty('id');
      expect(p).toHaveProperty('name');
      expect(p).toHaveProperty('apiKey');
      expect(p).toHaveProperty('apiHost');
      expect(p).toHaveProperty('description');
      expect(p).toHaveProperty('is_valid');
      expect(p).toHaveProperty('model_type');

      expect(typeof p.id).toBe('string');
      expect(typeof p.name).toBe('string');
      expect(p.apiKey).toBe('');
      expect(typeof p.apiHost).toBe('string');
      expect(typeof p.description).toBe('string');
      expect(p.is_valid).toBe(false);
      expect(p.model_type).toBe('');
    }
  });

  it('contains all expected provider ids', () => {
    const ids = INIT_PROVODERS.map((p) => p.id);
    for (const expectedId of EXPECTED_IDS) {
      expect(ids).toContain(expectedId);
    }
  });

  // --- Specific provider checks -------------------------------------------

  it('gemini has correct apiHost', () => {
    const gemini = INIT_PROVODERS.find((p) => p.id === 'gemini');
    expect(gemini).toBeDefined();
    expect(gemini!.apiHost).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/'
    );
  });

  it('openai has correct apiHost', () => {
    const openai = INIT_PROVODERS.find((p) => p.id === 'openai');
    expect(openai).toBeDefined();
    expect(openai!.apiHost).toBe('https://api.openai.com/v1');
  });

  it('anthropic has correct apiHost', () => {
    const anthropic = INIT_PROVODERS.find((p) => p.id === 'anthropic');
    expect(anthropic).toBeDefined();
    expect(anthropic!.apiHost).toBe('https://api.anthropic.com');
  });

  it('aws-bedrock-converse has externalConfig with required keys', () => {
    const awsConverse = INIT_PROVODERS.find(
      (p) => p.id === 'aws-bedrock-converse'
    );
    expect(awsConverse).toBeDefined();
    expect(awsConverse!.externalConfig).toBeDefined();

    const configKeys = awsConverse!.externalConfig!.map((c) => c.key);
    expect(configKeys).toContain('region_name');
    expect(configKeys).toContain('aws_access_key_id');
    expect(configKeys).toContain('aws_secret_access_key');
    expect(configKeys).toContain('aws_session_token');
  });

  it('azure has externalConfig with api_version and azure_deployment_name', () => {
    const azure = INIT_PROVODERS.find((p) => p.id === 'azure');
    expect(azure).toBeDefined();
    expect(azure!.externalConfig).toBeDefined();

    const configKeys = azure!.externalConfig!.map((c) => c.key);
    expect(configKeys).toContain('api_version');
    expect(configKeys).toContain('azure_deployment_name');
  });

  it('openai-compatible-model has hostPlaceHolder', () => {
    const oaiCompat = INIT_PROVODERS.find(
      (p) => p.id === 'openai-compatible-model'
    );
    expect(oaiCompat).toBeDefined();
    expect(oaiCompat!.hostPlaceHolder).toBeDefined();
    expect(typeof oaiCompat!.hostPlaceHolder).toBe('string');
    expect(oaiCompat!.hostPlaceHolder!.length).toBeGreaterThan(0);
  });

  it('azure also has hostPlaceHolder', () => {
    const azure = INIT_PROVODERS.find((p) => p.id === 'azure');
    expect(azure).toBeDefined();
    expect(azure!.hostPlaceHolder).toBeDefined();
    expect(typeof azure!.hostPlaceHolder).toBe('string');
  });

  it('deepseek has correct apiHost', () => {
    const deepseek = INIT_PROVODERS.find((p) => p.id === 'deepseek');
    expect(deepseek).toBeDefined();
    expect(deepseek!.apiHost).toBe('https://api.deepseek.com');
  });

  it('grok has correct apiHost', () => {
    const grok = INIT_PROVODERS.find((p) => p.id === 'grok');
    expect(grok).toBeDefined();
    expect(grok!.apiHost).toBe('https://api.x.ai/v1');
  });

  it('mistral has correct apiHost', () => {
    const mistral = INIT_PROVODERS.find((p) => p.id === 'mistral');
    expect(mistral).toBeDefined();
    expect(mistral!.apiHost).toBe('https://api.mistral.ai');
  });

  it('ernie has correct apiHost', () => {
    const ernie = INIT_PROVODERS.find((p) => p.id === 'ernie');
    expect(ernie).toBeDefined();
    expect(ernie!.apiHost).toBe('https://qianfan.baidubce.com/v2');
  });
});
