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

import { shellBackState } from '@/lib/shellRoutes';
import WorkspaceSettingsRouteLayout from '@/routers/WorkspaceSettingsRouteLayout';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

function WorkspaceProbe() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState('');

  return (
    <div>
      <label htmlFor="workspace-draft">Draft</label>
      <input
        id="workspace-draft"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button
        type="button"
        onClick={() =>
          navigate('/home?section=settings', { state: shellBackState('/') })
        }
      >
        Open settings
      </button>
    </div>
  );
}

function SettingsProbe() {
  const navigate = useNavigate();
  return (
    <div>
      Settings page
      <button type="button" onClick={() => navigate(-1)}>
        Back to workspace
      </button>
    </div>
  );
}

describe('WorkspaceSettingsRouteLayout', () => {
  it('keeps workspace state mounted while Settings is active', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            element={
              <WorkspaceSettingsRouteLayout workspace={<WorkspaceProbe />} />
            }
          >
            <Route index element={null} />
            <Route path="/home" element={<SettingsProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    const draft = screen.getByLabelText('Draft');
    await user.type(draft, 'Keep this prompt');
    await user.click(screen.getByRole('button', { name: 'Open settings' }));

    expect(screen.getByText('Settings page')).toBeInTheDocument();
    expect(draft).toHaveValue('Keep this prompt');
    const retainedWorkspace = container.querySelector('[hidden][inert]');
    expect(retainedWorkspace).not.toBeNull();
    expect(retainedWorkspace).toContainElement(draft);

    await user.click(screen.getByRole('button', { name: 'Back to workspace' }));

    expect(screen.queryByText('Settings page')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Draft')).toHaveValue('Keep this prompt');
  });

  it('does not initialize Workspace for a direct Settings load', () => {
    render(
      <MemoryRouter initialEntries={['/home?section=settings']}>
        <Routes>
          <Route
            element={
              <WorkspaceSettingsRouteLayout workspace={<WorkspaceProbe />} />
            }
          >
            <Route index element={null} />
            <Route path="/home" element={<SettingsProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Settings page')).toBeInTheDocument();
    expect(screen.queryByLabelText('Draft')).not.toBeInTheDocument();
  });
});
