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

import { AgentStep } from '@/types/constants';
import type {
  AskPayload,
  ChatBlock,
  ChatTurn,
  CompletionBlock,
  HumanReplyBlock,
  MarkdownBlock,
  QuestionChatBlock,
  UserMessageBlock,
} from './types';

// ---------------------------------------------------------------------------
// Question type detection
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Enumerated option extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extracts option text from a numbered list embedded in a question string.
 * Matches patterns like "1. Foo\n2. Bar" or "1) Foo\n2) Bar".
 * Returns the labels in order, or an empty array if fewer than 2 found.
 */
function extractNumberedOptions(text: string): string[] {
  // Match "1. label" or "1) label" (label up to next numbered item or double-newline)
  const matches = [
    ...text.matchAll(/(?:^|\n)\s*\d+[.)]\s+(.+?)(?=\n\s*\d+[.)]|\n\n|$)/gs),
  ];
  return matches.length >= 2 ? matches.map((m) => m[1]!.trim()) : [];
}

/**
 * Extracts option text from a lettered list embedded in a question string.
 * Matches patterns like "A. Foo\nB. Bar" or "a) Foo\nb) Bar".
 * Returns the labels in order, or an empty array if fewer than 2 found.
 */
function extractLetteredOptions(text: string): string[] {
  const matches = [
    ...text.matchAll(
      /(?:^|\n)\s*[A-Da-d][.)]\s+(.+?)(?=\n\s*[A-Da-d][.)]|\n\n|$)/gs
    ),
  ];
  return matches.length >= 2 ? matches.map((m) => m[1]!.trim()) : [];
}

/** Detect the appropriate HITL control type from the question text. */
export function detectInputType(
  question: string
): 'text_input' | 'choice_input' | 'context_input' {
  // Numbered list (1. 2. 3. or 1) 2) 3)) — highest priority
  if (extractNumberedOptions(question).length >= 2) return 'choice_input';

  // Lettered list (A. B. C. or a) b) c))
  if (extractLetteredOptions(question).length >= 2) return 'choice_input';

  const lower = question.toLowerCase();

  // Classic binary keywords
  const isChoice =
    (lower.includes('yes') && lower.includes('no')) ||
    (lower.includes('approve') && lower.includes('reject')) ||
    (lower.includes('continue') && lower.includes('stop')) ||
    (lower.includes('confirm') && lower.includes('cancel'));

  if (isChoice) return 'choice_input';

  const isContext =
    lower.includes('more context') ||
    lower.includes('additional information') ||
    lower.includes('provide more') ||
    lower.includes('more details') ||
    lower.includes('can you clarify');

  if (isContext) return 'context_input';

  return 'text_input';
}

/** Extract choice labels from the question text, including enumerated lists. */
export function extractChoices(question: string): string[] {
  // Try numbered options first
  const numbered = extractNumberedOptions(question);
  if (numbered.length >= 2) return numbered;

  // Try lettered options
  const lettered = extractLetteredOptions(question);
  if (lettered.length >= 2) return lettered;

  // Classic binary fallbacks
  const lower = question.toLowerCase();
  if (lower.includes('approve') && lower.includes('reject'))
    return ['Approve', 'Reject'];
  if (lower.includes('continue') && lower.includes('stop'))
    return ['Continue', 'Stop'];
  if (lower.includes('confirm') && lower.includes('cancel'))
    return ['Confirm', 'Cancel'];
  return ['Yes', 'No'];
}

/**
 * Converts a legacy plain-text ASK message into a structured `AskPayload`.
 * Used when the backend hasn't sent an explicit `askPayload` yet.
 */
