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

import { WorkspaceConfigurationEditor } from '@/pages/WorkspaceConfiguration';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const document = {
    apiVersion: 'eigent.ai/v1alpha1' as const,
    kind: 'WorkspaceBundle' as const,
    metadata: { id: 'bundle-1', name: 'Research Bundle', revision: 1 },
    spec: {
      instructions: { coordinator: 'bundle://instructions/coordinator.md' },
      context: [],
      skills: [],
      connectors: [],
      mcpServers: [],
      environment: { variables: [] },
      agents: [],
      models: {
        default: {
          modelRef: 'provider://default',
          thinkingEffort: 'medium' as const,
        },
      },
      permissions: {
        profile: 'request_approval' as const,
        rules: [],
      },
      git: {
        enabled: true,
        checkpointPolicy: 'user_and_run_terminal',
        agentIsolation: 'worktree' as const,
        remotePolicy: 'prompt' as const,
      },
    },
  };

  return {
    document,
    setDocument: vi.fn(),
    reload: vi.fn(),
    retrySave: vi.fn(),
  };
});

vi.mock('@/store/spaceStore', () => ({
  useSpaceStore: (selector: (state: object) => unknown) =>
    selector({
      activeSpaceId: 'space-1',
      spaces: {
        'space-1': { id: 'space-1', name: 'Research Space' },
      },
    }),
}));

vi.mock('@/store/authStore', () => ({
  getAuthStore: () => ({
    appearance: 'light',
    language: 'en',
    email: 'user@example.com',
    user_id: 7,
  }),
  useAuthStore: (selector: (state: object) => unknown) =>
    selector({
      appearance: 'light',
      language: 'en',
      email: 'user@example.com',
      user_id: 7,
    }),
  useWorkerList: () => [],
}));

vi.mock('@/hooks/useWorkspaceConfiguration', () => ({
  useWorkspaceConfiguration: () => ({
    draft: {
      space_id: 'space-1',
      version: 1,
      base_revision_id: null,
      document: mocks.document,
      document_digest: 'a'.repeat(64),
      persisted: true,
      updated_at: 10,
    },
    document: mocks.document,
    setDocument: mocks.setDocument,
    saveState: 'saved',
    error: null,
    reload: mocks.reload,
    retrySave: mocks.retrySave,
  }),
}));

vi.mock(
  '@/components/WorkspaceConfiguration/WorkspaceBundleSaveDialog',
  () => ({ WorkspaceBundleSaveDialog: () => null })
);

