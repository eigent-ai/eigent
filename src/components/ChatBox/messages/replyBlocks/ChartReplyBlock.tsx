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
import { BarChart2 } from 'lucide-react';
import React from 'react';

interface Props {
  block: Extract<ReplyBlock, { kind: 'chart' }>;
}

// Chart rendering requires a charting library (e.g. recharts) — pending backend integration.
export const ChartReplyBlock: React.FC<Props> = ({ block }) => (
  <div className="gap-2 rounded-lg border-ds-border-neutral-default-default p-4 flex flex-col border">
    {block.title && (
      <span className="text-body-sm font-semibold text-ds-text-neutral-default-default">
        {block.title}
      </span>
    )}
    <div className="gap-2 rounded-md bg-ds-bg-neutral-subtle-default px-4 py-6 text-ds-text-neutral-muted-default flex items-center">
      <BarChart2 size={20} className="shrink-0" />
      <span className="text-body-sm">
        Chart ({block.chartType}) — rendering coming soon
      </span>
    </div>
  </div>
);
