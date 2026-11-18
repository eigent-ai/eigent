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

import HomePage from '@/pages/Home';
import SettingsPage from '@/pages/Settings';
import { LegacySettingRedirect } from '@/routers/LegacyRouteCompatibility';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {JSON.stringify({
        path: `${location.pathname}${location.search}`,
        state: location.state,
      })}
    </output>
  );
}

/**
 * Render the real page only while it still has a redirect to make, so these
 * tests cover routing without mounting either page's content.
 */
function HomeRoute() {
  const location = useLocation();
  const section = new URLSearchParams(location.search).get('section');
  return section !== null && section !== 'spaces' ? (
    <HomePage />
  ) : (
    <LocationProbe />
  );
}

function SettingsRoute() {
  const location = useLocation();
  return new URLSearchParams(location.search).has('section') ? (
    <SettingsPage />
  ) : (
    <LocationProbe />
  );
}

async function redirectFrom(entry: string, state?: Record<string, unknown>) {
  const [pathname, search = ''] = entry.split('?');
  render(
    <MemoryRouter
      initialEntries={[{ pathname, search: search ? `?${search}` : '', state }]}
    >
      <Routes>
        <Route path="/home" element={<HomeRoute />} />
        <Route path="/settings" element={<SettingsRoute />} />
        <Route path="/setting" element={<LegacySettingRedirect />} />
        <Route path="/setting/*" element={<LegacySettingRedirect />} />
      </Routes>
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByTestId('location')).toBeVisible());
  return JSON.parse(screen.getByTestId('location').textContent || '{}') as {
    path: string;
    state: unknown;
  };
}

describe('Settings routes', () => {
  it.each([
    [
      '/home?section=settings&tab=models&provider=ant-ling',
      '/settings?tab=models&provider=ant-ling',
    ],
    [
      '/home?section=settings&tab=connectors&connectorId=github',
      '/settings?tab=connectors&connectorId=github',
    ],
    ['/home?section=settings', '/settings'],
    ['/home?section=memory', '/settings?tab=memory'],
    ['/settings?section=models', '/settings?tab=models'],
    ['/settings?section=settings&tab=cookies', '/settings?tab=cookies'],
    [
      '/settings?section=spaces&spaceId=space-1',
      '/home?section=spaces&spaceId=space-1',
    ],
    ['/setting', '/settings'],
    ['/setting/models', '/settings?tab=models'],
    ['/setting/browser-plugins/extra', '/settings?tab=browser-plugins'],
    ['/setting/unknown', '/settings'],
    ['/setting?tab=skills', '/settings?tab=skills'],
  ])('sends %s to %s', async (entry, expected) => {
    const origin = { from: '/?view=project' };
    const location = await redirectFrom(entry, origin);

    expect(location.path).toBe(expected);
    // The Workspace stays mounted only while the shell origin survives.
    expect(location.state).toEqual(origin);
  });

  it('leaves the Spaces hub on Home', async () => {
    const location = await redirectFrom('/home?section=spaces');
    expect(location.path).toBe('/home?section=spaces');
  });
});