describe('WorkspaceConfigurationEditor', () => {
  beforeEach(() => {
    mocks.setDocument.mockClear();
    mocks.reload.mockClear();
    mocks.retrySave.mockClear();
  });

  it('uses settings sections and places Identity before the configuration tables', () => {
    const { container } = render(
      <WorkspaceConfigurationEditor presentation="settings" spaceId="space-1" />
    );

    const identitySection = container.querySelector('#space-settings-identity');
    const modelSection = container.querySelector('#space-settings-model');
    const environmentSection = container.querySelector(
      '#space-settings-environment'
    );
    const instructionsSection = container.querySelector(
      '#space-settings-instructions'
    );

    expect(
      identitySection!.compareDocumentPosition(modelSection!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      modelSection!.compareDocumentPosition(environmentSection!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      environmentSection!.compareDocumentPosition(instructionsSection!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    const settingsGroups = container.querySelectorAll(
      '[data-settings-row-group]'
    );
    const modelGroup = modelSection?.querySelector('[data-settings-row-group]');
    const environmentGroup = environmentSection?.querySelector(
      '[data-settings-row-group]'
    );
    expect(settingsGroups).toHaveLength(8);
    expect(modelGroup).toBeInTheDocument();
    expect(environmentGroup).toBeInTheDocument();
    expect(modelGroup).not.toBe(environmentGroup);
    expect(identitySection).toContainElement(
      within(identitySection as HTMLElement).getByTestId(
        'identity-settings-group'
      )
    );
    expect(
      container.querySelectorAll('[data-settings-row-divider]')
    ).toHaveLength(0);
    expect(modelSection?.querySelector('.divide-y')).toBeInTheDocument();
    expect(container.querySelector('select')).toBeNull();
    expect(
      container.querySelector('[data-workspace-configuration-width]')
    ).toHaveClass('w-full');
    expect(
      container.querySelector('[data-workspace-configuration-width]')
    ).not.toHaveClass('max-w-5xl');
  });

  it('shows the simplified profile rail and keeps section actions with their lists', () => {
    const { container } = render(
      <WorkspaceConfigurationEditor presentation="settings" spaceId="space-1" />
    );

    const profileRail = screen.getByRole('complementary', {
      name: 'Space identity profile',
    });
    const contents = within(profileRail).getByRole('navigation', {
      name: 'Space settings sections',
    });
    const identitySection = container.querySelector(
      '#space-settings-identity'
    ) as HTMLElement;
    const modelSection = container.querySelector(
      '#space-settings-model'
    ) as HTMLElement;
    const identityGroup = within(identitySection).getByTestId(
      'identity-settings-group'
    );
    const scrollIntoView = vi.fn();
    modelSection.scrollIntoView = scrollIntoView;

    expect(profileRail).toHaveClass('md:w-[300px]', 'md:sticky');
    expect(profileRail.children).toHaveLength(1);
    expect(profileRail.firstElementChild).toContainElement(contents);
    expect(within(profileRail).getByText('Profile')).toBeInTheDocument();
    expect(
      within(profileRail).getByText('Research Bundle')
    ).toBeInTheDocument();
    expect(
      within(profileRail).queryByRole('img', {
        name: 'Space identity preview',
      })
    ).not.toBeInTheDocument();
    expect(
      within(profileRail).queryByText('Identity profile')
    ).not.toBeInTheDocument();
    expect(
      within(profileRail).queryByText('Share option')
    ).not.toBeInTheDocument();
    expect(
      within(profileRail).getByRole('button', {
        name: 'Share workspace bundle',
      })
    ).toBeEnabled();
    expect(within(contents).getAllByRole('button')).toHaveLength(9);
    expect(within(contents).queryByRole('link')).not.toBeInTheDocument();
    expect(
      within(contents).getByRole('button', { name: 'Identity' })
    ).toHaveAttribute('aria-current', 'location');
    fireEvent.click(within(contents).getByRole('button', { name: 'Model' }));
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
    expect(
      within(contents).getByRole('button', { name: 'Model' })
    ).toHaveAttribute('aria-current', 'location');
    expect(
      within(identitySection).queryByText('Identity')
    ).not.toBeInTheDocument();
    expect(identityGroup).toHaveClass('divide-y');
    expect(identityGroup.children).toHaveLength(4);
    const bundleNameInput =
      within(identitySection).getByLabelText('Bundle name');
    const permissionSelect = within(identitySection).getByRole('combobox', {
      name: 'Permission profile',
    });
    const remotePolicySelect = within(identitySection).getByRole('combobox', {
      name: 'Remote policy',
    });
    expect(bundleNameInput).toHaveValue('Research Bundle');
    expect(bundleNameInput.parentElement).toHaveClass(
      'bg-ds-bg-neutral-subtle-default'
    );
    expect(permissionSelect).toHaveClass('bg-ds-bg-neutral-subtle-default');
    expect(remotePolicySelect).toHaveClass('bg-ds-bg-neutral-subtle-default');
    expect(
      within(identitySection).getByRole('switch', {
        name: 'Git workspace environment',
      })
    ).toBeChecked();
    expect(remotePolicySelect).toBeInTheDocument();

    const environmentSection = container.querySelector(
      '#space-settings-environment'
    ) as HTMLElement;
    const environmentRow = environmentSection.querySelector(
      '[data-settings-row]'
    );
    expect(environmentRow).toContainElement(
      within(environmentSection).getByRole('button', { name: 'Add' })
    );
    expect(environmentRow).toHaveTextContent(
      'No environment variables are required.'
    );
  });

  it('tracks the current contents item while the settings sections scroll', async () => {
    const { container } = render(
      <WorkspaceConfigurationEditor presentation="settings" spaceId="space-1" />
    );
    const sectionIds = [
      'space-settings-identity',
      'space-settings-model',
      'space-settings-environment',
      'space-settings-instructions',
      'space-settings-context',
      'space-settings-agents',
      'space-settings-skills',
      'space-settings-connectors',
      'space-settings-mcp-servers',
    ];
    const sectionTops = [-500, -400, -300, -200, 80, 300, 500, 700, 900];

    sectionIds.forEach((id, index) => {
      const section = container.querySelector(`#${id}`) as HTMLElement;
      section.getBoundingClientRect = vi.fn(
        () =>
          ({
            top: sectionTops[index],
            bottom: sectionTops[index] + 160,
            left: 0,
            right: 600,
            width: 600,
            height: 160,
            x: 0,
            y: sectionTops[index],
            toJSON: () => ({}),
          }) as DOMRect
      );
    });

    fireEvent.scroll(window);

    const contents = screen.getByRole('navigation', {
      name: 'Space settings sections',
    });
    await waitFor(() =>
      expect(
        within(contents).getByRole('button', { name: 'Context' })
      ).toHaveAttribute('aria-current', 'location')
    );
  });
});
