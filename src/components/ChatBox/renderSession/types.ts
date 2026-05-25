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

/** Plain markdown / code / table / image prose from the agent. */
export interface MarkdownBlock {
  type: 'markdown';
  id: string;
  content: string;
  typewriter: boolean;
  fileList?: FileInfo[];
  agentName?: string;
  isAgentEnd?: boolean;
}

/** The original user prompt that opened this turn. */
export interface UserMessageBlock {
  type: 'user_message';
  id: string;
  content: string;
  attaches?: File[];
}

// ---------------------------------------------------------------------------
// Rich HITL input schema (Stage B)
// ---------------------------------------------------------------------------

/**
 * One input control inside a structured ASK turn.
 * The `kind` field drives the renderer registry in `hitlInputs/`.
 */
export type HitlInputBlock =
  | {
      kind: 'text';
      id: string;
      label?: string;
      placeholder?: string;
      multiline?: boolean;
    }
  | {
      kind: 'choice';
      id: string;
      label?: string;
      options: Array<{ value: string; label: string }>;
      multiSelect?: boolean;
    }
  | { kind: 'key_value'; id: string; label?: string; secret?: boolean }
  | { kind: 'model'; id: string; label?: string; category?: string }
  | { kind: 'mcp'; id: string; label?: string }
  | { kind: 'skill_upload'; id: string; label?: string }
  | { kind: 'file_upload'; id: string; label?: string; accept?: string[] }
  | { kind: 'redirect'; id: string; label: string; href: string };

/** Structured payload for an `AgentStep.ASK` message (optional — plain text is the fallback). */
export interface AskPayload {
  prompt: string;
  agentName?: string;
  inputs: HitlInputBlock[];
  submitLabel?: string;
}

// ---------------------------------------------------------------------------
// Rich reply block schema (Stage C)
// ---------------------------------------------------------------------------

export type ReplyBlock =
  | { kind: 'markdown'; id: string; content: string }
  | {
      kind: 'table';
      id: string;
      title?: string;
      columns: string[];
      rows: Array<Array<string | number>>;
    }
  | {
      kind: 'chart';
      id: string;
      title?: string;
      chartType: 'line' | 'bar' | 'pie';
      series: Array<{ name: string; data: Array<[string | number, number]> }>;
    }
  | { kind: 'dashboard'; id: string; title?: string; widgets: ReplyBlock[] }
  | { kind: 'files'; id: string; files: FileInfo[] }
  | {
      kind: 'trigger_suggestion';
      id: string;
      prompt: string;
      reason?: string;
      schedule?: string;
    };

/** Structured payload for an `AgentStep.END` message (optional — markdown+fileList is the fallback). */
export interface ReplyPayload {
  blocks: ReplyBlock[];
}

/** An inline HITL question emitted by AgentStep.ASK. */
export interface QuestionChatBlock {
  type: 'question';
  id: string;
  content: string;
  agentName: string;
  inputType: 'text_input' | 'choice_input' | 'context_input';
  choices?: string[];
  isActive: boolean;
  taskId: string;
  /** Structured payload — present when the backend sent an explicit AskPayload. */
  askPayload?: AskPayload;
}

/** The user's reply to a question (rendered after the question block). */
export interface HumanReplyBlock {
  type: 'human_reply';
  id: string;
  content: string;
  attaches?: File[];
}

/** A list of output files attached to the agent's final answer. */
export interface FileListBlock {
  type: 'file_list';
  id: string;
  files: FileInfo[];
}

/** Workforce task plan (TO_SUB_TASKS). */
export interface PlanBlock {
  type: 'plan';
  id: string;
  isConfirmed: boolean;
  taskId: string;
}

/** Running agent work log (shown while task is executing). */
export interface WorkLogBlock {
  type: 'work_log';
  id: string;
  taskId: string;
}

/** A lightweight status / notice message. */
export interface StatusBlock {
  type: 'status';
  id: string;
  message: string;
}

/** Agent's final END answer block. */
export interface CompletionBlock {
  type: 'completion';
  id: string;
  content: string;
  fileList?: FileInfo[];
  typewriter: boolean;
}

/** Backward-compat wrapper for old ui_artifact messages. */
export interface LegacyArtifactBlock {
  type: 'legacy_artifact';
  id: string;
  content: string;
  attaches?: File[];
}

export type ChatBlock =
  | MarkdownBlock
  | UserMessageBlock
  | QuestionChatBlock
  | HumanReplyBlock
  | FileListBlock
  | PlanBlock
  | WorkLogBlock
  | StatusBlock
  | CompletionBlock
  | LegacyArtifactBlock;

export type ChatBlockType = ChatBlock['type'];

/** One user turn and all agent blocks produced in response. */
export interface ChatTurn {
  /** Matches the user message id (or a synthetic key for orphan groups). */
  id: string;
  userBlock: UserMessageBlock | null;
  agentBlocks: ChatBlock[];
}
