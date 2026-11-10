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

import {
  flushWorkspaceConfigurationBeforeNavigation,
  hasPendingWorkspaceConfigurationChanges,
} from '@/lib/workspaceConfigurationNavigationGuard';
import { WorkspaceConfigurationEditor } from '@/pages/WorkspaceConfiguration';
import type { SpaceSkillCandidate } from '@/service/spaceSettingsDiscovery';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    reducedMotion: false,
    identity: { email: 'user@example.com', user_id: 7 },
    saveState: 'saved' as
      'idle' | 'loading' | 'saving' | 'saved' | 'needs_attention',
    setDocument: vi.fn(),
    hasPendingChanges: false,
    flushSave: vi.fn(),
    reload: vi.fn(),
    retrySave: vi.fn(),
    skillItems: [] as SpaceSkillCandidate[],
    modelItems: [] as Array<{
      value: string;
      label: string;
      source: string;
      availability: string;
      disabled?: boolean;
      reason?: string;
    }>,
  };
});

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return {
    ...actual,
    useReducedMotion: () => mocks.reducedMotion,
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
    ...mocks.identity,
  }),
  useAuthStore: (selector: (state: object) => unknown) =>
    selector({
      appearance: 'light',
      language: 'en',
      ...mocks.identity,
    }),
  useWorkerList: () => [],
}));

vi.mock('@/hooks/useSpaceSettingsDiscovery', () => {
  const empty = { items: [], status: 'empty', error: null, retry: vi.fn() };
  const connectors = {
    ...empty,
    query: '',
    hasMore: false,
    loadingMore: false,
    loadMore: vi.fn(),
    fetchDetails: vi.fn(),
    detailError: null,
  };
  return {
    useSpaceSettingsDiscovery: () => ({
      models: { ...empty, status: 'ready', items: mocks.modelItems },
      skills: {
        ...empty,
        status: mocks.skillItems.length ? 'ready' : 'empty',
        items: mocks.skillItems,
      },
      mcpServers: empty,
      connectors,
      setConnectorQuery: vi.fn(),
    }),
  };
});

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
    saveState: mocks.saveState,
    error: null,
    hasPendingChanges: mocks.hasPendingChanges,
    flushSave: mocks.flushSave,
    reload: mocks.reload,
    retrySave: mocks.retrySave,
  }),
}));

vi.mock(
  '@/components/WorkspaceConfiguration/WorkspaceBundleSaveDialog',
  () => ({ WorkspaceBundleSaveDialog: () => null })
);

