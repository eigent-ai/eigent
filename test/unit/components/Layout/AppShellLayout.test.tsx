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

import AppShellLayout from '@/components/Layout/AppShellLayout';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const columns = (container: HTMLElement) =>
  container.querySelector('[data-app-shell-columns]');

describe('AppShellLayout', () => {
  it('rounds its top-left corner beside the app rail', () => {
    const { container } = render(
      <AppShellLayout sidebar={null}>Page</AppShellLayout>
    );
    expect(columns(container)).toHaveClass('rounded-tl-ds-panel');
  });

  it('stays square in a window without the rail', () => {
    const { container } = render(
      <AppShellLayout sidebar={null} besideAppRail={false}>
        Page
      </AppShellLayout>
    );
    expect(columns(container)).not.toHaveClass('rounded-tl-ds-panel');
  });
});
