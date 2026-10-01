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
import { LOCAL_MODEL_OPTIONS } from '@/components/Settings/Models/localModels';
import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import { getProviderValid } from '@/lib/providerStatus';
import {
  parseSpaceModelReference,
  spaceModelReference,
} from '@/lib/spaceModelReference';
import type { SpaceModelCandidate } from '@/service/spaceSettingsDiscovery';
import { getAuthStore } from '@/store/authStore';
import i18next from 'i18next';

export interface SpaceModelDiscovery {
  items: SpaceModelCandidate[];
  unavailableSources: ('cloud_catalog' | 'provider_catalog')[];
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const textValue = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() && !/[\u0000-\u001f]/.test(value)
    ? value.trim()
    : null;

// Do not normalize identities differently from the launch-time resolver.
const exactText = (value: unknown): string | null =>
  textValue(value) === value ? (value as string) : null;

const identifier = (value: unknown): string | null => {
  const text = exactText(value);
  return text && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(text) ? text : null;
};

function configuredCandidate(raw: unknown): SpaceModelCandidate | null {
  const provider = record(raw);
  const category = provider.category;
  const platform = identifier(provider.model_platform);
  const modelId = exactText(provider.model_type);
  if ((category !== 'custom' && category !== 'local') || !platform || !modelId)
    return null;
  const value = spaceModelReference({ category, platform, modelId });
  if (!parseSpaceModelReference(value)) return null;
  const available = provider.available === true;
  return {
    value,
    label: `${platform} · ${modelId}`,
    source: category === 'local' ? 'local_catalog' : 'custom_catalog',
    availability: available ? 'available' : 'requires_setup',
    disabled: !available,
    ...(available ? {} : { reason: 'model_unavailable' }),
    modelId,
    modelType: modelId,
    platform,
    isDefault: false,
  };
}

/**
 * Older APIs expose the same account-scoped source used by Models settings and
 * resolveSpaceModelBinding through /providers. Keep only projected metadata from
 * each response; never return, cache or log the credential-bearing provider row.
 */
async function legacyProviderCandidates(
  assertCurrent: () => void
): Promise<SpaceModelCandidate[]> {
  const projected = new Map<number, SpaceModelCandidate | null>();
  for (let page = 1; page <= 6; page++) {
    assertCurrent();
    const response: unknown = await proxyFetchGet('/api/v1/providers', {
      page,
      size: 100,
    });
    assertCurrent();
    const envelope = record(response);
    const items = Array.isArray(response) ? response : envelope.items;
    if (!Array.isArray(items)) throw new Error('model_catalog_unavailable');
    for (const raw of items) {
      const provider = record(raw);
      if (!Number.isInteger(provider.id)) continue;
      const config = record(provider.encrypted_config);
      projected.set(
        provider.id as number,
        configuredCandidate({
          category: LOCAL_MODEL_OPTIONS.some(
            (option) => option.id === provider.provider_name
          )
            ? 'local'
            : 'custom',
          // Match buildAgentModelConfigFromProvider's override precedence.
          model_platform: String(
            config.model_platform || provider.provider_name || ''
          ),
          model_type: String(config.model_type || provider.model_type || ''),
          available: getProviderValid(provider),
        })
      );
    }
    if (projected.size > 512) throw new Error('model_catalog_unavailable');
    if (
      Array.isArray(response) ||
      (typeof envelope.pages === 'number'
        ? page >= envelope.pages
        : items.length < 100)
    )
      return [...projected.values()].filter(
        (candidate): candidate is SpaceModelCandidate => candidate !== null
      );
  }
  throw new Error('model_catalog_unavailable');
}

async function configuredCandidates(
  assertCurrent: () => void
): Promise<SpaceModelCandidate[]> {
  let response: unknown;
  try {
    assertCurrent();
    response = await proxyFetchGet('/api/v1/provider-models');
    assertCurrent();
  } catch (error) {
    assertCurrent();
    const failure = record(error);
    // Missing metadata capability is the only compatibility fallback. Do not
    // bypass permission errors or hide a failed service with a second endpoint.
    if ((failure.status ?? record(failure.response).status) !== 404)
      throw error;
    return legacyProviderCandidates(assertCurrent);
  }
  if (!Array.isArray(response)) throw new Error('model_catalog_unavailable');
  return response
    .map(configuredCandidate)
    .filter(
      (candidate): candidate is SpaceModelCandidate => candidate !== null
    );
}

async function cloudCandidates(
  assertCurrent: () => void
): Promise<SpaceModelCandidate[]> {
  // Local API deployments do not provide the managed Cloud catalog.
  if (import.meta.env.VITE_USE_LOCAL_PROXY === 'true') return [];
  assertCurrent();
  const response = record(
    await proxyFetchGet('/api/v1/cloud-models', { kind: 'chat' })
  );
  assertCurrent();
  if (!Array.isArray(response.models))
    throw new Error('model_catalog_unavailable');
  return response.models.flatMap((raw): SpaceModelCandidate[] => {
    const model = record(raw);
    const modelId = exactText(model.id);
    const modelType = exactText(model.model_type);
    const platform = identifier(model.model_platform);
    if (!modelId || !modelType || !platform || model.kind !== 'chat') return [];
    const value = spaceModelReference({ category: 'cloud', modelId });
    if (!parseSpaceModelReference(value)) return [];
    return [
      {
        value,
        label: textValue(model.display_name) ?? modelId,
        source: 'cloud_catalog',
        availability: 'available',
        modelId,
        modelType,
        platform,
        isDefault:
          response.default_model_id === modelId || model.is_default === true,
      },
    ];
  });
}

/** Independent global catalogs with transient, account-isolated metadata only. */
export async function discoverSpaceModels(): Promise<SpaceModelDiscovery> {
  const auth = getAuthStore();
  const owner = getAccountEnvironmentKey(auth);
  const token = auth.token;
  const assertCurrent = () => {
    const current = getAuthStore();
    if (owner !== getAccountEnvironmentKey(current) || token !== current.token)
      throw new Error('model_catalog_account_changed');
  };
  const [cloud, configured] = await Promise.allSettled([
    cloudCandidates(assertCurrent),
    configuredCandidates(assertCurrent),
  ]);
  assertCurrent();
  const providers = configured.status === 'fulfilled' ? configured.value : [];
  const counts = new Map<string, number>();
  providers.forEach((candidate) =>
    counts.set(candidate.value, (counts.get(candidate.value) ?? 0) + 1)
  );
  const candidates = [
    ...(cloud.status === 'fulfilled' ? cloud.value : []),
    ...providers.map((candidate) =>
      counts.get(candidate.value)! > 1
        ? {
            ...candidate,
            availability: 'requires_setup' as const,
            disabled: true,
            reason: 'model_ambiguous',
          }
        : candidate
    ),
  ];
  return {
    items: [
      {
        value: 'provider://default',
        label: i18next.t('layout.default'),
        source: 'user_default',
        availability: 'available',
        modelId: 'default',
        modelType: '',
        platform: '',
        isDefault: true,
      },
      ...new Map(
        candidates.map((candidate) => [candidate.value, candidate])
      ).values(),
    ],
    unavailableSources: [
      ...(cloud.status === 'rejected' ? (['cloud_catalog'] as const) : []),
      ...(configured.status === 'rejected'
        ? (['provider_catalog'] as const)
        : []),
    ],
  };
}
