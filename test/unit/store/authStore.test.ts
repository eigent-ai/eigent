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

import { migrateAuthPersistedState } from '@/store/authStore';
import { describe, expect, it } from 'vitest';

type MigratedState = {
  token: string;
  username: string;
  email: string;
  user_id: number;
  appearance: string;
  appearanceMode: string;
  language: string;
  modelType: string;
  hasModelConfigured: boolean;
  workspaceMainBackground: string;
  customThemeCatalog: {
    light: Record<string, unknown>;
    dark: Record<string, unknown>;
  };
  workerListData: Record<string, unknown>;
};

describe('authStore migration', () => {
  it('migrates v6 state to v7 without dropping existing fields', () => {
    const v6State = {
      token: 'eigent-token-1',
      username: 'Eigent',
      email: 'eigent@example.com',
      user_id: 42,
      appearance: 'dark',
      appearanceMode: 'system',
      customThemeCatalog: {
        light: { custom: { id: 'custom' } },
      },
      workspaceMainBackground: 'margin-ruled',
      language: 'en',
      modelType: 'custom',
      workerListData: {
        'eigent@example.com': [{ id: 'eigent-agent-1' }],
      },
    };

    const migrated = migrateAuthPersistedState(v6State, 6) as MigratedState;

    expect(migrated).toMatchObject({
      token: v6State.token,
      username: v6State.username,
      email: v6State.email,
      user_id: v6State.user_id,
      language: v6State.language,
      modelType: v6State.modelType,
      workerListData: v6State.workerListData,
      appearance: 'dark',
      appearanceMode: 'system',
      workspaceMainBackground: 'ruled',
      hasModelConfigured: false,
    });
    expect(migrated.customThemeCatalog.light).toEqual(
      v6State.customThemeCatalog.light
    );
    expect(migrated.customThemeCatalog.dark).toEqual({});
  });

  it('normalizes the same way regardless of source version (e.g. v5)', () => {
    const v5State = {
      token: 'eigent-token-2',
      username: 'Eigent',
      email: 'eigent@example.com',
      user_id: 7,
      appearance: 'light',
      language: 'system',
      modelType: 'cloud',
      workerListData: {},
    };

    const migrated = migrateAuthPersistedState(v5State, 5) as MigratedState;

    expect(migrated).toMatchObject({
      appearance: 'light',
      appearanceMode: 'light',
      workspaceMainBackground: 'empty',
      hasModelConfigured: false,
    });
    expect(migrated.customThemeCatalog).toEqual({ light: {}, dark: {} });
  });

  it('rewrites the legacy "transparent" appearance to light', () => {
    const legacyState = {
      token: 'eigent-token-3',
      username: 'Eigent',
      email: 'eigent@example.com',
      appearance: 'transparent',
      appearanceMode: 'transparent',
      modelType: 'cloud',
    };

    const migrated = migrateAuthPersistedState(legacyState, 4) as MigratedState;

    expect(migrated.appearance).toBe('light');
    expect(migrated.appearanceMode).toBe('light');
  });

  it('coerces unknown workspaceMainBackground values to "empty"', () => {
    const legacyState = {
      token: 'eigent-token-4',
      username: 'Eigent',
      email: 'eigent@example.com',
      appearance: 'light',
      modelType: 'cloud',
      workspaceMainBackground: 'none',
    };
    const noneMigrated = migrateAuthPersistedState(
      legacyState,
      6
    ) as MigratedState;
    expect(noneMigrated.workspaceMainBackground).toBe('empty');

    const garbageMigrated = migrateAuthPersistedState(
      { ...legacyState, workspaceMainBackground: 'something-removed' },
      6
    ) as MigratedState;
    expect(garbageMigrated.workspaceMainBackground).toBe('empty');
  });

  it('preserves an explicit hasModelConfigured=true flag', () => {
    const v6State = {
      token: 'eigent-token-5',
      username: 'Eigent',
      email: 'eigent@example.com',
      appearance: 'light',
      modelType: 'custom',
      hasModelConfigured: true,
    };

    const migrated = migrateAuthPersistedState(v6State, 6) as MigratedState;

    expect(migrated.hasModelConfigured).toBe(true);
  });

  it('returns the input unchanged when the persisted state is undefined', () => {
    expect(migrateAuthPersistedState(undefined, 6)).toBeUndefined();
  });
});
