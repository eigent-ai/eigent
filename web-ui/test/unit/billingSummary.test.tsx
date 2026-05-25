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

import { render, screen } from '@testing-library/react';
import { normalizeBillingSummary } from '@web/lib/viewModels';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@web/hooks/useWebAuth', () => ({
  useLogout: () => vi.fn(),
}));

vi.mock('@web/api/server', async () => {
  const actual =
    await vi.importActual<typeof import('@web/api/server')>('@web/api/server');
  return {
    ...actual,
    fetchCurrentUser: vi.fn().mockResolvedValue({
      email: 'user@example.com',
      fullname: 'User',
      nickname: 'U',
      work_desc: 'Builder',
    }),
    fetchBillingSummary: vi.fn().mockResolvedValue({
      email: 'user@example.com',
      subscription_mode: 'free',
      plan_name: 'Free',
      credits_total: 100,
      credits_daily: 10,
      credits_monthly: 20,
      credits_permanent: 70,
    }),
    updateUserProfile: vi.fn(),
  };
});

import ProfilePage from '@web/pages/ProfilePage';

describe('ProfilePage billing summary', () => {
  it('renders credits with partial data fallbacks', async () => {
    render(
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    );
    expect(await screen.findByText('Free')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(normalizeBillingSummary(null).plan_name).toBe('Free');
  });
});
