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

import { motion } from 'framer-motion';
import React from 'react';
import { MessageBlockRenderer } from './MessageBlockRenderer';
import type { ChatTurn } from './types';

interface ChatTurnViewProps {
  turn: ChatTurn;
  index?: number;
}

/**
 * Renders one user turn (user message + all derived agent blocks).
 * Plan/work-log/completion blocks are still rendered by UserQueryGroup for
 * now; this view handles the inline HITL and markdown blocks.
 */
export const ChatTurnView: React.FC<ChatTurnViewProps> = ({
  turn,
  index = 0,
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className="gap-3 flex flex-col"
    >
      {turn.agentBlocks.map((block) => (
        <MessageBlockRenderer key={block.id} block={block} />
      ))}
    </motion.div>
  );
};
