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

import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelTypeCombobox } from '../../../src/components/ModelTypeCombobox';

const mockFetchPost = vi.fn();

vi.mock('@/api/http', () => ({
  fetchPost: (...args: any[]) => mockFetchPost(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Capture props passed to Combobox so we can assert on them
let lastComboboxProps: any = {};
vi.mock('@/components/ui/combobox', () => ({
  Combobox: (props: any) => {
    lastComboboxProps = props;
    return (
      <div data-testid="combobox">
        <div data-testid="options-count">{props.options.length}</div>
        <div data-testid="loading">{String(props.loading)}</div>
        <div data-testid="value">{props.value}</div>
        {props.note && <div data-testid="note">{props.note}</div>}
        {props.state && <div data-testid="state">{props.state}</div>}
      </div>
    );
  },
}));

const SUCCESS_RESPONSE = {
  model_types: ['gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
};

describe('ModelTypeCombobox', () => {
  const onValueChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    lastComboboxProps = {};
    // Reset module-level cache between tests by re-importing would require
    // vi.resetModules() — instead we use different platforms per test to avoid
    // cache collisions.
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls fetchPost with the platform on mount', async () => {
    mockFetchPost.mockResolvedValue(SUCCESS_RESPONSE);

    render(
      <ModelTypeCombobox
        platform="openai"
        value=""
        onValueChange={onValueChange}
      />
    );

    await waitFor(() => {
      expect(mockFetchPost).toHaveBeenCalledWith('/model/types', {
        platform: 'openai',
      });
    });
  });

  it('populates options after successful fetch', async () => {
    mockFetchPost.mockResolvedValue(SUCCESS_RESPONSE);

    const { getByTestId } = render(
      <ModelTypeCombobox
        platform="anthropic"
        value=""
        onValueChange={onValueChange}
      />
    );

    await waitFor(() => {
      expect(getByTestId('options-count')).toHaveTextContent('3');
    });
  });

  it('shows loading=true while fetching', async () => {
    let resolve: (v: any) => void;
    mockFetchPost.mockReturnValue(new Promise((r) => (resolve = r)));

    const { getByTestId } = render(
      <ModelTypeCombobox
        platform="gemini"
        value=""
        onValueChange={onValueChange}
      />
    );

    expect(getByTestId('loading')).toHaveTextContent('true');
    resolve!(SUCCESS_RESPONSE);
    await waitFor(() => {
      expect(getByTestId('loading')).toHaveTextContent('false');
    });
  });

  it('does not fetch when platform is empty', () => {
    render(
      <ModelTypeCombobox platform="" value="" onValueChange={onValueChange} />
    );
    expect(mockFetchPost).not.toHaveBeenCalled();
  });

  it('shows empty options and loading=false on fetch error', async () => {
    mockFetchPost.mockRejectedValue(new Error('network error'));

    const { getByTestId } = render(
      <ModelTypeCombobox
        platform="deepseek"
        value=""
        onValueChange={onValueChange}
      />
    );

    await waitFor(() => {
      expect(getByTestId('loading')).toHaveTextContent('false');
      expect(getByTestId('options-count')).toHaveTextContent('0');
    });
  });

  it('passes error prop as note and state=error to Combobox', () => {
    mockFetchPost.mockResolvedValue(SUCCESS_RESPONSE);

    const { getByTestId } = render(
      <ModelTypeCombobox
        platform="qwen"
        value=""
        onValueChange={onValueChange}
        error="Model type is required"
      />
    );

    expect(getByTestId('note')).toHaveTextContent('Model type is required');
    expect(getByTestId('state')).toHaveTextContent('error');
  });

  it('passes value through to Combobox', () => {
    mockFetchPost.mockResolvedValue(SUCCESS_RESPONSE);

    const { getByTestId } = render(
      <ModelTypeCombobox
        platform="azure"
        value="gpt-4o"
        onValueChange={onValueChange}
      />
    );

    expect(getByTestId('value')).toHaveTextContent('gpt-4o');
  });

  it('sets allowCustomValue=true on Combobox', () => {
    mockFetchPost.mockResolvedValue(SUCCESS_RESPONSE);

    render(
      <ModelTypeCombobox
        platform="moonshot"
        value=""
        onValueChange={onValueChange}
      />
    );

    expect(lastComboboxProps.allowCustomValue).toBe(true);
  });
});
