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

import { workerModelOption } from '@/lib/workerModelOptions';
import { describe, expect, it } from 'vitest';
import { localModelRecord, modelCredential } from '../helpers/localModels';

describe('worker model configuration identity', () => {
  it('names the exact saved record when names repeat, without a key', () => {
    const records = [
      localModelRecord({
        id: 11,
        provider_name: 'openai',
        model_type: 'gpt-5',
        api_key: 'unit-test-first',
      }),
      localModelRecord({
        id: 12,
        provider_name: 'openai',
        model_type: 'gpt-5',
        api_key: 'unit-test-second',
      }),
    ];
    const [first, second] = records.map((record) =>
      workerModelOption(record, 'OpenAI', records)
    );
    expect(first.value).toBe('provider:11');
    expect(second.value).toBe('provider:12');
    expect(first.label).toBe('OpenAI (gpt-5) · #1');
    expect(second.label).toBe('OpenAI (gpt-5) · #2');
    // Each option names its own saved model; neither holds a key.
    expect(first.model_credential).toEqual(modelCredential(11));
    expect(second.model_credential).toEqual(modelCredential(12));
    expect(first.api_key).toBe('');
    expect(JSON.stringify([first, second])).not.toContain('unit-test-');
  });

  it('labels a unique configuration without a hint', () => {
    const record = localModelRecord({
      id: 11,
      provider_name: 'openai',
      model_type: 'gpt-5',
    });
    expect(workerModelOption(record, 'OpenAI', [record]).label).toBe(
      'OpenAI (gpt-5)'
    );
  });
});
