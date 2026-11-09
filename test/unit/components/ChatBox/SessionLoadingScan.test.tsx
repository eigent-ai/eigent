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

import { SessionLoadingScan } from '@/components/ChatBox/SessionLoadingScan';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('SessionLoadingScan', () => {
  it('announces loading and takes no pointer input', () => {
    render(<SessionLoadingScan active label="Loading history" />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading history');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveClass('pointer-events-none', 'absolute', 'inset-0');
    expect(status.querySelector('.session-loading-scan')).not.toBeNull();
  });

  it('leaves once content has loaded', async () => {
    const { rerender } = render(
      <SessionLoadingScan active label="Loading history" />
    );

    rerender(<SessionLoadingScan active={false} label="Loading history" />);

    await waitFor(() =>
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    );
  });

  it('joins a sweep already under way instead of restarting it', () => {
    const { container } = render(
      <SessionLoadingScan active label="Loading history" />
    );

    const band = container.ownerDocument.querySelector<HTMLElement>(
      '.session-loading-scan'
    );
    expect(band?.style.animationDelay).toMatch(/^-/);
  });
});
