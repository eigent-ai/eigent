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

import { Toaster } from '@/components/ui/sonner';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authState: { appearance: 'light' as 'light' | 'dark' },
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: (
    selector: (state: { appearance: 'light' | 'dark' }) => unknown
  ) => selector(mocks.authState),
}));

vi.mock('sonner', () => ({
  Toaster: ({ theme }: { theme?: string }) => (
    <div data-testid="sonner-toaster" data-theme={theme} />
  ),
}));

describe('Toaster theme', () => {
  beforeEach(() => {
    mocks.authState.appearance = 'light';
  });

  it('tracks the resolved application appearance', () => {
    const { rerender } = render(<Toaster />);

    expect(screen.getByTestId('sonner-toaster')).toHaveAttribute(
      'data-theme',
      'light'
    );

    mocks.authState.appearance = 'dark';
    rerender(<Toaster />);

    expect(screen.getByTestId('sonner-toaster')).toHaveAttribute(
      'data-theme',
      'dark'
    );
  });
});
