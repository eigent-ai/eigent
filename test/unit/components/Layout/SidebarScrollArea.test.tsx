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

import { SidebarScrollArea } from '@/components/Layout/AppSidebar';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('SidebarScrollArea', () => {
  it('always reserves its scrollbar track in the rail padding', () => {
    const { container } = render(
      <SidebarScrollArea className="pt-ds-4">
        <div>Navigation</div>
      </SidebarScrollArea>
    );
    const scrollArea = container.querySelector('[data-sidebar-scroll-area]');

    // The track replaces the right padding, so rows never shift when the
    // content starts to overflow.
    expect(scrollArea).toHaveClass(
      'scrollbar-always-visible',
      'overflow-y-auto',
      '-mr-ds-8',
      'pt-ds-4'
    );
  });
});
