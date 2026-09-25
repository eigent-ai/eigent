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

import { fetchGet, proxyFetchGet } from '@/api/http';
import { LOCAL_MODEL_OPTIONS } from '@/components/Settings/Models/localModels';
import {
  buildAgentModelConfigFromProvider,
  type StoredModelProvider,
} from '@/lib/modelConfig';
import { getProviderValid } from '@/lib/providerStatus';
import { parseSpaceModelReference } from '@/lib/spaceModelReference';
import type {
  ThinkingEffort,
  WorkspaceConfigurationIdentity,
} from '@/service/workspaceConfigurationApi';
import {
  normalizeModel,
  resolveCloudModelFromCatalog,
  type ResolvedCloudModel,
} from '@/store/cloudModelStore';
import type { ProjectModelSelection } from '@/store/projectStore';
import i18next from 'i18next';

export interface SpaceModelSelection {
  materialization_id: string;
  revision_id: string;
  model_profile: string;
  model_ref: string;
  thinking_effort: ThinkingEffort;
}

export async function recoverSpaceSessionModel(
  spaceId: string,
  projectId: string,
  identity: WorkspaceConfigurationIdentity,
  assertCurrent: () => void
): Promise<ProjectModelSelection | null> {
  assertCurrent();
  const result = await fetchGet(
    `/spaces/${encodeURIComponent(spaceId)}/workspace-configuration/session-model`,
    {
      project_id: projectId,
      email: identity.email,
      ...(identity.userId == null ? {} : { user_id: identity.userId }),
    }
  );
  assertCurrent();
  if (
    result?.space_id !== spaceId ||
    result?.project_id !== projectId ||
    !('accepted' in result)
  )
    throw spaceModelError('unavailable');
  if (result.accepted?.selection) return result.accepted.selection;
  if (result.restore_pending) throw spaceModelError('unconfirmed');
  return null;
}

export function spaceModelError(
  reason: 'unavailable' | 'ambiguous' | 'changed' | 'unconfirmed'
): Error {
  return new Error(i18next.t(`chat.space-model-${reason}`));
}

export async function fetchSpaceModelSelection(
  spaceId: string,
  identity: WorkspaceConfigurationIdentity,
  assertCurrent: () => void
): Promise<SpaceModelSelection | null> {
  assertCurrent();
  const result = await fetchGet(
    `/spaces/${encodeURIComponent(spaceId)}/workspace-configuration/model-selection`,
    {
      email: identity.email,
      ...(identity.userId == null ? {} : { user_id: identity.userId }),
    }
  );
  assertCurrent();
  if (result?.space_id !== spaceId || !('selection' in result))
    throw spaceModelError('unavailable');
  return result.selection;
}

type RuntimeProvider = StoredModelProvider & {
  id: number;
  is_valid?: unknown;
  is_vaild?: unknown;
};

export async function fetchRuntimeModelProviders(
  assertCurrent: () => void
): Promise<RuntimeProvider[]> {
  const providers = new Map<number, RuntimeProvider>();
  for (let page = 1; page <= 6; page++) {
    assertCurrent();
    const response = await proxyFetchGet('/api/v1/providers', {
      page,
      size: 100,
    });
    assertCurrent();
    const items = Array.isArray(response) ? response : response?.items;
    if (!Array.isArray(items)) throw spaceModelError('unavailable');
    for (const provider of items) {
      if (Number.isInteger(provider.id)) providers.set(provider.id, provider);
    }
    if (providers.size > 512) throw spaceModelError('unavailable');
    if (
      Array.isArray(response) ||
      (typeof response.pages === 'number'
        ? page >= response.pages
        : items.length < 100)
    )
      return [...providers.values()];
  }
  throw spaceModelError('unavailable');
}

export interface ResolvedSpaceModel {
  selection: ProjectModelSelection;
  provider?: RuntimeProvider;
  cloudModel?: ResolvedCloudModel;
}

/** Launch-only adapter. Credentials stay transient, never enter the logical reference. */
export async function resolveSpaceModelBinding(
  ref: string,
  assertCurrent: () => void
): Promise<ResolvedSpaceModel> {
  const identity = parseSpaceModelReference(ref);
  if (!identity) throw spaceModelError('unavailable');
  assertCurrent();
  if (identity.category === 'cloud') {
    const response = await proxyFetchGet('/api/v1/cloud-models', {
      kind: 'chat',
    });
    assertCurrent();
    const rawModels: unknown[] = Array.isArray(response?.models)
      ? response.models
      : [];
    const models = rawModels
      .map(normalizeModel)
      .filter(
        (model): model is NonNullable<ReturnType<typeof normalizeModel>> =>
          !!model && model.kind === 'chat'
      );
    const cloudModel = resolveCloudModelFromCatalog(
      {
        models,
        retired: response?.retired ?? [],
        defaultModelId: response?.default_model_id ?? '',
      },
      identity.modelId
    );
    // A portable explicit reference cannot silently become a replacement/default.
    if (!cloudModel || cloudModel.source !== 'selected')
      throw spaceModelError('unavailable');
    return {
      cloudModel,
      selection: {
        modelType: 'cloud',
        cloud_model_type: cloudModel.model.id,
        model_platform: cloudModel.model.model_platform,
        model_type: cloudModel.model.model_type,
        model_ref: ref,
      },
    };
  }
  const providers = await fetchRuntimeModelProviders(assertCurrent);
  const matches = providers.filter((provider) => {
    const category = LOCAL_MODEL_OPTIONS.some(
      (item) => item.id === provider.provider_name
    )
      ? 'local'
      : 'custom';
    const config = buildAgentModelConfigFromProvider(provider);
    return (
      category === identity.category &&
      config.model_platform === identity.platform &&
      config.model_type === identity.modelId
    );
  });
  if (matches.length > 1) throw spaceModelError('ambiguous');
  const provider = matches[0];
  if (!provider || !getProviderValid(provider))
    throw spaceModelError('unavailable');
  const config = buildAgentModelConfigFromProvider(provider);
  return {
    provider,
    selection: {
      modelType: identity.category,
      provider_id: provider.id,
      model_platform: config.model_platform,
      model_type: config.model_type,
      model_ref: ref,
    },
  };
}
