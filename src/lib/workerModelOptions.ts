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
  configurationHint,
  type ConfiguredProvider,
} from '@/lib/configuredModels';
import {
  type AgentModelConfigSource,
  buildAgentModelConfigFromProvider,
} from '@/lib/modelConfig';

export interface WorkerModelOption extends AgentModelConfigSource {
  value: string;
  label: string;
  provider_id?: number;
}

/** The saved record ID keeps same-name configurations and credentials distinct. */
export function workerModelOption(
  provider: ConfiguredProvider,
  platformLabel: string,
  records: ConfiguredProvider[]
): WorkerModelOption {
  const config = buildAgentModelConfigFromProvider(provider);
  const modelType = config.model_type || '';
  const hint = configurationHint(provider, records);
  return {
    value: `provider:${provider.id}`,
    label: `${platformLabel}${modelType ? ` (${modelType})` : ''}${hint ? ` · ${hint}` : ''}`,
    model_platform: config.model_platform,
    model_type: modelType,
    provider_id: provider.id,
    api_key: config.api_key,
    api_url: config.api_url,
    model_config_dict: config.model_config_dict,
    extra_params: config.extra_params,
  };
}
