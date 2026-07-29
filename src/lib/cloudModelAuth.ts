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

import { proxyFetchGet } from '@/api/http';

export type CloudModelAuth = {
  apiKey: string;
  apiUrl: string;
  mode: 'eigent_token' | 'legacy_key';
  warningCode?: string;
  warningText?: string;
};

const responseStatus = (error: any): number | undefined => {
  const value = error?.status ?? error?.response?.status;
  return typeof value === 'number' ? value : undefined;
};

/**
 * New servers return only the public proxy URL and instruct Desktop to use
 * its existing Eigent access token. A 404 means the server predates this
 * capability, so older deployments retain the legacy key-fetch flow.
 *
 * Other failures never fall back: an authorization outage must not cause a
 * new server to expose the LiteLLM virtual key.
 */
export async function resolveCloudModelAuth(
  eigentToken: string
): Promise<CloudModelAuth> {
  if (!eigentToken) {
    throw new Error('Eigent authentication is required for cloud models.');
  }

  try {
    const config = await proxyFetchGet('/api/v1/cloud-auth-config');
    if (
      config?.auth_mode !== 'eigent_token' ||
      typeof config?.api_url !== 'string' ||
      !config.api_url
    ) {
      throw new Error('Cloud model authentication configuration is invalid.');
    }
    return {
      apiKey: eigentToken,
      apiUrl: config.api_url,
      mode: 'eigent_token',
      warningCode: config.warning_code,
      warningText: config.warning_text,
    };
  } catch (error: any) {
    if (responseStatus(error) !== 404) {
      throw error;
    }
  }

  const legacy = await proxyFetchGet('/api/v1/user/key');
  if (
    typeof legacy?.value !== 'string' ||
    !legacy.value ||
    typeof legacy?.api_url !== 'string' ||
    !legacy.api_url
  ) {
    const error = new Error(
      legacy?.text ||
        'Failed to get cloud model credentials. Please check your account or model settings.'
    );
    Object.assign(error, { response: { data: legacy } });
    throw error;
  }
  return {
    apiKey: legacy.value,
    apiUrl: legacy.api_url,
    mode: 'legacy_key',
    warningCode: legacy.warning_code,
    warningText: legacy.warning_text,
  };
}
