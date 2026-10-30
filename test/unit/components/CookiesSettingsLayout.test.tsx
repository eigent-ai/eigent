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

import Cookies from '@/components/Settings/Cookies';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  fetchDelete: vi.fn(),
  fetchGet: vi.fn(),
  fetchPost: vi.fn(),
}));

vi.mock('@/api/http', () => api);
vi.mock('@/host', () => ({ useHost: () => undefined }));

describe('Cookies settings layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchGet.mockResolvedValue({
      success: true,
      domains: [
        {
          domain: 'example.com',
          cookie_count: 2,
          last_access: '2026-08-17',
        },
        {
          domain: 'app.example.com',
          cookie_count: 3,
          last_access: '2026-08-17',
        },
      ],
    });
  });

  it('uses two divided settings rows without a Cookie domains heading', async () => {
    const { container } = render(<Cookies />);

    await screen.findByText('example.com');
    const group = container.querySelector('[data-settings-row-group]');
    const rows = group?.querySelectorAll('[data-settings-row]') ?? [];
    const dividers =
      group?.querySelectorAll('[data-settings-row-divider]') ?? [];

    expect(screen.queryByText('Cookie Domains')).not.toBeInTheDocument();
    expect(rows).toHaveLength(2);
    expect(dividers).toHaveLength(1);
    expect(within(rows[0] as HTMLElement).getByText('Domains')).toBeVisible();
    expect(
      within(rows[0] as HTMLElement).getByRole('button', {
        name: 'Open Browser',
      })
    ).toBeVisible();
    expect(
      within(rows[1] as HTMLElement).getByText('Saved cookies')
    ).toBeVisible();
    expect(
      within(rows[1] as HTMLElement).getByRole('button', {
        name: 'Delete All',
      })
    ).toBeVisible();
    expect(
      within(rows[1] as HTMLElement).getByRole('button', { name: 'Refresh' })
    ).toBeVisible();
  });
});
