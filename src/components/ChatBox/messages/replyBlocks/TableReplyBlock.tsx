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

interface Props {
  block: Extract<ReplyBlock, { kind: 'table' }>;
}

export const TableReplyBlock: React.FC<Props> = ({ block }) => (
  <div className="rounded-lg border-ds-border-neutral-default-default w-full overflow-auto border">
    {block.title && (
      <div className="px-4 py-2 border-ds-border-neutral-default-default border-b">
        <span className="text-body-sm font-semibold text-ds-text-neutral-default-default">
          {block.title}
        </span>
      </div>
    )}
    <table className="text-body-sm w-full text-left">
      <thead className="top-0 bg-ds-bg-neutral-subtle-default sticky">
        <tr>
          {block.columns.map((col) => (
            <th
              key={col}
              className="px-4 py-2 font-medium text-ds-text-neutral-muted-default whitespace-nowrap"
            >
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {block.rows.map((row, rowIdx) => (
          <tr
            key={rowIdx}
            className="border-ds-border-neutral-default-default hover:bg-ds-bg-neutral-subtle-default border-t"
          >
            {row.map((cell, cellIdx) => (
              <td
                key={cellIdx}
                className="px-4 py-2 text-ds-text-neutral-default-default"
              >
                {String(cell)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
