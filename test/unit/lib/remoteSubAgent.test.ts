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
  createDefaultRemoteSubAgentForm,
  enabledRemoteSubAgentRuntimeConfig,
  hasRemoteSubAgentSettings,
  MODELARK_REMOTE_SUB_AGENT_DEFAULT_BASE_URL,
  normalizeRemoteSubAgentProviders,
  toRemoteSubAgentProviderPayload,
  toRemoteSubAgentRuntimeConfig,
} from '@/lib/remoteSubAgent';
import { describe, expect, it } from 'vitest';

const geminiRecord = {
  id: 1,
  provider_name: 'gemini_agents',
  enabled: false,
  api_key: 'gemini-key',
  endpoint_url: 'https://generativelanguage.googleapis.com/v1beta',
  agent_name: 'gemini-agent',
  config: { max_wall_time_seconds: 600, poll_interval_seconds: 3 },
};

const modelarkRecord = {
  id: 2,
  provider_name: 'modelark_agents',
  enabled: true,
  api_key: 'ark-key',
  endpoint_url: 'https://ark.example.test/api/v3',
  agent_name: 'agent-1',
  config: { max_wall_time_seconds: 1200, environment_id: 'env-1' },
};

describe('remoteSubAgent', () => {
  it('keeps the Gemini provider payload unchanged', () => {
    const forms = normalizeRemoteSubAgentProviders([geminiRecord]);

    expect(toRemoteSubAgentProviderPayload(forms.gemini_agents)).toEqual({
      provider_name: 'gemini_agents',
      enabled: false,
      api_key: 'gemini-key',
      endpoint_url: 'https://generativelanguage.googleapis.com/v1beta',
      agent_name: 'gemini-agent',
      model_name: '',
      config: { max_wall_time_seconds: 600, poll_interval_seconds: 3 },
    });
  });

  it('saves the ModelArk environment ID and no poll interval', () => {
    const forms = normalizeRemoteSubAgentProviders([modelarkRecord]);

    expect(toRemoteSubAgentProviderPayload(forms.modelark_agents)).toEqual({
      provider_name: 'modelark_agents',
      enabled: true,
      api_key: 'ark-key',
      endpoint_url: 'https://ark.example.test/api/v3',
      agent_name: 'agent-1',
      model_name: '',
      config: { max_wall_time_seconds: 1200, environment_id: 'env-1' },
    });
  });

  it('groups saved records by provider and fills defaults for the rest', () => {
    const forms = normalizeRemoteSubAgentProviders([modelarkRecord]);

    expect(forms.modelark_agents.provider_id).toBe(2);
    expect(forms.gemini_agents.provider_id).toBeUndefined();
    expect(forms.gemini_agents.provider).toBe('gemini_agents');
    expect(createDefaultRemoteSubAgentForm('modelark_agents').baseUrl).toBe(
      MODELARK_REMOTE_SUB_AGENT_DEFAULT_BASE_URL
    );
  });

  it('requires an environment ID only for ModelArk', () => {
    const forms = normalizeRemoteSubAgentProviders([
      geminiRecord,
      modelarkRecord,
    ]);

    expect(hasRemoteSubAgentSettings(forms.gemini_agents)).toBe(true);
    expect(hasRemoteSubAgentSettings(forms.modelark_agents)).toBe(true);
    expect(
      hasRemoteSubAgentSettings({
        ...forms.modelark_agents,
        environmentId: ' ',
      })
    ).toBe(false);
  });

  it('builds runtime settings for each provider', () => {
    const forms = normalizeRemoteSubAgentProviders([
      { ...geminiRecord, enabled: true },
      modelarkRecord,
    ]);

    expect(toRemoteSubAgentRuntimeConfig(forms.gemini_agents)).toEqual({
      enabled: true,
      provider: 'gemini_agents',
      gemini_agents: {
        api_key: 'gemini-key',
        base_url: 'https://generativelanguage.googleapis.com/v1beta',
        agent_name: 'gemini-agent',
        max_wall_time_seconds: 600,
        poll_interval_seconds: 3,
      },
    });
    expect(toRemoteSubAgentRuntimeConfig(forms.modelark_agents)).toEqual({
      enabled: true,
      provider: 'modelark_agents',
      modelark_agents: {
        api_key: 'ark-key',
        base_url: 'https://ark.example.test/api/v3',
        agent_name: 'agent-1',
        environment_id: 'env-1',
        max_wall_time_seconds: 1200,
      },
    });
  });

  it('sends the enabled provider at task start, whichever it is', () => {
    expect(
      enabledRemoteSubAgentRuntimeConfig([geminiRecord, modelarkRecord])
        ?.provider
    ).toBe('modelark_agents');
    expect(
      enabledRemoteSubAgentRuntimeConfig([
        { ...modelarkRecord, provider_name: 'unknown_provider' },
        { ...geminiRecord, enabled: true },
      ])?.provider
    ).toBe('gemini_agents');
    expect(enabledRemoteSubAgentRuntimeConfig([geminiRecord])).toBeNull();
  });
});
