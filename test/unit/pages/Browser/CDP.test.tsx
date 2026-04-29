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

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchDelete, fetchGet, fetchPost } from '@/api/http';
import { useHost } from '@/host';
import CDP from '@/pages/Browser/CDP';
import { toast } from 'sonner';

vi.mock('@/api/http', () => ({
  fetchDelete: vi.fn(),
  fetchGet: vi.fn(),
  fetchPost: vi.fn(),
}));

vi.mock('@/host', () => ({
  useHost: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    loading: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string | number>) => {
      const translations: Record<string, string> = {
        'layout.cdp-browser-connection': 'CDP Browser Connection',
        'layout.cdp-browser-pool': 'CDP Browser Pool',
        'layout.open-new-browser': 'Open Blank Browser',
        'layout.connect-existing-browser': 'Connect Existing Browser',
        'layout.no-browsers-in-pool': 'No browsers in pool',
        'layout.add-browsers-hint': 'Add a browser to get started',
      };

      if (key === 'layout.launching-browser') {
        return `Launching browser on port ${options?.port ?? '...'}`;
      }

      if (key === 'layout.browser-launched') {
        return `Browser launched on port ${options?.port ?? ''}`.trim();
      }

      return translations[key] || key;
    },
  }),
}));

vi.mock('@/components/ui/alertDialog', () => ({
  default: () => null,
}));

describe('CDP Browser Page', () => {
  const mockFetchDelete = vi.mocked(fetchDelete);
  const mockFetchGet = vi.mocked(fetchGet);
  const mockFetchPost = vi.mocked(fetchPost);
  const mockUseHost = vi.mocked(useHost);
  const mockToast = vi.mocked(toast);

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseHost.mockReturnValue(null);
    mockFetchDelete.mockResolvedValue({ success: true });
    mockFetchGet.mockResolvedValue([]);
    mockFetchPost.mockResolvedValue({
      success: true,
      port: 9222,
      browser: {
        id: 'web-cdp-9222',
        port: 9222,
        isExternal: false,
        name: 'Managed Browser (9222)',
        addedAt: 123,
      },
    });
  });

  it('launches a browser through the backend in web mode', async () => {
    render(<CDP />);

    await waitFor(() => {
      expect(mockFetchGet).toHaveBeenCalledWith('/browser/cdp/list');
    });

    await userEvent.click(
      screen.getByRole('button', { name: /open blank browser/i })
    );

    await waitFor(() => {
      expect(mockFetchPost).toHaveBeenCalledWith('/browser/cdp/launch');
    });

    await waitFor(() => {
      expect(mockFetchGet).toHaveBeenCalledTimes(2);
    });

    expect(mockToast.loading).toHaveBeenCalledWith(
      'Launching browser on port ...',
      { id: 'launch-browser' }
    );
    expect(mockToast.success).toHaveBeenCalledWith(
      'Browser launched on port 9222',
      { id: 'launch-browser' }
    );
  });
});
