import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/api/http', () => ({
  proxyFetchGet: api.get,
  proxyFetchPost: api.post,
  proxyFetchPut: api.put,
  proxyFetchDelete: api.remove,
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: () => ({ modelType: 'custom' }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { SearchSettingsPanel } from '@/components/Settings/Connectors/components/SearchSettingsPanel';

describe('SearchSettingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue([
      {
        id: 1,
        config_group: 'Search',
        config_name: 'QUERIT_ENABLED',
        config_value: 'true',
      },
      {
        id: 2,
        config_group: 'Search',
        config_name: 'GOOGLE_API_KEY',
        config_value: 'google-key',
      },
      {
        id: 3,
        config_group: 'Search',
        config_name: 'SEARCH_ENGINE_ID',
        config_value: 'engine-id',
      },
    ]);
    api.post.mockResolvedValue({});
    api.put.mockResolvedValue({});
    api.remove.mockResolvedValue({});
  });

  it('loads anonymous Querit mode and saves a BYOK key', async () => {
    const user = userEvent.setup();
    const onConfigured = vi.fn();
    render(<SearchSettingsPanel onConfigured={onConfigured} />);

    const queritSwitch = await screen.findByRole('switch', {
      name: 'Use Querit search',
    });
    expect(queritSwitch).toBeChecked();

    expect(
      screen.getByRole('link', { name: 'Get a Querit API key' })
    ).toHaveAttribute('href', 'https://www.querit.ai/en?sa=eigenttt');
    expect(
      screen.getByRole('link', { name: 'Get a Querit API key' })
    ).toHaveAttribute('target', '_blank');

    await user.type(
      screen.getByPlaceholderText('Leave blank for anonymous mode'),
      'user-querit-key'
    );
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/v1/configs', {
        config_group: 'Search',
        config_name: 'QUERIT_API_KEY',
        config_value: 'user-querit-key',
      })
    );
    expect(api.put).toHaveBeenCalledWith('/api/v1/configs/1', {
      config_group: 'Search',
      config_name: 'QUERIT_ENABLED',
      config_value: 'true',
    });
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(onConfigured).toHaveBeenCalledOnce();
  });

  it('allows Querit to be enabled while configs are still loading', async () => {
    const user = userEvent.setup();
    let resolveConfigs: (configs: unknown[]) => void = () => undefined;
    api.get.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveConfigs = resolve;
      })
    );

    render(<SearchSettingsPanel />);

    expect(
      screen.getByRole('heading', { name: 'Querit authentication' })
    ).toBeInTheDocument();
    const queritSwitch = screen.getByRole('switch', {
      name: 'Use Querit search',
    });
    expect(queritSwitch).toBeEnabled();

    await user.click(queritSwitch);
    expect(queritSwitch).toBeChecked();

    await act(async () => {
      resolveConfigs([]);
    });
    expect(queritSwitch).toBeChecked();
  });
});
