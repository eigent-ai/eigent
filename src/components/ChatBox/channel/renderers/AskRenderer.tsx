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
 * HITL ask renderer (Stage 3). Shows the question and — when this is the active
 * unanswered ask — a control chosen by `inputKind`:
 *   - text    → no inline control (the BottomBox textarea handles text replies)
 *   - single  → one click-to-submit button per option
 *   - multi   → checkbox list + Submit
 *   - confirm → Yes / No buttons
 *
 * `inputKind` defaults to `text`, so against the current backend (text-only asks)
 * this preserves today's behavior; single/multi/confirm are forward-compatible
 * and light up automatically if the `ask` payload ever carries options.
 *
 * A single 30s auto-skip timer is owned here (keyed on the active ask) and
 * routes through the same reply path with the `skip` sentinel.
 */

import type { AskItem } from '@/types/sessionChannel';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { AgentMessageCard } from '../../MessageItem/AgentMessageCard';
import type { ChannelRenderer } from '../context';
import { serializeReply, submitHumanReply } from '../submitHumanReply';

const AUTO_SKIP_MS = 30000;

const optionBtn =
  'rounded-lg border border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default px-3 py-1.5 text-sm font-medium text-ds-text-neutral-default-default transition-colors hover:bg-ds-bg-neutral-default-hover active:bg-ds-bg-neutral-default-active disabled:opacity-50';

export const AskRenderer: ChannelRenderer<AskItem> = ({ item, ctx }) => {
  const resolved = ctx.resolveTurn(item.turnId);
  const liveTask = resolved?.chatStore.getState().tasks[resolved.taskId];
  // The ask is active while the live task is still asking for this agent.
  const isActive = !!liveTask?.activeAsk && liveTask.activeAsk === item.agent;

  const [submitting, setSubmitting] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const send = async (reply: string, displayContent?: string) => {
    if (!resolved || submitting) return;
    setSubmitting(true);
    await submitHumanReply({
      projectId: ctx.projectId,
      chatStore: resolved.chatStore,
      taskId: resolved.taskId,
      reply,
      displayContent,
    });
    setSubmitting(false);
  };

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

  const question = (
    <AgentMessageCard
      id={item.id}
      content={item.question}
      onTyping={() => {}}
    />
  );

  if (!isActive || item.inputKind === 'text') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="gap-4 flex flex-col"
      >
        {question}
      </motion.div>
    );
  }

  const options = item.options ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="gap-3 px-6 flex flex-col"
    >
      {question}

      {item.inputKind === 'single' && (
        <div className="gap-2 flex flex-wrap">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={submitting}
              className={optionBtn}
              onClick={() =>
                send(
                  serializeReply('single', { selected: [opt.value] }),
                  opt.label
                )
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {item.inputKind === 'confirm' && (
        <div className="gap-2 flex">
          <button
            type="button"
            disabled={submitting}
            className={optionBtn}
            onClick={() => send('yes', 'Yes')}
          >
            Yes
          </button>
          <button
            type="button"
            disabled={submitting}
            className={optionBtn}
            onClick={() => send('no', 'No')}
          >
            No
          </button>
        </div>
      )}

      {item.inputKind === 'multi' && (
        <div className="gap-2 flex flex-col">
          {options.map((opt) => (
            <label
              key={opt.value}
              className="gap-2 text-sm text-ds-text-neutral-default-default flex cursor-pointer items-center"
            >
              <input
                type="checkbox"
                checked={!!checked[opt.value]}
                onChange={(e) =>
                  setChecked((c) => ({ ...c, [opt.value]: e.target.checked }))
                }
              />
              {opt.label}
            </label>
          ))}
          <div>
            <button
              type="button"
              disabled={submitting}
              className={optionBtn}
              onClick={() => {
                const selected = options
                  .filter((o) => checked[o.value])
                  .map((o) => o.value);
                const labels = options
                  .filter((o) => checked[o.value])
                  .map((o) => o.label)
                  .join(', ');
                send(serializeReply('multi', { selected }), labels);
              }}
            >
              Submit
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
};
