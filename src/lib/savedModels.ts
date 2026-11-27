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

// Reads the user's own models. They are saved on this device; this is the
// one place the rest of the app window asks for them.

import {
  listLocalModelConfigurations,
  type LocalModelConfiguration,
  type LocalModelConfigurationList,
} from '@/lib/modelConfigurationStore';
import { importEarlierModelConfigurations } from '@/lib/modelProviderRegistration';
import { getAuthStore } from '@/store/authStore';

/** One of the user's own models. It carries a reference, never a key. */
export type SavedModel = LocalModelConfiguration;

/**
 * Where keys are kept: in the OS key store (`secure`), or only until the app
 * quits (`session`, and `memory` in a browser).
 */
export type ModelKeyStorage = LocalModelConfigurationList['storage'];

/**
 * The saved models with where their keys are kept.
 *
 * The first time an account has nothing saved here, the models it set up
 * earlier are taken over by name and plain settings. They arrive without a
 * key and ask for it again.
 */
export async function fetchSavedModelInventory(): Promise<{
  records: SavedModel[];
  keyStorage: ModelKeyStorage;
}> {
  const account = getAuthStore();
  let list = await listLocalModelConfigurations(account);
  if (
    !list.imported &&
    list.records.length === 0 &&
    (await importEarlierModelConfigurations())
  )
    list = await listLocalModelConfigurations(account);
  return { records: list.records, keyStorage: list.storage };
}

/** Do not collapse records by provider name: a key belongs to a record ID. */
export async function fetchSavedModels(): Promise<SavedModel[]> {
  return (await fetchSavedModelInventory()).records;
}
