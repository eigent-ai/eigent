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

import type {
  HitlInputBlock,
  QuestionChatBlock,
} from '@/components/ChatBox/renderSession/types';
import { CircleUser } from 'lucide-react';
import React from 'react';

interface QuestionBlockProps {
  block: QuestionChatBlock;
}

function inputKindLabel(kind: HitlInputBlock['kind']): string {
  switch (kind) {
    case 'text':
      return 'text answer';
    case 'choice':
      return 'selection';
    case 'key_value':
      return 'key / token';
    case 'model':
      return 'model config';
    case 'mcp':
      return 'MCP connector';
    case 'skill_upload':
      return 'skill upload';
    case 'file_upload':
      return 'file upload';
    case 'redirect':
      return 'link';
  }
}

/**
 * View-only card shown in the chat scroll for an agent ASK message.
 * Reply controls live in the BottomBox (BoxHeaderAsk) when the question
 * is active, keeping viewing and acting clearly separated.
 */
export const QuestionBlock: React.FC<QuestionBlockProps> = ({ block }) => {
  const agentLabel = block.agentName || 'Agent';

  // Build a compact summary of what kind of inputs were requested.
  const inputSummary = block.askPayload?.inputs.length
    ? 'Requested: ' +
      block.askPayload.inputs
        .map((b) => b.label ?? inputKindLabel(b.kind))
        .join(' · ')
    : null;

  return (
    <div
      className="rounded-2xl border-ds-border-neutral-default-default bg-ds-bg-neutral-subtle-default p-4 gap-2 flex flex-col border"
      data-question-id={block.id}
    >
      {/* Header */}
      <div className="gap-2 flex items-center">
        <CircleUser
          size={14}
          className="text-ds-icon-neutral-muted-default shrink-0"
        />
        <span className="text-label-xs font-medium text-ds-text-neutral-muted-default">
          {agentLabel} asks
        </span>

        {block.isActive && (
          <span className="text-label-xs text-ds-text-brand-default-default ml-auto">
            ↓ Reply below
          </span>
        )}
        {!block.isActive && (
          <span className="text-label-xs text-ds-text-neutral-muted-default ml-auto">
            Answered
          </span>
        )}
      </div>

      {/* Question text */}
      <p className="text-body-sm text-ds-text-neutral-default-default whitespace-pre-wrap">
        {block.content}
      </p>

      {/* Structured input summary */}
      {inputSummary && (
        <p className="text-label-xs text-ds-text-neutral-muted-default">
          {inputSummary}
        </p>
      )}
    </div>
  );
};
