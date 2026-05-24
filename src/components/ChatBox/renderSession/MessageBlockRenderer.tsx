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

import { AgentMessageCard } from '@/components/ChatBox/MessageItem/AgentMessageCard';
import { QuestionBlock } from '@/components/ChatBox/MessageItem/blocks/QuestionBlock';
import { UserMessageCard } from '@/components/ChatBox/MessageItem/UserMessageCard';
import React from 'react';
import type { ChatBlock } from './types';

interface MessageBlockRendererProps {
  block: ChatBlock;
}

/**
 * Routes a single ChatBlock to its concrete UI component.
 * Keeps block-specific rendering logic out of UserQueryGroup.
 */
export const MessageBlockRenderer: React.FC<MessageBlockRendererProps> = ({
  block,
}) => {
  switch (block.type) {
    case 'user_message':
      return (
        <UserMessageCard
          id={block.id}
          content={block.content}
          attaches={block.attaches}
        />
      );

    case 'question':
      return <QuestionBlock block={block} />;

    case 'markdown':
    case 'completion':
      return (
        <AgentMessageCard
          id={block.id}
          content={block.content}
          typewriter={block.typewriter}
          onTyping={() => {}}
        />
      );

    case 'legacy_artifact':
      return (
        <AgentMessageCard
          id={block.id}
          content={block.content}
          typewriter={false}
          onTyping={() => {}}
          attaches={block.attaches}
        />
      );

    default:
      return null;
  }
};
