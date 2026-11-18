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

/**
 * The model a Space's new Sessions start on. A model picked in a Session is
 * saved here, never as the global default (Settings > Models), which only
 * seeds a Space that has no saved model yet. Stored in the synced Space
 * metadata; it holds identifiers only, credentials are resolved at launch.
 */

import { getAccountEnvironmentKey } from '@/lib/authEnvironment';
import { fetchConfiguredProviders } from '@/lib/configuredModels';
import { getProviderValid } from '@/lib/providerStatus';
import { isLegacySpace } from '@/lib/spaceLabel';
import { getAuthStore } from '@/store/authStore';
import { getCloudModelStore } from '@/store/cloudModelStore';
import { useSpaceStore } from '@/store/spaceStore';
import i18next from 'i18next';
import { toast } from 'sonner';

export const SPACE_MODEL_METADATA_KEY = 'modelSelection';

export interface SpaceModelChoice {
  modelType: 'cloud' | 'local' | 'custom' | 'codex_subscription';
  cloud_model_type?: string;
  codex_model_type?: string;
  provider_id?: number;
  model_platform?: string;
  model_type?: string;
}

const optionalString = (value: unknown) =>
  typeof value === 'string' && value ? value : undefined;

/** Keeps only a well-formed choice; anything else reads as "no saved model". */
export function parseSpaceModelChoice(value: unknown): SpaceModelChoice | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const modelType = raw.modelType;
  if (modelType === 'cloud') {
    const cloud = optionalString(raw.cloud_model_type);
    return cloud ? { modelType, cloud_model_type: cloud } : null;
  }
  if (modelType === 'codex_subscription') {
    const codex = optionalString(raw.codex_model_type);
    return { modelType, ...(codex ? { codex_model_type: codex } : {}) };
  }
  if (modelType === 'custom' || modelType === 'local') {
    if (!Number.isInteger(raw.provider_id)) return null;
    const platform = optionalString(raw.model_platform);
    const type = optionalString(raw.model_type);
    return {
      modelType,
      provider_id: raw.provider_id as number,
      ...(platform ? { model_platform: platform } : {}),
      ...(type ? { model_type: type } : {}),
    };
  }
  return null;
}

export function isModelScopedSpace(spaceId: string | null | undefined) {
  if (!spaceId || spaceId.startsWith('legacy_')) return false;
  const space = useSpaceStore.getState().spaces?.[spaceId];
  return Boolean(space && !isLegacySpace(space));
}

export function getSpaceModelChoice(
  spaceId: string | null | undefined
): SpaceModelChoice | null {
  if (!isModelScopedSpace(spaceId)) return null;
  return parseSpaceModelChoice(
    useSpaceStore.getState().spaces?.[spaceId!]?.metadata?.[
      SPACE_MODEL_METADATA_KEY
    ]
  );
}

export function sameSpaceModelChoice(
  a: SpaceModelChoice | null | undefined,
  b: SpaceModelChoice | null | undefined
) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

const writesBySpace = new Map<string, Promise<unknown>>();
const latestBySpace = new Map<string, SpaceModelChoice>();

/**
 * Saves the model for one Space: locally at once, then on the server (the
 * Space PATCH merges metadata keys). Writes for a Space are serialized so an
 * older response cannot replace a newer choice.
 */
export function setSpaceModelChoice(
  spaceId: string | null | undefined,
  selection: SpaceModelChoice
): Promise<void> {
  const choice = parseSpaceModelChoice(selection);
  if (!choice || !isModelScopedSpace(spaceId)) return Promise.resolve();
  const id = spaceId!;
  if (sameSpaceModelChoice(getSpaceModelChoice(id), choice))
    return writesBySpace.get(id)?.then(() => undefined) ?? Promise.resolve();
  latestBySpace.set(id, choice);
  useSpaceStore.getState().updateSpace(id, {
    metadata: { [SPACE_MODEL_METADATA_KEY]: choice },
  });
  const accountKey = getAccountEnvironmentKey(getAuthStore());
  const persist = async () => {
    if (getAccountEnvironmentKey(getAuthStore()) !== accountKey) return;
    // A newer local choice owns the server write.
    if (latestBySpace.get(id) !== choice) return;
    await useSpaceStore.getState().updateSpaceOnServer(id, {
      metadata: { [SPACE_MODEL_METADATA_KEY]: choice },
    });
  };
  const prior = writesBySpace.get(id);
  const write = (prior ? prior.catch(() => undefined) : Promise.resolve())
    .then(persist)
    .catch((error) => {
      console.warn(`Failed to save the model for Space ${id}:`, error);
      // The next Space sync replaces an unsaved choice, so say it failed.
      if (
        latestBySpace.get(id) === choice &&
        getAccountEnvironmentKey(getAuthStore()) === accountKey
      )
        toast.error(i18next.t('setting.save-failed'));
    })
    .finally(() => {
      if (writesBySpace.get(id) !== write) return;
      writesBySpace.delete(id);
      latestBySpace.delete(id);
    });
  writesBySpace.set(id, write);
  return write;
}

/**
 * Checks that a saved Space model can still run. Returns the choice to use
 * (a retired cloud model becomes its replacement), or null when the model is
 * gone so the caller falls back to the global default. A failed lookup
 * throws: it does not prove the model is gone.
 */
export async function resolveSpaceModelChoice(
  choice: SpaceModelChoice,
  assertCurrent: () => void
): Promise<SpaceModelChoice | null> {
  if (choice.modelType === 'codex_subscription') return choice;
  if (choice.modelType === 'cloud') {
    if (import.meta.env.VITE_USE_LOCAL_PROXY === 'true') return null;
    const store = getCloudModelStore();
    let resolved = store.resolveCloudModel(choice.cloud_model_type);
    if (resolved?.source !== 'selected') {
      await store.fetchCloudModels(true);
      assertCurrent();
      resolved = getCloudModelStore().resolveCloudModel(
        choice.cloud_model_type
      );
    }
    if (!resolved || resolved.source === 'default') return null;
    return { modelType: 'cloud', cloud_model_type: resolved.model.id };
  }
  const records = await fetchConfiguredProviders();
  assertCurrent();
  const record = records.find((item) => item.id === choice.provider_id);
  if (!record || !getProviderValid(record)) return null;
  return {
    modelType: choice.modelType,
    provider_id: record.id,
    model_platform: record.provider_name,
    model_type: record.model_type,
  };
}
