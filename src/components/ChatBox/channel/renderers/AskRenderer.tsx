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

/**
 * HITL ask renderer. Shows the question text in the conversation log. The
 * interactive answer controls (text input, option buttons, follow-up form) are
 * owned by the BottomBox question variant — see `BottomBox/variants`. This
 * keeps a single input surface and avoids duplicate/competing controls.
 *
 * The 30s auto-skip for an unanswered ask is owned here (keyed on the active
 * ask) and routes through the shared `submitHumanReply` with the `skip`
 * sentinel, so it fires regardless of which input variant is showing.
 */

import type { AskItem } from '@/types/sessionChannel';
import { motion } from 'framer-motion';
import { useEffect } from 'react';
import { AgentMessageCard } from '../../MessageItem/AgentMessageCard';
import type { ChannelRenderer } from '../context';
import { submitHumanReply } from '../submitHumanReply';

const AUTO_SKIP_MS = 30000;

export const AskRenderer: ChannelRenderer<AskItem> = ({ item, ctx }) => {
  const resolved = ctx.resolveTurn(item.turnId);
  const liveTask = resolved?.chatStore.getState().tasks[resolved.taskId];
  // The ask is active while the live task is still asking for this agent.
  const isActive = !!liveTask?.activeAsk && liveTask.activeAsk === item.agent;

  // Robust single 30s auto-skip for the active ask.
  useEffect(() => {
    if (!isActive || !resolved) return;
    const timer = setTimeout(() => {
      void submitHumanReply({
        projectId: ctx.projectId,
        chatStore: resolved.chatStore,
        taskId: resolved.taskId,
        reply: 'skip',
      });
    }, AUTO_SKIP_MS);
    return () => clearTimeout(timer);
    // Re-arm whenever the active ask changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, item.id, resolved?.taskId, ctx.projectId]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="gap-4 flex flex-col"
    >
      <AgentMessageCard
        id={item.id}
        content={item.question}
        onTyping={() => {}}
      />
    </motion.div>
  );
};
