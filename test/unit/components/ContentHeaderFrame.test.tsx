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

import ContentHeader, {
  ContentHeaderFrame,
  ContentHeaderOwner,
} from '@/components/Layout/ContentHeader';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { lazy, Suspense } from 'react';
import { describe, expect, it, vi } from 'vitest';

describe('ContentHeaderFrame', () => {
  it('keeps the divider outside fading content and preserves header interaction', () => {
    const onAdd = vi.fn();
    const page = (activeKey: string) => (
      <ContentHeaderFrame activeKey={activeKey}>
        <ContentHeaderOwner value={activeKey}>
          <div data-testid="animated-content" style={{ opacity: 0 }}>
            <ContentHeader
              persistent
              title={activeKey}
              actions={<button onClick={onAdd}>Add</button>}
            />
            Page body
          </div>
        </ContentHeaderOwner>
      </ContentHeaderFrame>
    );
    const view = render(page('Skills'));
    const frame = document.querySelector('[data-content-header-frame]');
    const divider = frame?.querySelector('[data-content-header-divider]');
    expect(divider).toHaveClass(
      'border-b',
      'border-ds-hairline-subtle-default'
    );
    expect(frame).not.toHaveClass('border-b');
    expect(screen.getByTestId('animated-content')).not.toContainElement(frame);
    expect(frame).toContainElement(screen.getByText('Skills'));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onAdd).toHaveBeenCalledOnce();

    view.rerender(page('Connectors'));
    expect(document.querySelector('[data-content-header-frame]')).toBe(frame);
    expect(frame?.querySelector('[data-content-header-divider]')).toBe(divider);
    expect(frame).toContainElement(screen.getByText('Connectors'));
    expect(screen.queryByText('Skills')).not.toBeInTheDocument();
    expect(document.querySelectorAll('header')).toHaveLength(1);
  });

  it('retains the frame during lazy loading and rejects a late outgoing header', async () => {
    let resolveHeader!: (module: { default: () => React.JSX.Element }) => void;
    const LateHeader = lazy(
      () =>
        new Promise<{ default: () => React.JSX.Element }>((resolve) => {
          resolveHeader = resolve;
        })
    );
    const page = (activeKey: string, showCurrent: boolean) => (
      <ContentHeaderFrame activeKey={activeKey}>
        <ContentHeaderOwner value="Skills">
          <Suspense fallback={<span>Loading skills</span>}>
            <LateHeader />
          </Suspense>
        </ContentHeaderOwner>
        {showCurrent && (
          <ContentHeaderOwner value="Connectors">
            <ContentHeader persistent title="Connectors" />
          </ContentHeaderOwner>
        )}
      </ContentHeaderFrame>
    );
    const view = render(page('Skills', false));
    const frame = document.querySelector('[data-content-header-frame]');
    expect(frame).toHaveClass('min-h-ds-layout-row-header');
    expect(frame?.querySelector('[data-content-header-divider]')).toHaveClass(
      'border-b'
    );
    view.rerender(page('Connectors', true));
    await act(async () =>
      resolveHeader({
        default: () => (
          <ContentHeader persistent title="Stale skills controls" />
        ),
      })
    );
    expect(document.querySelector('[data-content-header-frame]')).toBe(frame);
    expect(frame).toContainElement(screen.getByText('Connectors'));
    expect(screen.queryByText('Stale skills controls')).not.toBeInTheDocument();
  });

  it('keeps standalone headers inline when no frame is supplied', () => {
    render(<ContentHeader persistent title="Standalone" />);
    expect(screen.getByText('Standalone').closest('header')).toHaveClass(
      'border-b'
    );
  });
});
