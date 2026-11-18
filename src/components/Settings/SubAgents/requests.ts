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

import { fetchPost, proxyFetchPost, proxyFetchPut } from '@/api/http';
import {
  remoteSubAgentProviderDefinition,
  toRemoteSubAgentProviderPayload,
  type RemoteSubAgentFormState,
} from '@/lib/remoteSubAgent';

export const REMOTE_SUB_AGENT_PROVIDERS_PATH =
  '/api/v1/remote-sub-agent-providers';

/** Check the settings with the provider before they are saved as enabled. */
export async function checkRemoteSubAgentConnection(
  form: RemoteSubAgentFormState,
  fallbackMessage: string
) {
  const body: Record<string, string> = {
    provider: form.provider,
    api_key: form.apiKey.trim(),
    base_url: form.baseUrl.trim(),
    agent_name: form.agentName.trim(),
  };
  if (remoteSubAgentProviderDefinition(form.provider).requiresEnvironment) {
    body.environment_id = form.environmentId.trim();
  }
  const res = await fetchPost('/remote-sub-agent/validate', body);
  if (!res?.is_valid) {
    throw new Error(res?.message || fallbackMessage);
  }
}

export async function saveRemoteSubAgentForm(form: RemoteSubAgentFormState) {
  const data = toRemoteSubAgentProviderPayload(form);
  if (form.provider_id) {
    await proxyFetchPut(
      `${REMOTE_SUB_AGENT_PROVIDERS_PATH}/${form.provider_id}`,
      data
    );
  } else {
    await proxyFetchPost(REMOTE_SUB_AGENT_PROVIDERS_PATH, data);
  }
}

export function remoteSubAgentErrorMessage(error: any, fallback: string) {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail?.message) return detail.message;
  if (error?.response?.data?.message) return error.response.data.message;
  if (error?.message) return error.message;
  return fallback;
}
