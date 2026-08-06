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

import { FoldedView } from '@/components/ChatBox/TaskBox/PlanTaskBox/FoldedView';
import type { VanillaChatStore } from '@/store/chatStore';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const TASK_CONTENT = 'Research the latest AI news';

function renderFoldedView(canExpand: boolean) {
  render(
    <FoldedView
      chatStore={{} as VanillaChatStore}
      taskId="task-1"
      summaryTask="Research plan"
      taskInfo={[{ id: 'subtask-1', content: TASK_CONTENT }]}
      streamingDecomposeText=""
      isSplitting={false}
      canExpand={canExpand}
      onExpand={vi.fn()}
    />
  );

  const preview = screen.getByText(TASK_CONTENT).closest('[style]');
  expect(preview).not.toBeNull();
  return preview as HTMLElement;
}

describe('FoldedView preview overflow', () => {
  it('clips the fixed-height preview when the expanded overlay is available', () => {
    const preview = renderFoldedView(true);

    expect(preview).toHaveClass('overflow-hidden');
    expect(preview).not.toHaveClass('overflow-y-auto');
    expect(preview).toHaveStyle({ height: '200px' });
    expect(
      screen.getByRole('button', { name: 'chat.expand-subtasks' })
    ).toBeInTheDocument();
  });

  it('keeps the fixed-height preview scrollable when it cannot expand', () => {
    const preview = renderFoldedView(false);

    expect(preview).toHaveClass('scrollbar', 'overflow-y-auto');
    expect(preview).not.toHaveClass('overflow-hidden');
    expect(preview).toHaveStyle({ height: '200px' });
    expect(
      screen.queryByRole('button', { name: 'chat.expand-subtasks' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'chat.expand-plan' })
    ).not.toBeInTheDocument();
  });
});
