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
import type { ReplyBlock } from '@/components/ChatBox/renderSession/types';
import React from 'react';
import { ChartReplyBlock } from './ChartReplyBlock';
import { DashboardReplyBlock } from './DashboardReplyBlock';
import { FilesReplyBlock } from './FilesReplyBlock';
import { MarkdownReplyBlock } from './MarkdownReplyBlock';
import { TableReplyBlock } from './TableReplyBlock';
import { TriggerSuggestionBlock } from './TriggerSuggestionBlock';

export { ChartReplyBlock } from './ChartReplyBlock';
export { DashboardReplyBlock } from './DashboardReplyBlock';
export { FilesReplyBlock } from './FilesReplyBlock';
export { MarkdownReplyBlock } from './MarkdownReplyBlock';
export { TableReplyBlock } from './TableReplyBlock';
export { TriggerSuggestionBlock } from './TriggerSuggestionBlock';

export function renderReplyBlock(
  block: ReplyBlock,
  opts?: {
    typewriter?: boolean;
    onTyping?: () => void;
    onMarkdownRenderComplete?: () => void;
  }
): React.ReactElement | null {
  switch (block.kind) {
    case 'markdown':
      return React.createElement(MarkdownReplyBlock, {
        key: block.id,
        block,
        typewriter: opts?.typewriter,
        onTyping: opts?.onTyping,
        onMarkdownRenderComplete: opts?.onMarkdownRenderComplete,
      });
    case 'table':
      return React.createElement(TableReplyBlock, { key: block.id, block });
    case 'chart':
      return React.createElement(ChartReplyBlock, { key: block.id, block });
    case 'dashboard':
      return React.createElement(DashboardReplyBlock, { key: block.id, block });
    case 'files':
      return React.createElement(FilesReplyBlock, { key: block.id, block });
    case 'trigger_suggestion':
      return React.createElement(TriggerSuggestionBlock, {
        key: block.id,
        block,
      });
    default:
      return null;
  }
}
