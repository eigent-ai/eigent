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
import { useModelVisibilityStore } from '@/store/modelVisibilityStore';
import { useUsageNoticeStore } from '@/store/usageNoticeStore';
import { ThinkingEffort } from '@/types/constants';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  setProjectModel: vi.fn(),
  openSettings: vi.fn(),
  fetchCloudModels: vi.fn(),
  auth: {
    user_id: 1,
    email: '',
    modelType: 'cloud',
    cloud_model_type: 'gpt',
    codex_model_type: 'gpt',
    setModelType: vi.fn(),
    setCloudModelType: vi.fn(),
  },
  selection: null as null | {
    modelType: string;
    model_type?: string;
    model_platform?: string;
    cloud_model_type?: string;
    provider_id?: number;
  },
}));
vi.mock('@/api/http', () => ({
  proxyFetchGet: mocks.get,
  proxyFetchPost: mocks.post,
}));
vi.mock('@/store/authStore', () => ({
  useAuthStore: () => mocks.auth,
  getAuthStore: () => mocks.auth,
}));
vi.mock('@/store/cloudModelStore', () => ({
  useCloudModelStore: (selector: (state: unknown) => unknown) =>
    selector({
      models: [
        { id: 'gpt', display_name: 'GPT' },
        { id: 'claude', display_name: 'Claude', min_plan_key: 'plus' },
      ],
      fetchCloudModels: mocks.fetchCloudModels,
      getModelDisplayName: (id: string) => (id === 'gpt' ? 'GPT' : 'Claude'),
      getEffectiveModelId: (id: string) => id,
    }),
}));
vi.mock('@/host/createHost', () => ({ createHost: () => ({}) }));
vi.mock('@/store/projectRuntimeStore', () => ({
  useProjectRuntimeStore: (selector: (state: unknown) => unknown) =>
    selector({
      projects: { session: { metadata: { modelSelection: mocks.selection } } },
      setProjectModel: mocks.setProjectModel,
    }),
}));
vi.mock('@/store/spaceStore', () => ({
  useSpaceStore: (selector: (state: unknown) => unknown) =>
    selector({ projectIdIndex: {}, projectsBySpaceId: {} }),
}));
vi.mock('@/store/settingsStore', () => ({ openSettings: mocks.openSettings }));
const records = [
  {
    id: 1,
    provider_name: 'openai',
    model_type: 'work-model',
    api_key: 'test-a',
    is_valid: 2,
    prefer: true,
  },
  {
    id: 2,
    provider_name: 'openai',
    model_type: 'personal-model',
    api_key: 'test-b',
    is_valid: 2,
  },
  { id: 3, provider_name: 'ollama', model_type: 'local-model', is_valid: 2 },
  {
    id: 4,
    provider_name: 'anthropic',
    model_type: 'invalid-model',
    is_valid: 1,
  },
];
beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.selection = null;
  mocks.auth.modelType = 'cloud';
  mocks.get.mockResolvedValue({ items: records });
  mocks.post.mockResolvedValue({});
  useModelVisibilityStore.setState({ hiddenByAccount: {} });
  useUsageNoticeStore.setState({ subscription: { plan_key: 'free' } });
});
async function openRoot() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /select model/i }));
  await screen.findByRole('button', {
    name: 'Add more',
    exact: true,
  });
  return user;
}
async function open(selectedModel = 'GPT') {
  const user = await openRoot();
  const modelSubmenuTrigger = screen.getByRole('menuitem', {
    name: selectedModel,
  });
  await user.hover(modelSubmenuTrigger);
  await screen.findByRole('menuitemradio', { name: /personal-model/ });
  return user;
}
describe('Configured model input menu', () => {
  it('shows a single model list grouped by provider without unconfigured or invalid providers', async () => {
    render(
      <ModelAndThinkingEffortSelect thinkingEffort={ThinkingEffort.HIGH} />
    );
    const trigger = screen.getByRole('button', { name: /select model/i });
    expect(trigger).toHaveTextContent('GPT');
    expect(within(trigger).getByText('High')).toHaveClass(
      'text-ds-ink-muted-default'
    );
    expect(trigger).not.toHaveTextContent('|');
    expect(trigger.querySelector('svg')).toBeNull();
    await open();
    expect(screen.getByRole('group', { name: 'Eigent' })).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'OpenAI' }).querySelector('img[alt=""]')
    ).toHaveClass('size-ds-16');
    expect(screen.queryByText('Claude')).not.toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'OpenAI' })).getAllByRole(
        'menuitemradio'
      )
    ).toHaveLength(2);
    expect(
      within(screen.getByRole('group', { name: 'OpenAI' })).getByRole(
        'menuitemradio',
        { name: 'personal-model' }
      )
    ).toHaveTextContent('personal-model');
    expect(
      screen.queryByText('OpenAI | personal-model')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('invalid-model')).not.toBeInTheDocument();
    expect(screen.queryByText('Custom')).not.toBeInTheDocument();
    expect(screen.queryByText('Anthropic')).not.toBeInTheDocument();
    expect(
      within(screen.getAllByRole('menu')[1]).getAllByRole('separator')
    ).toHaveLength(2);
  });
  it('does not override the model submenu anchor with a visual translation', async () => {
    render(
      <ModelAndThinkingEffortSelect thinkingEffort={ThinkingEffort.HIGH} />
    );
    await open();
    const [modelMenu, modelSubmenu] = screen.getAllByRole('menu');
    expect(modelMenu).toHaveClass('w-[280px]');
    expect(modelSubmenu).toHaveClass('w-max');
    expect(modelSubmenu).not.toHaveClass('min-w-[280px]');
    expect(modelSubmenu.style.translate).toBe('');
  });
  it('updates a Session with the exact record without changing the global default or effort', async () => {
    const effort = vi.fn();
    render(
      <ModelAndThinkingEffortSelect
        projectId="session"
        thinkingEffort={ThinkingEffort.HIGH}
        onThinkingEffortChange={effort}
      />
    );
    await open();
    fireEvent.click(
      screen.getByRole('menuitemradio', { name: /personal-model/ })
    );
    expect(mocks.setProjectModel).toHaveBeenCalledWith('session', {
      modelType: 'custom',
      provider_id: 2,
      model_platform: 'openai',
      model_type: 'personal-model',
    });
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.auth.setModelType).not.toHaveBeenCalled();
    expect(effort).not.toHaveBeenCalled();
  });
  it('updates the home default by saved record ID', async () => {
    render(<ModelAndThinkingEffortSelect thinkingEffort={undefined} />);
    await open();
    fireEvent.click(
      screen.getByRole('menuitemradio', { name: /personal-model/ })
    );
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith('/api/v1/provider/prefer', {
        provider_id: 2,
      })
    );
    expect(mocks.auth.setModelType).toHaveBeenCalledWith('custom');
  });
  it('changes effort independently of the selected model', async () => {
    const onChange = vi.fn();
    render(
      <ModelAndThinkingEffortSelect
        thinkingEffort={undefined}
        onThinkingEffortChange={onChange}
      />
    );
    await openRoot();
    const slider = screen.getByRole('slider', { name: 'Thinking effort' });
    expect(slider).toHaveAttribute('aria-valuetext', 'Default');
    fireEvent.change(slider, { target: { value: '3' } });
    expect(onChange).toHaveBeenCalledWith(ThinkingEffort.XHIGH);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.setProjectModel).not.toHaveBeenCalled();
  });
  it('shows the selected effort in the header and resets to inheritance', async () => {
    const onChange = vi.fn();
    render(
      <ModelAndThinkingEffortSelect
        thinkingEffort={ThinkingEffort.XHIGH}
        onThinkingEffortChange={onChange}
      />
    );
    const user = await openRoot();
    const slider = screen.getByRole('slider', { name: 'Thinking effort' });
    expect(slider).toHaveAttribute('min', '0');
    expect(slider).toHaveAttribute('max', '4');
    expect(slider).toHaveValue('3');
    expect(screen.getByText('Thinking effort: Extra High')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
  it('grows the effort thumb from Low to the existing maximum size', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ModelAndThinkingEffortSelect
        thinkingEffort={ThinkingEffort.LOW}
        onThinkingEffortChange={onChange}
      />
    );
    await openRoot();
    const slider = screen.getByRole('slider', { name: 'Thinking effort' });
    const thumb = slider.parentElement?.querySelector('span[aria-hidden]');
    expect(thumb).toHaveClass('size-ds-16');

    rerender(
      <ModelAndThinkingEffortSelect
        thinkingEffort={ThinkingEffort.MAX}
        onThinkingEffortChange={onChange}
      />
    );
    expect(thumb).toHaveClass('size-ds-control-md');
  });
  it('uses the intended track and marker surface tokens', async () => {
    const onChange = vi.fn();
    render(
      <ModelAndThinkingEffortSelect
        thinkingEffort={ThinkingEffort.HIGH}
        onThinkingEffortChange={onChange}
      />
    );
    await openRoot();
    const slider = screen.getByRole('slider', { name: 'Thinking effort' });
    const track = slider.parentElement?.querySelector('svg > path');
    const selectedTrack = slider.parentElement?.querySelector('svg > rect');
    const markers = slider.parentElement?.querySelectorAll(
      'div[aria-hidden] span'
    );
    expect(track).toHaveClass('fill-ds-bg-neutral-default-default');
    expect(selectedTrack).toHaveClass('fill-ds-accent-strong-default');
    expect(markers).toHaveLength(5);
    markers?.forEach((marker) => {
      expect(marker).toHaveClass('bg-ds-neutral-subtle-default');
      expect(marker).not.toHaveClass('bg-ds-ink-inverse');
    });
  });
  it('checks only the pinned record when the provider has several configurations', async () => {
    mocks.selection = {
      modelType: 'custom',
      provider_id: 2,
      model_platform: 'openai',
      model_type: 'personal-model',
    };
    render(
      <ModelAndThinkingEffortSelect
        projectId="session"
        thinkingEffort={undefined}
      />
    );
    await open('personal-model');
    expect(
      screen.getByRole('menuitemradio', { name: /personal-model/ })
    ).toHaveAttribute('aria-checked', 'true');
    expect(
      screen.getByRole('menuitemradio', { name: /work-model/ })
    ).toHaveAttribute('aria-checked', 'false');
  });
  it.each(['custom', 'local'])(
    'never substitutes the first %s record for an absent pinned configuration',
    async (modelType) => {
      mocks.selection = {
        modelType,
        model_type: 'removed-model',
        provider_id: 999,
      };
      render(
        <ModelAndThinkingEffortSelect
          projectId="session"
          thinkingEffort={undefined}
        />
      );
      expect(
        screen.getByRole('button', { name: /select model/i })
      ).toHaveTextContent('removed-model');
      await open('removed-model');
      expect(
        screen
          .getAllByRole('menuitemradio')
          .every((item) => item.getAttribute('aria-checked') === 'false')
      ).toBe(true);
    }
  );
  it('hides Eigent choices while preserving the name of a pinned hidden model', async () => {
    useModelVisibilityStore.setState({ hiddenByAccount: { '1': ['claude'] } });
    mocks.selection = { modelType: 'cloud', cloud_model_type: 'claude' };
    render(
      <ModelAndThinkingEffortSelect
        projectId="session"
        thinkingEffort={undefined}
      />
    );
    expect(
      screen.getByRole('button', { name: /select model/i })
    ).toHaveTextContent('Claude');
    await open('Claude');
    expect(
      screen.queryByRole('menuitemradio', { name: 'Claude' })
    ).not.toBeInTheDocument();
  });
  it('opens Models directly from the footer', async () => {
    render(<ModelAndThinkingEffortSelect thinkingEffort={undefined} />);
    const user = await openRoot();
    await user.click(
      screen.getByRole('button', { name: 'Add more', exact: true })
    );
    expect(mocks.openSettings).toHaveBeenCalledWith('models');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(
      screen.getByRole('button', { name: /select model/i })
    ).toHaveAttribute('data-state', 'closed');
  });
  it('keeps read-only sessions non-interactive', async () => {
    render(
      <ModelAndThinkingEffortSelect
        thinkingEffort={ThinkingEffort.LOW}
        readOnly
      />
    );
    await waitFor(() => expect(screen.getByText('GPT')).toBeInTheDocument());
    expect(screen.getByText('Low')).toHaveClass('text-ds-ink-muted-default');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