export function legacyAskPayload(
  msg: { content: string; agent_name?: string },
  agentName?: string
): AskPayload {
  const inputType = detectInputType(msg.content);
  const options =
    inputType === 'choice_input'
      ? extractChoices(msg.content).map((v) => ({ value: v, label: v }))
      : [];

  const block =
    inputType === 'choice_input'
      ? ({ kind: 'choice' as const, id: 'legacy-choice', options } as const)
      : ({
          kind: 'text' as const,
          id: 'legacy-text',
          placeholder:
            inputType === 'context_input'
              ? 'Add more context… (Shift+Enter for new line)'
              : 'Type your reply…',
        } as const);

  return {
    prompt: msg.content,
    agentName: agentName ?? msg.agent_name,
    inputs: [block],
  };
}

// ---------------------------------------------------------------------------
// Per-message block mapping
// ---------------------------------------------------------------------------

function mapAgentMessage(
  message: Message,
  messages: Message[],
  activeAsk: string,
  taskId: string,
  isLast: boolean,
  taskRunning: boolean
): ChatBlock | null {
  if (message.step === AgentStep.ASK) {
    const inputType = detectInputType(message.content);
    const myIndex = messages.indexOf(message);
    // Active when this is the most recent ASK without a subsequent user reply.
    const hasUserAfter = messages
      .slice(myIndex + 1)
      .some((m) => m.role === 'user');
    const isActive = !hasUserAfter && activeAsk !== '';

    const block: QuestionChatBlock = {
      type: 'question',
      id: message.id,
      content: message.content,
      agentName: message.agent_name || activeAsk,
      inputType,
      choices:
        inputType === 'choice_input'
          ? extractChoices(message.content)
          : undefined,
      isActive,
      taskId,
    };
    return block;
  }

  if (message.step === AgentStep.END) {
    const block: CompletionBlock = {
      type: 'completion',
      id: message.id,
      content: message.content,
      fileList: message.fileList,
      typewriter: isLast && taskRunning,
    };
    return block;
  }

  if (!message.content) return null;

  const block: MarkdownBlock = {
    type: 'markdown',
    id: message.id,
    content: message.content,
    typewriter: isLast && taskRunning,
    fileList: message.fileList,
    agentName: message.agent_name,
    isAgentEnd: message.step === AgentStep.AGENT_END,
  };
  return block;
}

function mapUserMessage(message: Message): UserMessageBlock | HumanReplyBlock {
  return {
    type: 'user_message',
    id: message.id,
    content: message.content,
    attaches: message.attaches,
  };
}

// ---------------------------------------------------------------------------
// Full turn normalization
// ---------------------------------------------------------------------------

interface NormalizeOptions {
  messages: Message[];
  activeAsk: string;
  taskId: string;
  taskRunning: boolean;
}

/**
 * Convert a flat Message[] into a list of ChatTurn objects, one per user query.
 * Preserves the grouping logic from SessionView.groupMessagesByQuery while
 * adding block-type annotations for downstream renderers.
 */
export function normalizeMessagesToChatTurns({
  messages,
  activeAsk,
  taskId,
  taskRunning,
}: NormalizeOptions): ChatTurn[] {
  const turns: ChatTurn[] = [];
  let current: ChatTurn | null = null;

  const agentMessages = messages.filter((m) => m.role === 'agent');

  messages.forEach((message) => {
    if (message.role === 'user') {
      if (current) turns.push(current);
      const userBlock = mapUserMessage(message);
      current = {
        id: message.id,
        userBlock:
          userBlock.type === 'user_message'
            ? (userBlock as UserMessageBlock)
            : null,
        agentBlocks: [],
      };
      return;
    }

    // Agent / system message
    if (!current) {
      current = {
        id: `orphan-${message.id}`,
        userBlock: null,
        agentBlocks: [],
      };
    }

    const isLast =
      agentMessages.length > 0 &&
      agentMessages[agentMessages.length - 1]?.id === message.id;

    const block = mapAgentMessage(
      message,
      messages,
      activeAsk,
      taskId,
      isLast,
      taskRunning
    );
    if (block) current.agentBlocks.push(block);
  });

  if (current) turns.push(current);
  return turns;
}
