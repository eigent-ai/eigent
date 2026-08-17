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
import { fireEvent, render, screen, within } from '@testing-library/react';
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
    expect(identitySection).toHaveClass('flex', 'flex-col');
    expect(modelSection?.lastElementChild).toHaveClass('divide-y');
    expect(container.querySelector('select')).toBeNull();
  });

  it('splits the profile rail from the two-column Identity controls', () => {
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
    const identityGrid = within(identitySection).getByTestId(
      'identity-settings-grid'
    );
    const scrollIntoView = vi.fn();
    modelSection.scrollIntoView = scrollIntoView;

    expect(profileRail).toHaveClass('md:w-[300px]', 'md:sticky');
    expect(profileRail.children).toHaveLength(1);
    expect(profileRail.firstElementChild).toContainElement(contents);
    expect(
      within(profileRail).getByRole('img', {
        name: 'Space identity preview',
      })
    ).toHaveClass('bg-ds-bg-brand-subtle-default');
    expect(within(profileRail).getByText('Share option')).toBeInTheDocument();
    expect(
      within(profileRail).getByRole('button', { name: 'Save & share' })
    ).toBeEnabled();
    expect(within(contents).getAllByRole('button')).toHaveLength(9);
    expect(within(contents).queryByRole('link')).not.toBeInTheDocument();
    fireEvent.click(within(contents).getByRole('button', { name: 'Model' }));
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'start',
    });
    expect(identityGrid).toHaveClass('sm:grid-cols-2');
    expect(identityGrid.children).toHaveLength(4);
    expect(within(identitySection).getByLabelText('Bundle name')).toHaveValue(
      'Research Bundle'
    );
    expect(
      within(identitySection).getByRole('combobox', {
        name: 'Permission profile',
      })
    ).toBeInTheDocument();
    expect(
      within(identitySection).getByRole('switch', {
        name: 'Git workspace environment',
      })
    ).toBeChecked();
    expect(
      within(identitySection).getByRole('combobox', { name: 'Remote policy' })
    ).toBeInTheDocument();
  });
});
