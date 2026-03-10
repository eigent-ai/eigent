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
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { EigentClient } from './client.js';
import {
  addCollapsibleBlock,
  clearBlocks,
  expandBlock,
  getLastCollapsedBlock,
  renderCollapsed,
  shouldCollapse,
} from './collapsible.js';
import { renderEvent } from './renderer.js';
import { TaskTimer } from './timer.js';
import type { CliConfig, SSEEvent } from './types.js';
import { AgentStep } from './types.js';

const PROMPT = chalk.bold.cyan('\u276F ');

function showPrompt(rl: readline.Interface): void {
  const cols = process.stdout.columns || 80;
  console.log(chalk.dim('\u2500'.repeat(Math.min(cols, 80))));
  rl.prompt();
}

function shortenPath(p: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home && p.startsWith(home)) return '~' + p.slice(home.length);
  return p;
}

export async function startRepl(config: CliConfig): Promise<void> {
  const client = new EigentClient(config);
  let isStreaming = false;
  let workspace = config.workspace;
  // Persistent SSE stream — stays alive across turns
  let stream: AsyncGenerator<SSEEvent> | null = null;

  // Check backend health
  const healthy = await client.checkHealth();
  if (!healthy) {
    console.log(chalk.red(`Cannot connect to backend at ${config.apiUrl}`));
    console.log(chalk.dim('Make sure the eigent backend is running.'));
    process.exit(1);
  }

  console.log();
  console.log(
    chalk.bold.cyan('  ███████╗██╗ ██████╗ ███████╗███╗   ██╗████████╗')
  );
  console.log(
    chalk.bold.cyan('  ██╔════╝██║██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝')
  );
  console.log(
    chalk.bold.cyan('  █████╗  ██║██║  ███╗█████╗  ██╔██╗ ██║   ██║')
  );
  console.log(
    chalk.bold.cyan('  ██╔══╝  ██║██║   ██║██╔══╝  ██║╚██╗██║   ██║')
  );
  console.log(
    chalk.bold.cyan('  ███████╗██║╚██████╔╝███████╗██║ ╚████║   ██║')
  );
  console.log(
    chalk.bold.cyan('  ╚══════╝╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝')
  );
  console.log();
  console.log(
    chalk.dim(
      `  v0.1.0 | ${config.modelPlatform}/${config.modelType} | ${config.apiUrl}`
    )
  );
  console.log(chalk.dim(`  workspace: ${workspace}`));
  console.log(
    chalk.dim('  /quit, /new, /project, /workspace <path>, Ctrl+C to stop')
  );
  console.log();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: PROMPT,
  });

  // Keypress handler for Ctrl+E (expand collapsed output)
  process.stdin.on('keypress', (_str: string, key: readline.Key) => {
    if (!isStreaming && key && key.ctrl && key.name === 'e') {
      const block = getLastCollapsedBlock();
      if (block) {
        console.log(chalk.dim('\n--- Expanded output ---'));
        console.log(expandBlock(block));
        console.log(chalk.dim('--- End expanded output ---'));
        showPrompt(rl);
      }
    }
  });

  // Handle Ctrl+C
  rl.on('SIGINT', async () => {
    if (isStreaming) {
      console.log(chalk.yellow('\nStopping task...'));
      await client.skipTask();
      stream = null;
      isStreaming = false;
      showPrompt(rl);
    } else {
      console.log(chalk.dim('\nGoodbye!'));
      client.abort();
      rl.close();
      process.exit(0);
    }
  });

  async function handleMessage(input: string): Promise<void> {
    const trimmed = input.trim();
    if (!trimmed) {
      showPrompt(rl);
      return;
    }

    // Slash commands
    if (trimmed === '/quit' || trimmed === '/exit') {
      console.log(chalk.dim('Goodbye!'));
      client.abort();
      rl.close();
      process.exit(0);
    }
    if (trimmed === '/stop') {
      await client.stopChat();
      stream = null;
      console.log(chalk.yellow('Task stopped.'));
      showPrompt(rl);
      return;
    }
    if (trimmed === '/new') {
      client.abort();
      stream = null;
      client.newSession();
      console.log(chalk.dim('Starting new project.'));
      showPrompt(rl);
      return;
    }
    if (trimmed === '/project') {
      console.log(chalk.dim(`Current project: ${client.getProjectId()}`));
      showPrompt(rl);
      return;
    }
    if (trimmed === '/workspace') {
      console.log(chalk.dim(`Current workspace: ${workspace}`));
      showPrompt(rl);
      return;
    }
    if (trimmed.startsWith('/workspace ')) {
      const newPath = trimmed.slice('/workspace '.length).trim();
      if (!newPath) {
        console.log(chalk.dim(`Current workspace: ${workspace}`));
      } else {
        const expanded = newPath.startsWith('~/')
          ? path.join(process.env.HOME || '', newPath.slice(1))
          : newPath === '~'
            ? process.env.HOME || ''
            : newPath;
        const resolved = path.resolve(expanded);
        if (fs.existsSync(resolved)) {
          workspace = resolved;
          console.log(chalk.green(`Workspace set to: ${workspace}`));
        } else {
          console.log(chalk.red(`Path does not exist: ${resolved}`));
        }
      }
      showPrompt(rl);
      return;
    }

    // Overwrite readline echo with styled user input
    process.stdout.write('\x1B[1A\x1B[2K');
    console.log(chalk.bold.cyan('\u276F ') + chalk.bold(trimmed));

    const timer = new TaskTimer();
    timer.start();
    clearBlocks();

    isStreaming = true;
    let hasConfirmed = false;

    try {
      if (!stream) {
        // First message — open persistent SSE connection
        stream = client.startChat(trimmed, workspace);
      } else {
        // Follow-up — POST to improve endpoint, events come through existing stream
        await client.improveChat(trimmed);
      }

      // Consume events using manual .next() — for-await-of would close the
      // generator on break, making it impossible to resume for follow-ups.
      while (true) {
        const { value: event, done } = await stream.next();
        if (done || !event) break;

        const rendered = renderEvent(event);

        if (rendered.output) {
          if (rendered.raw) {
            process.stdout.write(rendered.output);
          } else if (rendered.collapsible && shouldCollapse(rendered.output)) {
            const block = addCollapsibleBlock(rendered.output);
            console.log(renderCollapsed(block));
          } else {
            console.log(rendered.output);
          }
        }

        // Auto-confirm task plan to start execution (only once per turn)
        if (event.step === AgentStep.TO_SUB_TASKS && !hasConfirmed) {
          const subTasks = event.data.sub_tasks || event.data.task || [];
          const tasks = flattenTasks(subTasks);
          if (tasks.length > 0) {
            hasConfirmed = true;
            try {
              await client.confirmAndStartTask(tasks);
              console.log(
                chalk.green('> Auto-confirmed task plan, starting...')
              );
            } catch (err: any) {
              console.log(chalk.red(`Failed to auto-start: ${err.message}`));
            }
          }
        }

        // Handle HITL: agent asking a question
        if (rendered.needsHumanReply) {
          const reply = await askUser(rl, chalk.cyan('Your reply: '));
          await client.humanReply(rendered.needsHumanReply.agent, reply);
        }

        if (rendered.isWaitConfirm) {
          // Stop consuming, but DON'T close — stream stays alive for follow-ups
          break;
        }
        if (rendered.isEnd) {
          // Conversation over — tear down stream, reset for next conversation
          client.abort();
          stream = null;
          client.newSession();
          break;
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.log(chalk.red(`Error: ${err.message}`));
      }
      // Stream is broken — reset
      stream = null;
    }

    isStreaming = false;
    console.log(chalk.dim(`\n\u2733 Completed in ${timer.format()}`));
    showPrompt(rl);
  }

  rl.on('line', (input) => {
    handleMessage(input).catch((err) => {
      console.error(chalk.red(`Unexpected error: ${err.message}`));
      stream = null;
      showPrompt(rl);
    });
  });

  showPrompt(rl);
}

function askUser(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim());
    });
  });
}

/** Flatten a tree of sub_tasks into a flat list of {id, content}. */
function flattenTasks(tasks: any[]): { id: string; content: string }[] {
  const result: { id: string; content: string }[] = [];
  for (const t of tasks) {
    result.push({
      id: t.id || String(result.length + 1),
      content: t.content || String(t),
    });
    if (Array.isArray(t.subtasks) && t.subtasks.length > 0) {
      result.push(...flattenTasks(t.subtasks));
    }
  }
  return result;
}
