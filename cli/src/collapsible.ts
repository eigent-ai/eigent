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

import chalk from 'chalk';

export interface CollapsibleBlock {
  id: number;
  fullOutput: string;
  previewLines: number;
  expanded: boolean;
}

const LINE_THRESHOLD = 15;
const PREVIEW_LINES = 5;

let blocks: CollapsibleBlock[] = [];
let nextId = 0;

export function shouldCollapse(output: string): boolean {
  return output.split('\n').length > LINE_THRESHOLD;
}

export function addCollapsibleBlock(fullOutput: string): CollapsibleBlock {
  const block: CollapsibleBlock = {
    id: nextId++,
    fullOutput,
    previewLines: PREVIEW_LINES,
    expanded: false,
  };
  blocks.push(block);
  return block;
}

export function renderCollapsed(block: CollapsibleBlock): string {
  const lines = block.fullOutput.split('\n');
  const preview = lines.slice(0, block.previewLines).join('\n');
  const remaining = lines.length - block.previewLines;
  return (
    preview +
    '\n' +
    chalk.dim.italic(`  ... ${remaining} more lines (Ctrl+E to expand)`)
  );
}

export function getLastCollapsedBlock(): CollapsibleBlock | null {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (!blocks[i].expanded) return blocks[i];
  }
  return null;
}

export function expandBlock(block: CollapsibleBlock): string {
  block.expanded = true;
  return block.fullOutput;
}

export function clearBlocks(): void {
  blocks = [];
  nextId = 0;
}
