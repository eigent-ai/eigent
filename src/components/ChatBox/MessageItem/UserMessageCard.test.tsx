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

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { UserMessageCard } from './UserMessageCard';

describe('UserMessageCard', () => {
  it('renders as a right-aligned chat bubble with a tighter tail corner', () => {
    const { container } = render(
      <UserMessageCard id="user-message-1" content="Hello from the user" />
    );

    const root = container.firstElementChild;
    const bubble = root?.firstElementChild;

    expect(root).toHaveClass('pl-16');
    expect(bubble).toHaveClass('rounded-xl', 'rounded-br-sm');
  });
});