describe('WorkspaceConfigurationEditor', () => {
  let restoreRectangle: (() => void) | undefined;
  afterEach(() => {
    restoreRectangle?.();
    restoreRectangle = undefined;
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    mocks.reducedMotion = false;
    mocks.identity = { email: 'user@example.com', user_id: 7 };
    mocks.saveState = 'saved';
    mocks.hasPendingChanges = false;
    mocks.setDocument.mockClear();
    mocks.flushSave.mockReset();
    mocks.flushSave.mockResolvedValue(true);
    mocks.reload.mockClear();
    mocks.retrySave.mockClear();
    mocks.modelItems = [];
    mocks.skillItems = [];
    mocks.document.spec.environment.variables.splice(0);
  });

  it.each([false, true])(
    'lets Select handle Escape before the editor, reduced motion=%s',
    async (reduced) => {
      mocks.reducedMotion = reduced;
      mocks.skillItems = [
        {
          value: `registry://global/skills/${'a'.repeat(64)}`,
          label: 'Fixture research',
          source: 'global_configuration',
          availability: 'available',
        },
      ];
      render(
        <WorkspaceConfigurationEditor
          presentation="settings"
          spaceId="space-1"
        />
      );
      const opener = screen.getByRole('button', { name: 'Add skill' });
      opener.focus();
      fireEvent.click(opener);
      const panel = screen.getByRole('complementary', { name: 'Add skill' });
      const field = within(panel).getByRole('combobox', {
        name: 'Skill reference',
      });
      expect(field).toHaveFocus();
      fireEvent.keyDown(field, { key: 'ArrowDown' });
      const option = await screen.findByRole('option', {
        name: /Fixture research/,
      });
      fireEvent.keyDown(option, { key: 'Escape' });
      await waitFor(() =>
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      );
      expect(panel).not.toHaveAttribute('aria-hidden');
      await waitFor(() => expect(field).toHaveFocus());
      fireEvent.keyDown(field, { key: 'Escape' });
      expect(opener).toHaveFocus();
      expect(panel).toHaveAttribute('inert');
      expect(panel).toHaveAttribute('aria-hidden', 'true');
      expect(mocks.setDocument).not.toHaveBeenCalled();
    }
  );

  it('does not restore an old account opener when identity changes', () => {
    const view = render(
      <WorkspaceConfigurationEditor presentation="settings" spaceId="space-1" />
    );
    const opener = screen.getByRole('button', { name: 'Add skill' });
    opener.focus();
    fireEvent.click(opener);
    const panel = screen.getByRole('complementary', { name: 'Add skill' });
    expect(panel).toContainElement(document.activeElement as HTMLElement);
    mocks.identity = { email: 'other@example.com', user_id: 8 };
    view.rerender(
      <WorkspaceConfigurationEditor presentation="settings" spaceId="space-1" />
    );
    expect(opener).not.toHaveFocus();
    expect(panel).toHaveAttribute('aria-hidden', 'true');
  });

  it('restores the section Add button after deleting the edited resource', () => {
    render(
      <WorkspaceConfigurationEditor presentation="settings" spaceId="space-1" />
    );
    const opener = screen.getByRole('button', {
      name: 'Edit coordinator instructions',
    });
    opener.focus();
    fireEvent.click(opener);
    const panel = screen.getByRole('complementary', {
      name: 'Edit instruction',
    });
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Delete instruction' })
    );
    expect(
      screen.getByRole('button', { name: 'Add instruction' })
    ).toHaveFocus();
    expect(panel).toHaveAttribute('aria-hidden', 'true');
  });

  it('restores the opener when a new resource is saved', () => {
    render(
      <WorkspaceConfigurationEditor presentation="settings" spaceId="space-1" />
    );
    const opener = screen.getByRole('button', { name: 'Add instruction' });
    opener.focus();
    fireEvent.click(opener);
    const panel = screen.getByRole('complementary', {
      name: 'Add instruction',
    });
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }));
    expect(mocks.setDocument).toHaveBeenCalledOnce();
    expect(opener).toHaveFocus();
    expect(panel).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps panel height within its anchor and scroll clip when the window or layout changes', () => {
    vi.stubGlobal('innerHeight', 500);
    vi.stubGlobal('visualViewport', undefined);
    let anchorTop = 144;
    let clipBottom = 450;
    let resizePanel = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      vi.fn().mockImplementation((callback: () => void) => ({
        observe: (element: HTMLElement) => {
          if (element.hasAttribute('data-workspace-resource-panel-anchor')) {
            resizePanel = callback;
          }
        },
        unobserve: vi.fn(),
        disconnect,
      }))
    );
    const rectangle = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this.hasAttribute('data-workspace-resource-panel-anchor')) {
          return new DOMRect(0, anchorTop, 720, 0);
        }
        if (this.hasAttribute('data-test-scroll-clip')) {
          return new DOMRect(0, 0, 720, clipBottom);
        }
        // An animated panel can report a different rectangle from its anchor.
        return new DOMRect(0, 200, 720, 900);
      });
    restoreRectangle = () => rectangle.mockRestore();
    const view = render(
      <div data-test-scroll-clip style={{ overflowY: 'auto' }}>
        <WorkspaceConfigurationEditor
          presentation="settings"
          spaceId="space-1"
        />
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add connector' }));
    const panel = screen.getByRole('complementary', { name: 'Add connector' });
    const availableHeight = () =>
      panel.style.getPropertyValue('--ds-resource-editor-available-height');
    expect(availableHeight()).toBe('306px');
    expect(panel.style.maxHeight).toContain('--ds-space-panel-inset');
    expect(panel.style.minHeight).toBe(`min(80dvh, ${panel.style.maxHeight})`);
    expect(panel.querySelector('footer')).toHaveClass('shrink-0');

    vi.stubGlobal('innerHeight', 400);
    fireEvent.resize(window);
    expect(availableHeight()).toBe('256px');
    anchorTop = 96;
    fireEvent.scroll(view.container.firstElementChild!);
    expect(availableHeight()).toBe('304px');
    clipBottom = 350;
    act(() => resizePanel());
    expect(availableHeight()).toBe('254px');
    view.unmount();
    expect(disconnect).toHaveBeenCalled();
    vi.stubGlobal('innerHeight', 300);
    fireEvent.resize(window);
    expect(availableHeight()).toBe('254px');
  });

  it('tracks a smaller visual viewport without refocusing the editor', () => {
    const viewport = Object.assign(new EventTarget(), {
      offsetTop: 0,
      height: 500,
    });
    vi.stubGlobal('visualViewport', viewport);
    const rectangle = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 144, 720, 0));
    restoreRectangle = () => rectangle.mockRestore();
    render(
      <WorkspaceConfigurationEditor presentation="settings" spaceId="space-1" />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add connector' }));
    const panel = screen.getByRole('complementary', { name: 'Add connector' });
    const close = within(panel).getByRole('button', { name: 'Close editor' });
    close.focus();
    viewport.height = 400;
    viewport.dispatchEvent(new Event('resize'));
    expect(
      panel.style.getPropertyValue('--ds-resource-editor-available-height')
    ).toBe('256px');
    viewport.offsetTop = 30;
    viewport.dispatchEvent(new Event('scroll'));
    expect(
      panel.style.getPropertyValue('--ds-resource-editor-available-height')
    ).toBe('286px');
    expect(close).toHaveFocus();
  });

  it('selects a concrete model reference through the model dropdown without changing thinking effort', async () => {
    mocks.modelItems = [
      {
        value: 'provider://cloud/fixture',
        label: 'Fixture Cloud',
        source: 'cloud_catalog',
        availability: 'available',
      },
      {
        value: 'provider://custom/azure/missing',
        label: 'Missing custom model',
        source: 'custom_catalog',
        availability: 'requires_setup',
        disabled: true,
        reason: 'model_unavailable',
      },
    ];
    const { container } = render(
      <WorkspaceConfigurationEditor presentation="settings" spaceId="space-1" />
    );
    const section = within(
      container.querySelector('#space-settings-model') as HTMLElement
    );
    const trigger = section.getByRole('combobox', {
      name: 'default model reference',
    });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const missing = await screen.findByRole('option', {
      name: /Missing custom model/,
    });
    expect(missing).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('option', { name: /Fixture Cloud/ }));
    expect(
      mocks.setDocument.mock.calls.at(-1)?.[0](mocks.document).spec.models
        .default.modelRef
    ).toBe('provider://cloud/fixture');
    expect(
      mocks.setDocument.mock.calls.at(-1)?.[0](mocks.document).spec.models
        .default.thinkingEffort
    ).toBe('medium');
    expect(
      section.getByText(/Multiple bundle agents are not supported/)
    ).toBeInTheDocument();
  });

  it('registers pending changes with the shared navigation guard', async () => {
    mocks.hasPendingChanges = true;
    const { unmount } = render(
      <WorkspaceConfigurationEditor presentation="settings" spaceId="space-1" />
    );

    await waitFor(() =>
      expect(hasPendingWorkspaceConfigurationChanges()).toBe(true)
    );
    await expect(flushWorkspaceConfigurationBeforeNavigation()).resolves.toBe(
      true
    );
    expect(mocks.flushSave).toHaveBeenCalledTimes(1);

    unmount();
    expect(hasPendingWorkspaceConfigurationChanges()).toBe(false);
  });

  it('removes animated section travel when reduced motion is requested', () => {
    mocks.reducedMotion = true;
    const { container } = render(
      <WorkspaceConfigurationEditor presentation="settings" spaceId="space-1" />
    );
    const modelSection = container.querySelector(
      '#space-settings-model'
    ) as HTMLElement;
    const scrollIntoView = vi.fn();
    modelSection.scrollIntoView = scrollIntoView;

    fireEvent.click(screen.getByRole('button', { name: 'Model' }));

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'start',
    });
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
    expect(settingsGroups).toHaveLength(11);
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
    ).toHaveLength(11);
    expect(
      within(modelSection as HTMLElement).getByRole('button', {
        name: 'Add profile',
      })
    ).toBeInTheDocument();
    expect(
      within(modelSection as HTMLElement).getByLabelText(
        'default model reference'
      )
    ).toHaveTextContent('provider://default');
    expect(container.querySelector('select')).toBeNull();
    expect(
      container.querySelector('[data-workspace-configuration-width]')
    ).toHaveClass('w-full');
    expect(
      container.querySelector('[data-workspace-configuration-width]')
    ).not.toHaveClass('max-w-5xl');
  });

  it('keeps only tabs in the profile rail and groups version status with Profile sharing', async () => {
    const { container } = render(
      <WorkspaceConfigurationEditor presentation="settings" spaceId="space-1" />
    );

    const profileRail = screen.getByRole('complementary', {
      name: 'Space settings navigation',
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
    const profileStatusSection = container.querySelector(
      '[data-workspace-profile-status-section]'
    ) as HTMLElement;
    const profileStatusGroup = within(profileStatusSection).getByTestId(
      'profile-status-settings-group'
    );
    const scrollIntoView = vi.fn();
    modelSection.scrollIntoView = scrollIntoView;

    expect(profileRail).toHaveClass('md:w-[180px]', 'md:sticky');
    expect(profileRail.children).toHaveLength(1);
    expect(profileRail.firstElementChild).toBe(contents);
    expect(within(profileRail).queryByText('Profile')).not.toBeInTheDocument();
    expect(
      within(profileRail).queryByText('Research Bundle')
    ).not.toBeInTheDocument();
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
      within(profileRail).queryByRole('button', {
        name: 'Share Space profile',
      })
    ).not.toBeInTheDocument();
    expect(within(contents).getAllByRole('button')).toHaveLength(9);
    expect(within(contents).queryByRole('link')).not.toBeInTheDocument();
    const expectedTabCounts = {
      'space-settings-environment': '0',
      'space-settings-instructions': '1',
      'space-settings-context': '0',
      'space-settings-agents': '0',
      'space-settings-skills': '0',
      'space-settings-connectors': '0',
      'space-settings-mcp-servers': '0',
    };
    Object.entries(expectedTabCounts).forEach(([sectionId, count]) => {
      expect(
        contents.querySelector(
          `[data-workspace-settings-tab-count="${sectionId}"]`
        )
      ).toHaveTextContent(count);
    });
    expect(
      contents.querySelector(
        '[data-workspace-settings-tab-count="space-settings-identity"]'
      )
    ).toBeNull();
    expect(
      contents.querySelector(
        '[data-workspace-settings-tab-count="space-settings-model"]'
      )
    ).toBeNull();
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
    expect(
      identityGroup.querySelectorAll('[data-workspace-setting-row]')
    ).toHaveLength(4);
    expect(
      identityGroup.querySelectorAll('[data-settings-row-divider]')
    ).toHaveLength(3);
    expect(
      profileStatusGroup.querySelectorAll('[data-workspace-setting-row]')
    ).toHaveLength(2);
    expect(
      profileStatusGroup.querySelectorAll('[data-settings-row-divider]')
    ).toHaveLength(1);
    const profileRow = within(profileStatusGroup)
      .getByText('Profile')
      .closest('[data-workspace-setting-row]');
    const versionRow = within(profileStatusGroup)
      .getByText('Draft version 1')
      .closest('[data-workspace-setting-row]');
    expect(versionRow).toHaveTextContent('Draft version 1');
    expect(versionRow).toHaveTextContent('Saved');
    expect(profileRow).toHaveTextContent('Profile');
    expect(profileRow).not.toHaveTextContent('Research Bundle');
    expect(profileRow).toContainElement(
      within(profileStatusGroup).getByRole('button', {
        name: 'Share Space profile',
      })
    );
    expect(
      profileStatusSection.compareDocumentPosition(identitySection) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(within(identityGroup).queryByText('Profile')).toBeNull();
    expect(
      versionRow!.compareDocumentPosition(profileRow!) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      within(identityGroup).getByText('Profile name').parentElement
    ).toHaveClass('flex-col');
    expect(
      within(identityGroup).getByText(
        'Shown to collaborators and people who receive this profile.'
      )
    ).toBeInTheDocument();
    const bundleNameInput =
      within(identitySection).getByLabelText('Profile name');
    const permissionSelect = within(identitySection).getByRole('combobox', {
      name: 'Approval mode',
    });
    const remotePolicySelect = within(identitySection).getByRole('combobox', {
      name: 'Remote policy',
    });
    expect(bundleNameInput).toHaveValue('Research Bundle');
    expect(bundleNameInput.parentElement).toHaveClass(
      'bg-ds-neutral-subtle-default'
    );
    expect(permissionSelect).toHaveClass('bg-ds-neutral-subtle-default');
    expect(remotePolicySelect).toHaveClass('bg-ds-neutral-subtle-default');
    expect(
      within(identitySection).getByRole('switch', {
        name: 'Track this Space in Git',
      })
    ).toBeChecked();
    expect(remotePolicySelect).toBeInTheDocument();

    const environmentSection = container.querySelector(
      '#space-settings-environment'
    ) as HTMLElement;
    const environmentRows = environmentSection.querySelectorAll(
      ':scope > [data-settings-row-group] > [data-settings-row]'
    );
    expect(environmentRows).toHaveLength(2);
    expect(environmentRows[0]).toContainElement(
      within(environmentSection).getByRole('button', { name: 'Add variable' })
    );
    expect(environmentRows[1]).toHaveTextContent('Environment variables');
    expect(
      environmentRows[1].querySelector('[data-workspace-collection-count]')
    ).toHaveTextContent('0');
    expect(environmentRows[1]).toHaveTextContent(
      'No environment variables are required.'
    );
    expect(
      within(environmentSection).getByRole('button', {
        name: 'Environment variables actions',
      })
    ).toBeDisabled();
    expect(
      environmentSection.querySelectorAll('[data-settings-row-divider]')
    ).toHaveLength(1);

    const collectionSections = {
      'space-settings-environment': 'Environment variables actions',
      'space-settings-instructions': 'Instruction assets actions',
      'space-settings-context': 'Context items actions',
      'space-settings-agents': 'Configured agents actions',
      'space-settings-skills': 'Assigned skills actions',
      'space-settings-connectors': 'Connector requirements actions',
      'space-settings-mcp-servers': 'Configured MCP servers actions',
    };
    Object.entries(collectionSections).forEach(([sectionId, actionLabel]) => {
      const section = container.querySelector(`#${sectionId}`) as HTMLElement;
      expect(
        section.querySelectorAll(
          ':scope > [data-settings-row-group] > [data-settings-row]'
        )
      ).toHaveLength(2);
      expect(
        section.querySelectorAll('[data-settings-row-divider]')
      ).toHaveLength(1);
      expect(
        within(section).getByRole('button', { name: actionLabel })
      ).toBeInTheDocument();
    });

    const instructionsSection = container.querySelector(
      '#space-settings-instructions'
    ) as HTMLElement;
    const instructionItem = instructionsSection.querySelector(
      '[data-workspace-resource-list-item]'
    ) as HTMLElement;
    expect(instructionItem).toHaveClass(
      'w-full',
      'bg-ds-neutral-subtle-default'
    );
    expect(
      instructionItem.querySelector('[data-workspace-collection-index]')
    ).toBeNull();
    expect(within(instructionsSection).queryByText('Instruction 1')).toBeNull();
    expect(
      within(instructionsSection).queryByText(
        'Instruction assets assigned to workforce roles.'
      )
    ).toBeNull();
    expect(within(instructionItem).getByText('Coordinator')).toBeVisible();
    expect(
      within(instructionItem).queryByDisplayValue('coordinator')
    ).toBeNull();
    fireEvent.click(
      within(instructionItem).getByRole('button', {
        name: 'Edit coordinator instructions',
      })
    );
    const editorPanel = screen.getByRole('complementary', {
      name: 'Edit instruction',
    });
    expect(editorPanel).toHaveAttribute('data-workspace-resource-editor-panel');
    const settingsContent = container.querySelector(
      '[data-workspace-settings-content]'
    ) as HTMLElement;
    const panelAnchor = container.querySelector(
      '[data-workspace-resource-panel-anchor]'
    ) as HTMLElement;
    expect(settingsContent).toContainElement(panelAnchor);
    expect(panelAnchor).toContainElement(editorPanel);
    expect(panelAnchor).toHaveClass('sticky', 'h-0');
    expect(editorPanel).not.toHaveClass('fixed');
    expect(editorPanel).toHaveClass(
      'rounded-2xl',
      'shadow-xl',
      'md:w-1/2',
      'md:min-w-[420px]'
    );
    expect(editorPanel.querySelector('h1, h2, h3, h4, h5, h6, p')).toBeNull();
    const panelTitle = within(editorPanel).getByText('Edit instruction');
    expect(panelTitle.tagName).toBe('SPAN');
    expect(panelTitle).toHaveClass('text-ds-text-section');
    expect(panelTitle).not.toHaveClass('text-ds-text-display');
    expect(container.querySelector('main')).not.toHaveClass('sm:pr-[420px]');
    await waitFor(() =>
      expect(within(editorPanel).getByDisplayValue('coordinator')).toBeVisible()
    );
    expect(
      within(editorPanel).getByDisplayValue(
        'bundle://instructions/coordinator.md'
      )
    ).toBeVisible();
    const panelFooter = editorPanel.querySelector('footer') as HTMLElement;
    const footerButtons = within(panelFooter).getAllByRole('button');
    expect(footerButtons.map((button) => button.textContent)).toEqual([
      'Delete',
      'Cancel',
      'Save',
    ]);
    expect(
      panelFooter.querySelector('[data-workspace-resource-status-visual]')
    ).toHaveTextContent('Saved');
    expect(within(panelFooter).getByRole('status')).toHaveTextContent('Saved');
    fireEvent.click(
      within(editorPanel).getByRole('button', { name: 'Close editor' })
    );

    const agentsSection = container.querySelector(
      '#space-settings-agents'
    ) as HTMLElement;
    expect(within(agentsSection).getByText('Configured agents')).toBeVisible();
    expect(
      agentsSection.querySelector('[data-workspace-collection-count]')
    ).toHaveTextContent('0');
    expect(
      within(agentsSection).queryByText(
        'Workforce roles available in this Space.'
      )
    ).toBeNull();

    expect(
      within(instructionsSection).getByRole('button', {
        name: 'Instruction assets actions',
      })
    ).toBeVisible();
    expect(
      within(instructionsSection).queryByRole('button', { name: 'Delete all' })
    ).toBeNull();
  });

  it('creates and edits environment variables in the floating panel', async () => {
    mocks.document.spec.environment.variables.push({
      name: 'DEPLOY_ENV',
      required: true,
      sensitive: false,
      description: 'Deployment environment',
      example: 'staging',
    });

    const { container } = render(
      <WorkspaceConfigurationEditor presentation="settings" spaceId="space-1" />
    );
    const environmentSection = container.querySelector(
      '#space-settings-environment'
    ) as HTMLElement;

    expect(
      within(environmentSection).queryByDisplayValue('DEPLOY_ENV')
    ).toBeNull();
    fireEvent.click(
      within(environmentSection).getByRole('button', {
        name: 'Edit DEPLOY_ENV',
      })
    );

    let panel = screen.getByRole('complementary', {
      name: 'Edit environment variable',
    });
    await waitFor(() =>
      expect(within(panel).getByDisplayValue('DEPLOY_ENV')).toBeVisible()
    );
    expect(within(panel).getByDisplayValue('staging')).toBeVisible();
    fireEvent.click(
      within(panel).getByRole('switch', { name: 'Sensitive DEPLOY_ENV' })
    );
    expect(within(panel).queryByDisplayValue('staging')).toBeNull();
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Close editor' })
    );

    fireEvent.click(
      within(environmentSection).getByRole('button', { name: 'Add variable' })
    );
    panel = screen.getByRole('complementary', {
      name: 'Add environment variable',
    });
    await waitFor(() =>
      expect(within(panel).getByDisplayValue('ENV_VAR_1')).toBeVisible()
    );
    expect(
      within(panel).getByRole('switch', { name: 'Required ENV_VAR_1' })
    ).toBeChecked();
    expect(
      within(panel).getByRole('switch', { name: 'Sensitive ENV_VAR_1' })
    ).toBeChecked();
    expect(
      Array.from(
        panel.querySelectorAll('[data-workspace-resource-status-visual]')
      ).at(-1)
    ).toHaveTextContent('Not yet added');
    expect(within(panel).getByRole('status')).toHaveTextContent(
      'Not yet added'
    );
    expect(within(panel).queryByText('Not added yet')).toBeNull();
  });

  it('keeps panel exit mounted and exposes only the current status announcement', async () => {
    const { container, rerender } = render(
      <WorkspaceConfigurationEditor presentation="settings" spaceId="space-1" />
    );
    const instructionsSection = container.querySelector(
      '#space-settings-instructions'
    ) as HTMLElement;
    fireEvent.click(
      within(instructionsSection).getByRole('button', {
        name: 'Edit coordinator instructions',
      })
    );

    let panel = screen.getByRole('complementary', {
      name: 'Edit instruction',
    });
    expect(within(panel).getAllByRole('status')).toHaveLength(1);
    expect(within(panel).getByRole('status')).toHaveTextContent('Saved');

    mocks.saveState = 'saving';
    rerender(
      <WorkspaceConfigurationEditor presentation="settings" spaceId="space-1" />
    );
    panel = screen.getByRole('complementary', { name: 'Edit instruction' });
    expect(within(panel).getAllByRole('status')).toHaveLength(1);
    expect(within(panel).getByRole('status')).toHaveTextContent('Saving…');

    fireEvent.click(
      within(panel).getByRole('button', { name: 'Close editor' })
    );
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveAttribute('aria-hidden', 'true');
    await waitFor(() =>
      expect(
        screen.queryByRole('complementary', { name: 'Edit instruction' })
      ).not.toBeInTheDocument()
    );
  });

  it('reverses picker direction and removes panel travel for reduced motion', () => {
    mocks.reducedMotion = true;
    const { container } = render(
      <WorkspaceConfigurationEditor presentation="settings" spaceId="space-1" />
    );
    const contextSection = container.querySelector(
      '#space-settings-context'
    ) as HTMLElement;
    fireEvent.click(
      within(contextSection).getByRole('button', { name: 'Add context' })
    );

    const panel = screen.getByRole('complementary', { name: 'Add context' });
    expect(panel).toHaveAttribute('data-motion-reduced', 'true');
    expect(panel).toHaveStyle({ transform: 'translate3d(0, 0, 0)' });

    fireEvent.click(within(panel).getByRole('button', { name: 'Inline text' }));
    expect(
      panel.querySelector('[data-workspace-resource-content-step="editor"]')
    ).toHaveAttribute('data-workspace-resource-content-direction', 'forward');

    fireEvent.click(within(panel).getByRole('button', { name: 'Back' }));
    expect(
      panel.querySelector('[data-workspace-resource-content-step="picker"]')
    ).toHaveAttribute('data-workspace-resource-content-direction', 'back');
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

  it('opens direct resource dropdowns, cancels without writing, and commits the selected global skill', async () => {
    const { container } = render(
      <WorkspaceConfigurationEditor presentation="settings" spaceId="space-1" />
    );

    const pickerFlows = [
      {
        section: 'space-settings-context',
        addLabel: 'Add context',
        panelLabel: 'Add context',
        picker: 'context',
        field: null,
      },
      {
        section: 'space-settings-skills',
        addLabel: 'Add skill',
        panelLabel: 'Add skill',
        picker: 'skill',
        field: 'Skill reference',
      },
      {
        section: 'space-settings-connectors',
        addLabel: 'Add connector',
        panelLabel: 'Add connector',
        picker: 'connector',
        field: 'Connector',
      },
      {
        section: 'space-settings-mcp-servers',
        addLabel: 'Add MCP server',
        panelLabel: 'Add MCP server',
        picker: 'mcp',
        field: 'Definition',
      },
    ];

    pickerFlows.forEach(({ section, addLabel, panelLabel, picker, field }) => {
      const sectionElement = container.querySelector(`#${section}`)!;
      fireEvent.click(
        within(sectionElement as HTMLElement).getByRole('button', {
          name: addLabel,
        })
      );
      const panel = screen.getByRole('complementary', { name: panelLabel });
      expect(
        panel.querySelector(`[data-workspace-resource-picker="${picker}"]`)
      ).toBeInTheDocument();
      if (field) {
        expect(
          within(panel).getByRole('combobox', { name: field })
        ).toBeInTheDocument();
        expect(
          within(panel).queryByRole('button', { name: 'Enter manually' })
        ).toBeNull();
        expect(
          within(panel).queryByRole('button', {
            name: 'Browse available options',
          })
        ).toBeNull();
        expect(
          within(panel).queryByRole('button', { name: 'Back' })
        ).toBeNull();
      }
      fireEvent.click(
        within(panel).getByRole('button', { name: 'Close editor' })
      );
    });
    expect(mocks.setDocument).not.toHaveBeenCalled();

    const skillsSection = container.querySelector(
      '#space-settings-skills'
    ) as HTMLElement;
    fireEvent.click(
      within(skillsSection).getByRole('button', { name: 'Add skill' })
    );
    let panel = screen.getByRole('complementary', { name: 'Add skill' });
    const fixtureRef = `registry://global/skills/${'a'.repeat(64)}`;
    mocks.skillItems = [
      {
        value: fixtureRef,
        label: 'Fixture global skill',
        source: 'global_configuration',
        availability: 'available',
      },
      {
        value: `registry://global/skills/${'b'.repeat(64)}`,
        label: 'Other global skill',
        source: 'global_configuration',
        availability: 'available',
      },
    ];
    // Reopen to observe the current catalog; selecting remains a local draft.
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Close editor' })
    );
    fireEvent.click(
      within(skillsSection).getByRole('button', { name: 'Add skill' })
    );
    panel = screen.getByRole('complementary', { name: 'Add skill' });
    const trigger = within(panel).getByRole('combobox', {
      name: 'Skill reference',
    });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.click(
      await screen.findByRole('option', { name: /Fixture global skill/ })
    );
    expect(
      within(panel).getByRole('combobox', { name: 'Skill reference' })
    ).toHaveTextContent('Fixture global skill');
    expect(within(panel).queryByRole('button', { name: 'Back' })).toBeNull();
    expect(mocks.setDocument).not.toHaveBeenCalled();
    fireEvent.click(
      within(panel).getByRole('button', { name: 'Close editor' })
    );
    expect(mocks.setDocument).not.toHaveBeenCalled();
    fireEvent.click(
      within(skillsSection).getByRole('button', { name: 'Add skill' })
    );
    panel = screen.getByRole('complementary', { name: 'Add skill' });
    const reopenedTrigger = within(panel).getByRole('combobox', {
      name: 'Skill reference',
    });
    expect(reopenedTrigger).not.toHaveTextContent('Fixture global skill');
    reopenedTrigger.focus();
    fireEvent.keyDown(reopenedTrigger, { key: 'ArrowDown' });
    fireEvent.click(
      await screen.findByRole('option', { name: /Fixture global skill/ })
    );
    fireEvent.click(within(panel).getByRole('button', { name: 'Save' }));
    const addSkillUpdater = mocks.setDocument.mock.calls.at(-1)?.[0] as (
      current: typeof mocks.document
    ) => typeof mocks.document;
    expect(addSkillUpdater(mocks.document).spec.skills).toEqual([
      {
        ref: fixtureRef,
        assignTo: [],
      },
    ]);

    const agentsSection = container.querySelector(
      '#space-settings-agents'
    ) as HTMLElement;
    fireEvent.click(
      within(agentsSection).getByRole('button', { name: 'Add agent' })
    );
    panel = screen.getByRole('complementary', { name: 'Add agent' });
    await waitFor(() =>
      expect(panel.querySelector('[data-workspace-resource-picker]')).toBeNull()
    );
    expect(
      within(panel).getByRole('combobox', { name: 'Model profile' })
    ).toHaveTextContent('default');
  });
});
