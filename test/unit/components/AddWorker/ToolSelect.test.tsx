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

import '@/api/http';

import ToolSelect from '@/components/AddWorker/ToolSelect';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/api/http', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/http')>()),
  proxyFetchGet: vi.fn().mockResolvedValue([]),
}));

describe('ToolSelect', () => {
  it('explains that only local connectors are picked per agent', () => {
    render(<ToolSelect onShowEnvConfig={vi.fn()} />);

    const note = screen.getByText(
      'Add your local connectors here. Remote connectors are added to every agent automatically.'
    );
    expect(screen.getByRole('textbox', { name: 'Agent Tool' })).toHaveAttribute(
      'aria-describedby',
      note.id
    );
  });
});
