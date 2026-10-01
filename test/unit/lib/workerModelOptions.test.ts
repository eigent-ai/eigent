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

describe('worker model configuration identity', () => {
  it('keeps credentials with the exact saved record when names repeat', () => {
    const first = workerModelOption(
      {
        id: 11,
        provider_name: 'openai',
        model_type: 'gpt-5',
        api_key: 'first',
        endpoint_url: '',
      },
      'OpenAI'
    );
    const second = workerModelOption(
      {
        id: 12,
        provider_name: 'openai',
        model_type: 'gpt-5',
        api_key: 'second',
        endpoint_url: '',
      },
      'OpenAI'
    );
    expect(first.value).toBe('provider:11');
    expect(second.value).toBe('provider:12');
    expect(first.label).not.toBe(second.label);
    expect(first.api_key).toBe('first');
    expect(second.api_key).toBe('second');
  });
});
