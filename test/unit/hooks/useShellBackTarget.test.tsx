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

import { shellBackState, useShellBackTarget } from '@/hooks/useShellBackTarget';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

function BackHarness() {
  const location = useLocation();
  const navigate = useNavigate();
  const { goBack } = useShellBackTarget();

  return (
    <>
      <output aria-label="location">
        {location.pathname}
        {location.search}
      </output>
      <button type="button" onClick={goBack}>
        App back
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        Browser back
      </button>
      <button type="button" onClick={() => navigate(1)}>
        Browser forward
      </button>
    </>
  );
}

describe('useShellBackTarget', () => {
  it('pops history when navigation recorded an origin', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter
        initialEntries={[
          '/?project=123',
          {
            pathname: '/settings',
            state: shellBackState('/?project=123'),
          },
        ]}
        initialIndex={1}
      >
        <BackHarness />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'App back' }));
    expect(screen.getByLabelText('location')).toHaveTextContent(
      '/?project=123'
    );

    await user.click(screen.getByRole('button', { name: 'Browser forward' }));
    expect(screen.getByLabelText('location')).toHaveTextContent('/settings');
  });

  it('replaces a direct entry with the fallback', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <BackHarness />
      </MemoryRouter>
    );

    await user.click(screen.getByRole('button', { name: 'App back' }));
    expect(screen.getByLabelText('location')).toHaveTextContent('/');

    await user.click(screen.getByRole('button', { name: 'Browser back' }));
    expect(screen.getByLabelText('location')).toHaveTextContent('/');
  });
});
