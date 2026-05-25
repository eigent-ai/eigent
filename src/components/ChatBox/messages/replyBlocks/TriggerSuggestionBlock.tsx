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
import { TriggerDialogButton } from '@/components/Trigger/TriggerDialog';
import { Zap } from 'lucide-react';
import React from 'react';

interface Props {
  block: Extract<ReplyBlock, { kind: 'trigger_suggestion' }>;
}

export const TriggerSuggestionBlock: React.FC<Props> = ({ block }) => (
  <div className="gap-3 rounded-xl border-ds-border-neutral-default-default bg-ds-bg-neutral-subtle-default px-4 py-3 flex items-center justify-between border">
    <div className="gap-2 min-w-0 flex items-start">
      <Zap
        size={16}
        className="mt-0.5 text-ds-icon-neutral-muted-default shrink-0"
      />
      <div className="gap-0.5 min-w-0 flex flex-col">
        <span className="text-label-xs font-medium text-ds-text-neutral-muted-default">
          Automate this task
        </span>
        {block.reason && (
          <span className="text-body-sm text-ds-text-neutral-default-default truncate">
            {block.reason}
          </span>
        )}
      </div>
    </div>
    <TriggerDialogButton
      initialTaskPrompt={block.prompt}
      buttonVariant="outline"
      buttonSize="xs"
      buttonText="Schedule"
      buttonIcon={<Zap className="mr-1.5 h-3.5 w-3.5" />}
    />
  </div>
);
