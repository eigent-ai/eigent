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

import { RichChatInput } from '@/components/ChatBox/BottomBox/RichChatInput';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

describe('RichChatInput motion', () => {
  it('removes placeholder copy synchronously when text appears', () => {
    const { rerender } = render(
      <RichChatInput
        value=""
        onChange={vi.fn()}
        placeholders={['Ask a follow-up']}
      />
    );

    expect(screen.getByText('Ask a follow-up')).toBeInTheDocument();

    rerender(
      <RichChatInput
        value="Review this"
        onChange={vi.fn()}
        placeholders={['Ask a follow-up']}
      />
    );

    expect(screen.queryByText('Ask a follow-up')).toBeNull();
    expect(screen.getByRole('textbox')).not.toHaveAttribute('aria-placeholder');
  });
});
