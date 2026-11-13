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

import { SessionLoadingHalo } from '@/components/ChatBox/SessionLoadingHalo';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('SessionLoadingHalo', () => {
  it('announces loading and takes no pointer input', () => {
    render(<SessionLoadingHalo active label="Loading history" />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading history');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveClass('pointer-events-none', 'absolute', 'inset-0');
    expect(status.querySelector('.session-loading-halo')).not.toBeNull();
  });

  it('shows the Eigent mark at the centre without announcing it', () => {
    render(<SessionLoadingHalo active label="Loading history" />);

    const logo = screen
      .getByRole('status')
      .querySelector<HTMLElement>('.session-loading-halo-logo');
    expect(logo?.parentElement).toHaveClass(
      'flex',
      'items-center',
      'justify-center'
    );
    const marks = logo?.querySelectorAll('img') ?? [];
    expect(marks).toHaveLength(2);
    marks.forEach((mark) => expect(mark).toHaveAttribute('alt', ''));
  });

  it('leaves once content has loaded', async () => {
    const { rerender } = render(
      <SessionLoadingHalo active label="Loading history" />
    );

    rerender(<SessionLoadingHalo active={false} label="Loading history" />);

    await waitFor(() =>
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    );
  });

  it('carries on when another surface takes over the same wait', () => {
    const first = render(<SessionLoadingHalo active label="Loading history" />);
    const second = render(
      <SessionLoadingHalo active label="Loading history" />
    );
    first.unmount();

    const halo = second.container.querySelector<HTMLElement>(
      '.session-loading-halo'
    );
    expect(halo?.style.getPropertyValue('--halo-elapsed')).toMatch(/^\d+ms$/);
    second.unmount();
  });

  it('starts from the bottom for a new wait', async () => {
    const first = render(<SessionLoadingHalo active label="Loading history" />);
    first.unmount();
    await new Promise((resolve) => setTimeout(resolve, 450));

    const { container } = render(
      <SessionLoadingHalo active label="Loading history" />
    );
    const halo = container.querySelector<HTMLElement>('.session-loading-halo');
    expect(halo?.style.getPropertyValue('--halo-elapsed')).toBe('0ms');
  });
});
