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

import { ExampleRecommendations } from '@/components/ExampleContent/ExampleRecommendations';
import { exampleRecommendationsFixture } from '@/components/ExampleContent/fixtures';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const messages = {
  heading: 'Examples',
  chooseExample: 'Use example',
  empty: 'No examples match.',
  disabled: 'Examples are disabled.',
  unavailable: 'Examples are unavailable.',
};

describe('ExampleRecommendations', () => {
  beforeEach(() => vi.stubEnv('VITE_EXAMPLE_CONTENT_ENABLED', 'true'));
  afterEach(() => vi.unstubAllEnvs());

  it('renders recommendations and selects without submitting work', () => {
    const onSelect = vi.fn();
    render(
      <ExampleRecommendations
        state="ready"
        items={exampleRecommendationsFixture.items}
        messages={messages}
        onSelect={onSelect}
      />
    );

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Use example: Prepare a weekly summary',
      })
    );
    expect(onSelect).toHaveBeenCalledWith(
      exampleRecommendationsFixture.items[0]
    );
  });

  it.each([
    ['empty', 'No examples match.'],
    ['disabled', 'Examples are disabled.'],
    ['unavailable', 'Examples are unavailable.'],
  ] as const)('renders the %s state', (state, copy) => {
    render(
      <ExampleRecommendations
        state={state}
        items={[]}
        messages={messages}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByText(copy)).toBeInTheDocument();
  });

  it('renders an accessible loading state', () => {
    render(
      <ExampleRecommendations
        state="loading"
        items={[]}
        messages={messages}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByRole('region', { name: 'Examples' })).toHaveAttribute(
      'aria-busy',
      'true'
    );
  });

  it('renders nothing while the feature flag is off', () => {
    vi.stubEnv('VITE_EXAMPLE_CONTENT_ENABLED', 'false');
    const { container } = render(
      <ExampleRecommendations
        state="ready"
        items={exampleRecommendationsFixture.items}
        messages={messages}
        onSelect={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
