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

import { ProviderModelCombobox } from '@/components/Settings/Models/components/ProviderModelCombobox';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

const props = {
  providerName: 'Ant Ling',
  title: 'Model type',
  value: '',
  onChange: vi.fn(),
  groups: [],
  loading: false,
  error: null,
  disabled: true,
  onRefresh: vi.fn(),
};
const hint =
  'Enter your API key, click Refresh, then select a model from the dropdown.';

describe('ProviderModelCombobox', () => {
  it('explains the disabled select before and after entering a key', () => {
    const { rerender } = render(<ProviderModelCombobox {...props} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('combobox')).toHaveAccessibleDescription(hint);
    expect(
      screen.getByRole('button', { name: 'Refresh Ant Ling models' })
    ).toBeDisabled();
    rerender(<ProviderModelCombobox {...props} disabled={false} />);
    expect(screen.getByRole('combobox')).toBeDisabled();
    expect(screen.getByRole('combobox')).toHaveAccessibleDescription(hint);
    expect(
      screen.getByRole('button', { name: 'Refresh Ant Ling models' })
    ).toBeEnabled();
  });

  it('shows disabled guidance on hover and keyboard focus', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ProviderModelCombobox {...props} />);
    await user.hover(
      screen.getByRole('group', { name: 'Ant Ling model type' })
    );
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Add API key to load model type'
    );
    await user.unhover(screen.getByRole('group'));
    await user.tab();
    expect(screen.getByRole('group')).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Add API key to load model type'
    );
    rerender(<ProviderModelCombobox {...props} disabled={false} />);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Click refresh to load models.'
    );
    const fetchError =
      'Invalid API key. Check your API key and click Refresh again.';
    rerender(
      <ProviderModelCombobox
        {...props}
        disabled={false}
        fetchError={fetchError}
      />
    );
    expect(await screen.findByRole('tooltip')).toHaveTextContent(fetchError);
    expect(screen.getByRole('combobox')).toHaveAccessibleDescription(
      fetchError
    );
    const feedbackId = screen
      .getByRole('combobox')
      .getAttribute('aria-describedby')!;
    expect(
      within(document.getElementById(feedbackId)!).getByText(fetchError)
    ).toHaveClass('text-ds-text-error-default-default');
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    // Editing or retrying clears the error and restores the relevant guidance.
    rerender(<ProviderModelCombobox {...props} disabled={false} />);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Click refresh to load models.'
    );
    rerender(
      <ProviderModelCombobox
        {...props}
        disabled={false}
        groups={[{ provider: 'other', models: [{ id: 'ling-chat' }] }]}
      />
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('shows loading and actionable errors outside the disabled dropdown', () => {
    const { rerender } = render(
      <ProviderModelCombobox {...props} disabled={false} loading />
    );
    expect(screen.getByRole('combobox')).toHaveAccessibleDescription(
      'Loading models...'
    );
    expect(screen.getByRole('button')).toBeDisabled();
    const error =
      'Invalid API key. Check your API key and click Refresh again.';
    rerender(
      <ProviderModelCombobox {...props} disabled={false} error={error} />
    );
    expect(screen.getByRole('combobox')).toHaveAccessibleDescription(error);
    expect(screen.getByRole('combobox')).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(screen.getByRole('button')).toBeEnabled();
  });

  it('enables model selection after refresh and preserves a saved model without a list', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <ProviderModelCombobox
        {...props}
        disabled={false}
        onChange={onChange}
        groups={[{ provider: 'other', models: [{ id: 'ling-chat' }] }]}
      />
    );
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'ling-chat' }));
    expect(onChange).toHaveBeenCalledWith('ling-chat');
    rerender(
      <ProviderModelCombobox {...props} disabled={false} value="saved-model" />
    );
    expect(screen.getByRole('combobox')).toBeEnabled();
    expect(screen.getByRole('combobox')).toHaveTextContent('saved-model');
  });
});
