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

import { type CloudModel, useCloudModelStore } from '@/store/cloudModelStore';
import { beforeEach, describe, expect, it } from 'vitest';

const cloud = (id: string, display_name: string): CloudModel => ({
  id,
  display_name,
  model_type: id,
  model_platform: 'openai-compatible-model',
  provider_family: 'google',
  kind: 'chat',
  sort_order: 1,
});

describe('Eigent Cloud model names', () => {
  beforeEach(() => {
    useCloudModelStore.setState({
      models: [
        cloud('openai/gemini-4-carbon', 'openai/gemini-4-carbon'),
        cloud('gpt-5.5', 'GPT-5.5'),
        cloud('openai/gemini-3.8-flash', ''),
      ],
      retired: [],
      defaultModelId: 'gpt-5.5',
    });
  });

  it('shows the model name when the catalog name carries a provider prefix', () => {
    expect(
      useCloudModelStore
        .getState()
        .getModelDisplayName('openai/gemini-4-carbon')
    ).toBe('gemini-4-carbon');
  });

  it('keeps a catalog display name that has no prefix', () => {
    expect(useCloudModelStore.getState().getModelDisplayName('gpt-5.5')).toBe(
      'GPT-5.5'
    );
  });

  it('names a model without a display name from its id, without the prefix', () => {
    expect(
      useCloudModelStore
        .getState()
        .getModelDisplayName('openai/gemini-3.8-flash')
    ).toBe('Gemini 3.8 Flash');
  });
});
