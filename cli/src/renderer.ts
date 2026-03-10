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
import { Marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { AgentStep, type SSEEvent } from './types.js';

const marked = new Marked(markedTerminal() as any);

function renderMarkdown(text: string): string {
  try {
    return (marked.parse(text) as string).trimEnd();
  } catch {
    return text;
  }
}

function truncate(text: string, maxLen: number = 200): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

export interface RenderResult {
  output: string | null;
  /** If true, write output with process.stdout.write (no trailing newline) */
  raw: boolean;
  /** If true, output may be long and should be collapsed if over threshold */
  collapsible: boolean;
  needsHumanReply: { agent: string; question: string } | null;
  isEnd: boolean;
  isWaitConfirm: boolean;
}

export function renderEvent(event: SSEEvent): RenderResult {
  const result: RenderResult = {
    output: null,
    raw: false,
    collapsible: false,
    needsHumanReply: null,
    isEnd: false,
    isWaitConfirm: false,
  };

  const { step, data } = event;

  switch (step) {
    // --- Visible events (user-facing) ---

    case AgentStep.CONFIRMED:
      result.output = chalk.dim('> Processing...');
      break;

    case AgentStep.TASK_STATE: {
      const state = data.state || '';
      const taskId = data.task_id || '';
      const stateIcon =
        state === 'completed' ? '✓' : state === 'failed' ? '✗' : '●';
      const stateColor =
        state === 'completed'
          ? chalk.green
          : state === 'failed'
            ? chalk.red
            : chalk.yellow;
      result.output = stateColor(`[Task ${taskId}] ${stateIcon} ${state}`);
      if (data.result) {
        result.output += '\n' + renderMarkdown(String(data.result));
        result.collapsible = true;
      }
      break;
    }

    case AgentStep.WRITE_FILE:
      result.output = chalk.magenta(
        `[File] Wrote ${data.path || data.file_path || 'unknown'}`
      );
      break;

    case AgentStep.ASK:
      result.output = chalk.cyan(
        `\n[Question from ${data.agent || 'agent'}]\n${data.question || data.content || ''}`
      );
      result.needsHumanReply = {
        agent: data.agent || '',
        question: data.question || data.content || '',
      };
      break;

    case AgentStep.WAIT_CONFIRM: {
      const content = data.content || '';
      if (content) {
        result.output = '\n' + renderMarkdown(content);
        result.collapsible = true;
      }
      result.isWaitConfirm = true;
      break;
    }

    case AgentStep.END: {
      const endMsg =
        typeof data === 'string' ? data : data.message || data.result || '';
      const summaryMatch = String(endMsg).match(/<summary>(.*?)<\/summary>/s);
      const summary = summaryMatch ? summaryMatch[1] : '';
      result.output = chalk.green('\n✓ Task completed');
      if (summary) {
        result.output += '\n' + chalk.dim(summary);
      }
      result.isEnd = true;
      break;
    }

    case AgentStep.ERROR:
      result.output = chalk.red(
        `\n[Error] ${data.message || JSON.stringify(data)}`
      );
      break;

    case AgentStep.BUDGET_NOT_ENOUGH:
      result.output = chalk.red(
        '\n[Warning] Budget/credits exhausted. Task paused.'
      );
      break;

    case AgentStep.CONTEXT_TOO_LONG:
      result.output = chalk.red(
        '\n[Warning] Context too long. Please start a new conversation.'
      );
      break;

    // --- Silent events (hidden from output) ---

    case AgentStep.DECOMPOSE_TEXT:
    case AgentStep.TO_SUB_TASKS:
    case AgentStep.CREATE_AGENT:
    case AgentStep.ACTIVATE_AGENT:
    case AgentStep.DEACTIVATE_AGENT:
    case AgentStep.ACTIVATE_TOOLKIT:
    case AgentStep.DEACTIVATE_TOOLKIT:
    case AgentStep.ASSIGN_TASK:
    case AgentStep.NEW_TASK_STATE:
    case AgentStep.TERMINAL:
    case AgentStep.NOTICE:
    case AgentStep.SYNC:
      // Hidden — only final results matter
      break;

    default:
      break;
  }

  return result;
}
