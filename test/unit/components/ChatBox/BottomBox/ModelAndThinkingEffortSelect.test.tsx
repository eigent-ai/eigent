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

import { ModelAndThinkingEffortSelect } from '@/components/ChatBox/BottomBox/ModelAndThinkingEffortSelect';
import { ThinkingEffort } from '@/types/constants';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  proxyFetchGet: vi.fn(),
  fetchCloudModels: vi.fn(),
  setProjectModel: vi.fn(),
  authState: {
    modelType: 'cloud',
    cloud_model_type: 'gpt-5.5',
    codex_model_type: 'gpt-5.5',
    email: '',
    appearance: 'light',
    setModelType: vi.fn(),
    setCloudModelType: vi.fn(),
  },
  runtimeState: {
    projects: {
      'project-1': {
        metadata: {
          modelSelection: {
            modelType: 'cloud',
            cloud_model_type: 'gpt-5.5',
          },
        },
      },
    },
    setProjectModel: vi.fn(),
  },
  spaceState: {
    projectIdIndex: {},
    projectsBySpaceId: {},
  },
}));

vi.mock('@/api/http', () => ({
  proxyFetchGet: mocks.proxyFetchGet,
}));

vi.mock('@/host/createHost', () => ({
  createHost: () => ({
    electronAPI: {
      codexSubscriptionStatus: vi
        .fn()
        .mockResolvedValue({ connected: false, status: 'not_connected' }),
    },
    ipcRenderer: {
      on: vi.fn(),
      off: vi.fn(),
    },
  }),
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: () => mocks.authState,
}));

vi.mock('@/store/cloudModelStore', () => ({
  useCloudModelStore: (selector: (state: unknown) => unknown) =>
    selector({
      models: [
        {
          id: 'gpt-5.5',
          display_name: 'GPT-5.5',
          model_type: 'gpt-5.5',
          model_platform: 'azure',
          provider_family: 'openai',
          kind: 'chat',
        },
      ],
      fetchCloudModels: mocks.fetchCloudModels,
      getModelDisplayName: (modelId: string) =>
        modelId === 'gpt-5.5' ? 'GPT-5.5' : modelId,
      getEffectiveModelId: (modelId: string) => modelId,
    }),
}));

vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: (selector: (state: unknown) => unknown) =>
    selector({
      ...mocks.runtimeState,
      setProjectModel: mocks.setProjectModel,
    }),
}));

vi.mock('@/store/spaceStore', () => ({
  useSpaceStore: (selector: (state: unknown) => unknown) =>
    selector(mocks.spaceState),
}));

