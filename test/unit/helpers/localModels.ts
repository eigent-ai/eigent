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

// Fixtures for the user's own models as the app window sees them: saved on
// this device, named by a reference, and never holding a key.

export const TEST_MODEL_ACCOUNT_SCOPE = 'a'.repeat(64);

type Row = Record<string, any> & { id: number };

/** A saved model as listed for the app window. A fixture key is dropped. */
export function localModelRecord(row: Row) {
  const { api_key: key, ...rest } = row;
  const hasKey =
    typeof key === 'string' && key !== '' && key !== 'not-required';
  return {
    server_id: null,
    provider_name: '',
    model_type: '',
    endpoint_url: '',
    encrypted_config: {},
    prefer: false,
    is_valid: 2,
    has_api_key: hasKey,
    endpoint_has_secret: false,
    key_state: hasKey ? 'saved' : 'not_required',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...rest,
    model_credential: {
      account_scope: TEST_MODEL_ACCOUNT_SCOPE,
      credential_id: row.id,
    },
  };
}

export function localModelList(rows: Row[]) {
  return {
    storage: 'secure' as const,
    imported: true,
    records: rows.map(localModelRecord),
  };
}

/** The reference a run sends instead of a key for the model `id`. */
export function modelCredential(id: number) {
  return { account_scope: TEST_MODEL_ACCOUNT_SCOPE, credential_id: id };
}
