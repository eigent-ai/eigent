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

import { useModelConfigCheck } from '@/hooks/useModelConfigCheck';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localModelRecord } from '../helpers/localModels';

const mocks = vi.hoisted(() => ({
  savedModels: vi.fn(),
  http: vi.fn(),
  auth: {
    modelType: 'custom',
    hasModelConfigured: true,
    token: 'synthetic-token',
    setHasModelConfigured: vi.fn(),
  },
}));
// The check reads the user's own models from this device.
vi.mock('@/lib/configuredModels', () => ({
  MODEL_CONFIGURATIONS_CHANGED: 'eigent:model-configurations-changed',
  fetchConfiguredProviders: mocks.savedModels,
}));
vi.mock('@/api/http', () => ({ proxyFetchGet: mocks.http }));
vi.mock('@/host/createHost', () => ({ createHost: () => ({}) }));
vi.mock('@/store/authStore', () => ({
  useAuthStore: (selector: (state: typeof mocks.auth) => unknown) =>
    selector(mocks.auth),
  getAuthStore: () => mocks.auth,
}));
vi.mock('@/store/cloudModelStore', () => ({
  getCloudModelStore: () => ({
    fetchCloudModels: vi.fn(),
    resolveCloudModel: () => null,
  }),
}));
vi.mock('@/store/usageNoticeStore', () => ({
  refreshUsage: vi.fn(),
  useUsageNoticeStore: (selector: (state: { incidents: never[] }) => unknown) =>
    selector({ incidents: [] }),
}));

function Reader() {
  const check = useModelConfigCheck();
  return (
    <div data-testid="check">
      {check.isConfigLoaded ? 'loaded' : 'loading'}
      {check.modelKeyNeeded ? ' key-needed' : ''}
    </div>
  );
}
const mount = () =>
  render(
    <MemoryRouter>
      <Reader />
    </MemoryRouter>
  );
const model = (more: Record<string, unknown> = {}) =>
  localModelRecord({
    id: 57,
    provider_name: 'openai',
    model_type: 'gpt-test',
    api_key: 'unit-test-model-key-0001',
    prefer: true,
    ...more,
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.modelType = 'custom';
});

describe('model check for the default own model', () => {
  it('finds a usable default on this device without asking the server', async () => {
    mocks.savedModels.mockResolvedValue([model()]);
    mount();

    await waitFor(() =>
      expect(screen.getByTestId('check')).toHaveTextContent('loaded')
    );
    expect(mocks.auth.setHasModelConfigured).toHaveBeenLastCalledWith(true);
    expect(screen.getByTestId('check')).not.toHaveTextContent('key-needed');
    expect(mocks.http).not.toHaveBeenCalled();
  });

  it('says the key is needed when the default is set up without its key', async () => {
    mocks.savedModels.mockResolvedValue([
      model({ is_valid: 1, key_state: 'needed' }),
    ]);
    mount();

    await waitFor(() =>
      expect(screen.getByTestId('check')).toHaveTextContent('key-needed')
    );
    expect(mocks.auth.setHasModelConfigured).toHaveBeenLastCalledWith(false);
  });

  it('does not ask for a key when no default own model exists', async () => {
    mocks.savedModels.mockResolvedValue([
      model({ prefer: false, is_valid: 1, key_state: 'needed' }),
    ]);
    mount();

    await waitFor(() =>
      expect(screen.getByTestId('check')).toHaveTextContent('loaded')
    );
    expect(mocks.auth.setHasModelConfigured).toHaveBeenLastCalledWith(false);
    expect(screen.getByTestId('check')).not.toHaveTextContent('key-needed');
  });

  it('keeps the last known answer when the saved models cannot be read', async () => {
    mocks.savedModels.mockRejectedValue(new Error('store unreadable'));
    mount();

    await waitFor(() =>
      expect(screen.getByTestId('check')).toHaveTextContent('loaded')
    );
    expect(mocks.auth.setHasModelConfigured).not.toHaveBeenCalled();
  });
});