describe('ModelAndThinkingEffortSelect', () => {
  beforeEach(() => {
    mocks.runtimeState.projects['project-1'].metadata.modelSelection = {
      modelType: 'cloud',
      cloud_model_type: 'gpt-5.5',
    };
    mocks.proxyFetchGet
      .mockReset()
      .mockReturnValue(new Promise(() => undefined));
    mocks.fetchCloudModels.mockReset().mockResolvedValue([]);
    mocks.setProjectModel.mockReset();
  });

  it('combines the requested effort and model sections in one menu', async () => {
    const user = userEvent.setup();
    const onThinkingEffortChange = vi.fn();
    render(
      <ModelAndThinkingEffortSelect
        projectId="project-1"
        thinkingEffort={undefined}
        onThinkingEffortChange={onThinkingEffortChange}
      />
    );

    const trigger = screen.getByRole('button', {
      name: 'Model: GPT-5.5; Thinking effort: Default',
    });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveTextContent(/GPT-5\.5\s*Default/);
    expect(trigger).not.toHaveTextContent('|');
    expect(within(trigger).getByText('Default')).toHaveClass(
      'text-ds-ink-muted-default'
    );
    expect(trigger).not.toHaveClass('min-w-56');

    await user.click(trigger);
    expect(trigger).toHaveClass('min-w-56');

    const menu = await screen.findByRole('menu');
    const thinkingLabel = within(menu).getByText('Thinking effort');
    const modelLabel = within(menu).getByText('Model');
    expect(thinkingLabel).toHaveClass('text-ds-text-meta');
    expect(modelLabel).toHaveClass('text-ds-text-meta');
    const menuText = menu.textContent ?? '';
    expect(menuText.indexOf('Thinking effort')).toBeLessThan(
      menuText.indexOf('Model')
    );

    const effortItems = within(menu).getAllByRole('menuitemradio');
    expect(effortItems).toHaveLength(6);
    const inheritedEffort = within(menu).getByRole('menuitemradio', {
      name: 'Default',
    });
    expect(inheritedEffort).toHaveAttribute('aria-checked', 'true');
    expect(inheritedEffort).toHaveClass(
      'h-ds-control-md',
      'min-h-ds-control-md',
      'py-0'
    );
    expect(inheritedEffort.lastElementChild).toHaveClass('ml-auto');
    expect(
      within(menu).getByRole('menuitemradio', { name: 'Low' })
    ).toBeVisible();
    expect(
      within(menu).getByRole('menuitemradio', { name: 'High' })
    ).toBeVisible();
    const mediumEffort = within(menu).getByRole('menuitemradio', {
      name: 'Medium',
    });
    expect(mediumEffort).toHaveAttribute('aria-checked', 'false');
    expect(mediumEffort).toHaveClass(
      'h-ds-control-md',
      'min-h-ds-control-md',
      'py-0'
    );
    expect(
      within(menu).getByRole('menuitemradio', { name: 'Extra High' })
    ).toBeVisible();
    expect(
      within(menu).getByRole('menuitemradio', { name: 'Max' })
    ).toBeVisible();
    expect(within(menu).getAllByRole('separator')).toHaveLength(1);

    const cloudModelTrigger = within(menu).getByRole('menuitem', {
      name: 'Eigent Cloud',
    });
    expect(cloudModelTrigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(cloudModelTrigger.firstElementChild).toHaveClass('size-ds-icon-lg');
    expect(cloudModelTrigger.querySelector('img')).toHaveClass(
      'size-ds-icon-lg'
    );
    const customModelItem = within(menu).getByRole('menuitem', {
      name: 'Custom model',
    });
    expect(customModelItem).toHaveAttribute('aria-haspopup', 'menu');
    expect(customModelItem).toHaveClass(
      'h-ds-control-md',
      'min-h-ds-control-md',
      'py-0'
    );
    expect(customModelItem.querySelector('.lucide-layers')).toHaveAttribute(
      'stroke-width',
      '2'
    );
    expect(customModelItem.firstElementChild).toHaveClass('size-ds-icon-lg');
    expect(customModelItem.lastElementChild).toHaveClass('ml-auto');
    const localModelItem = within(menu).getByRole('menuitem', {
      name: 'Local model',
    });
    expect(localModelItem).toHaveAttribute('aria-haspopup', 'menu');
    expect(localModelItem.firstElementChild).toHaveClass('size-ds-icon-lg');
    await user.hover(localModelItem);
    const localModelGroup = await screen.findByRole('group', {
      name: 'Local model',
    });
    expect(localModelGroup.parentElement).toHaveClass(
      'scrollbar-always-visible',
      'overflow-y-auto'
    );

    await user.click(mediumEffort);

    expect(onThinkingEffortChange).toHaveBeenCalledWith(ThinkingEffort.MEDIUM);
    expect(mocks.setProjectModel).not.toHaveBeenCalled();
  });

  it('keeps explicit Medium distinct from Bundle inheritance', async () => {
    const user = userEvent.setup();
    const onThinkingEffortChange = vi.fn();
    render(
      <ModelAndThinkingEffortSelect
        projectId="project-1"
        thinkingEffort={ThinkingEffort.MEDIUM}
        onThinkingEffortChange={onThinkingEffortChange}
      />
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Model: GPT-5.5; Thinking effort: Medium',
      })
    );

    const menu = await screen.findByRole('menu');
    expect(
      within(menu).getByRole('menuitemradio', { name: 'Medium' })
    ).toHaveAttribute('aria-checked', 'true');
    const inheritedEffort = within(menu).getByRole('menuitemradio', {
      name: 'Default',
    });
    expect(inheritedEffort).toHaveAttribute('aria-checked', 'false');

    await user.click(inheritedEffort);

    expect(onThinkingEffortChange).toHaveBeenCalledWith(undefined);
  });

  it('keeps the combined contextual name in read-only presentation', () => {
    render(
      <ModelAndThinkingEffortSelect
        projectId="project-1"
        thinkingEffort={ThinkingEffort.XHIGH}
        readOnly
      />
    );

    expect(
      screen.getByRole('status', {
        name: 'Model: GPT-5.5; Thinking effort: Extra High',
      })
    ).toBeInTheDocument();
  });

  it('keeps project-scoped model selection inside the merged menu', async () => {
    const user = userEvent.setup();
    render(
      <ModelAndThinkingEffortSelect
        projectId="project-1"
        thinkingEffort={ThinkingEffort.HIGH}
      />
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Model: GPT-5.5; Thinking effort: High',
      })
    );
    await user.hover(screen.getByRole('menuitem', { name: 'Eigent Cloud' }));
    const cloudModelGroup = await screen.findByRole('group', {
      name: 'Eigent Cloud',
    });
    expect(cloudModelGroup.parentElement).toHaveClass(
      'scrollbar-always-visible',
      'overflow-y-auto'
    );
    const cloudModelItem = await screen.findByRole('menuitemradio', {
      name: 'Configured GPT-5.5',
    });
    expect(cloudModelItem).toHaveAttribute('aria-checked', 'true');
    expect(cloudModelItem).toHaveClass(
      'h-ds-control-md',
      'min-h-ds-control-md',
      'py-0'
    );
    expect(cloudModelItem.firstElementChild).toHaveClass('size-ds-icon-lg');
    expect(
      within(cloudModelItem).getByRole('img', { name: 'Configured' })
    ).toHaveClass('bg-ds-text-success-default-default');
    expect(cloudModelItem.lastElementChild).toHaveClass(
      'ml-auto',
      'size-ds-icon-md'
    );
    expect(
      cloudModelItem.lastElementChild?.querySelector('.lucide-check')
    ).toBeInTheDocument();
    act(() => {
      fireEvent.pointerMove(cloudModelItem);
      cloudModelItem.focus();
    });
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(mocks.setProjectModel).toHaveBeenCalledWith('project-1', {
        modelType: 'cloud',
        cloud_model_type: 'gpt-5.5',
      });
    });
  });

  it('exposes custom-model selection and configuration status to assistive technology', async () => {
    const user = userEvent.setup();
    render(
      <ModelAndThinkingEffortSelect
        projectId="project-1"
        thinkingEffort={ThinkingEffort.HIGH}
      />
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Model: GPT-5.5; Thinking effort: High',
      })
    );
    await user.hover(screen.getByRole('menuitem', { name: 'Custom model' }));

    const customModelGroup = await screen.findByRole('group', {
      name: 'Custom model',
    });
    expect(customModelGroup.parentElement).toHaveClass(
      'scrollbar-always-visible',
      'overflow-y-auto'
    );
    const openAiItem = within(customModelGroup).getByRole('menuitemradio', {
      name: 'Not configured OpenAI',
    });
    expect(openAiItem).toHaveAttribute('aria-checked', 'false');
    expect(within(openAiItem).queryByText('Not configured')).toBeNull();
    expect(
      within(openAiItem).getByRole('img', { name: 'Not configured' })
    ).toHaveClass(
      'size-2',
      'rounded-full',
      'bg-ds-text-neutral-subtle-default',
      'opacity-10'
    );
    expect(openAiItem.firstElementChild).toHaveClass('size-ds-icon-lg');
    expect(openAiItem.lastElementChild).toHaveClass(
      'ml-auto',
      'size-ds-icon-md'
    );
    expect(openAiItem.querySelector('img')).toBeNull();
  });

  it('shows a green leading dot for configured custom models', async () => {
    mocks.proxyFetchGet.mockResolvedValue({
      items: [
        {
          id: 7,
          provider_name: 'openai',
          api_key: 'configured',
          endpoint_url: '',
          model_type: 'gpt-5.5',
          prefer: false,
        },
      ],
    });
    const user = userEvent.setup();
    render(
      <ModelAndThinkingEffortSelect
        projectId="project-1"
        thinkingEffort={ThinkingEffort.HIGH}
      />
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Model: GPT-5.5; Thinking effort: High',
      })
    );
    await user.hover(screen.getByRole('menuitem', { name: 'Custom model' }));

    const configuredItem = await screen.findByRole('menuitemradio', {
      name: 'Configured OpenAI',
    });
    expect(within(configuredItem).queryByText('Configured')).toBeNull();
    expect(
      within(configuredItem).getByRole('img', { name: 'Configured' })
    ).toHaveClass(
      'size-2',
      'rounded-full',
      'bg-ds-text-success-default-default'
    );
    expect(configuredItem.firstElementChild).toHaveClass('size-ds-icon-lg');
  });

  it.each([
    ['Custom model', 'custom'],
    ['Local model', 'local'],
  ])(
    'never ticks a %s row for a pin that carries no provider_id',
    async (submenu, pinnedModelType) => {
      mocks.runtimeState.projects['project-1'].metadata.modelSelection = {
        modelType: pinnedModelType,
        cloud_model_type: '',
      };
      mocks.proxyFetchGet.mockResolvedValue({ items: [] });
      const user = userEvent.setup();
      render(
        <ModelAndThinkingEffortSelect
          projectId="project-1"
          thinkingEffort={ThinkingEffort.HIGH}
        />
      );

      // Unconfigured providers all carry `provider_id: undefined`, so an
      // unguarded identity lookup ticks whichever row happens to be first.
      await user.click(
        screen.getByRole('button', { name: /Thinking effort: High$/ })
      );
      await user.hover(screen.getByRole('menuitem', { name: submenu }));
      const group = await screen.findByRole('group', { name: submenu });
      const rows = within(group).getAllByRole('menuitemradio');

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row).toHaveAttribute('aria-checked', 'false');
      }
    }
  );

  it('forwards its disabled state to the single combined trigger', async () => {
    render(
      <ModelAndThinkingEffortSelect
        projectId="project-1"
        thinkingEffort={ThinkingEffort.HIGH}
        disabled
      />
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', {
          name: 'Model: GPT-5.5; Thinking effort: High',
        })
      ).toBeDisabled();
    });
  });
});
