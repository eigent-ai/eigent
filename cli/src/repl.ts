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
const INPUT_BG = chalk.bgHex('#2a2a3a');
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const SLASH_COMMANDS = [
  { name: '/new', description: 'Start a new project' },
  { name: '/workspace', description: 'Show or set workspace path' },
  { name: '/project', description: 'Show current project ID' },
  { name: '/stop', description: 'Stop the current task' },
  { name: '/quit', description: 'Exit the CLI' },
];

function showPrompt(rl: readline.Interface): void {
  const cols = process.stdout.columns || 80;
  console.log(chalk.dim('\u2500'.repeat(Math.min(cols, 80))));
  rl.prompt();
}

/** Overwrite readline echo with styled input (background color strip). */
function echoInput(text: string): void {
  const cols = process.stdout.columns || 80;
  const prefix = '\u276F ';
  const padding = Math.max(0, cols - prefix.length - text.length);
  process.stdout.write('\x1B[1A\x1B[2K');
  console.log(
    INPUT_BG(chalk.bold.cyan(prefix) + chalk.bold(text) + ' '.repeat(padding))
  );
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

  function showBanner(): void {
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
  }

  showBanner();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: PROMPT,
  });

  // Keypress handler for Ctrl+E and "/" command picker trigger
  let pickerActive = false;
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

    // "/" typed on empty line → immediately open command picker
    const currentLine = (rl as any).line as string | undefined;
    if (_str === '/' && currentLine === '/' && !pickerActive && !isStreaming) {
      pickerActive = true;

      // Overwrite readline's echoed "❯ /" with styled version
      process.stdout.write('\r\x1B[2K');
      const cols = process.stdout.columns || 80;
      const pfx = '\u276F ';
      const pad = Math.max(0, cols - pfx.length - 1);
      console.log(
        INPUT_BG(chalk.bold.cyan(pfx) + chalk.bold('/') + ' '.repeat(pad))
      );

      // Open picker (it handles stdin takeover internally)
      pickCommand('')
        .then(async (picked) => {
          pickerActive = false;
          // Clear readline's internal buffer so it doesn't have stale "/"
          (rl as any).line = '';
          (rl as any).cursor = 0;

          if (picked) {
            // Overwrite the "❯ /" line with the picked command
            process.stdout.write('\x1B[1A\x1B[2K');
            const pad2 = Math.max(0, cols - pfx.length - picked.length);
            console.log(
              INPUT_BG(
                chalk.bold.cyan(pfx) + chalk.bold(picked) + ' '.repeat(pad2)
              )
            );
            await handleMessage(picked, true);
          } else {
            // Cancelled — erase the styled "/" line, show clean prompt
            process.stdout.write('\x1B[1A\x1B[2K');
            showPrompt(rl);
          }
        })
        .catch(() => {
          pickerActive = false;
          (rl as any).line = '';
          (rl as any).cursor = 0;
          showPrompt(rl);
        });
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

  /**
   * Interactive command picker using raw stdin data events.
   * Bypasses readline/keypress entirely — parses ANSI escape sequences
   * from raw bytes for maximum reliability.
   */
  function pickCommand(initialFilter: string): Promise<string | null> {
    return new Promise((resolve) => {
      let selected = 0;
      let filter = initialFilter;
      let lastDrawn = 0;
      let resolved = false;

      function getFiltered() {
        return SLASH_COMMANDS.filter((c) => c.name.startsWith('/' + filter));
      }

      function drawMenu(): void {
        if (lastDrawn > 0) {
          process.stdout.write(`\x1B[${lastDrawn}A\x1B[J`);
        }
        const filtered = getFiltered();
        if (filtered.length === 0) {
          lastDrawn = 0;
        } else {
          for (let i = 0; i < filtered.length; i++) {
            const cmd = filtered[i];
            if (i === selected) {
              console.log(
                `  ${chalk.cyan('\u25B8')} ${chalk.cyan.bold(cmd.name.padEnd(13))}${cmd.description}`
              );
            } else {
              console.log(
                `    ${chalk.dim(cmd.name.padEnd(13))}${chalk.dim(cmd.description)}`
              );
            }
          }
          lastDrawn = filtered.length;
        }
      }

      function updateInputLine(): void {
        const cols = process.stdout.columns || 80;
        const text = '/' + filter;
        const pfx = '\u276F ';
        const pad = Math.max(0, cols - pfx.length - text.length);
        // Move up past menu + input line, clear everything below
        process.stdout.write(`\x1B[${lastDrawn + 1}A\x1B[J`);
        console.log(
          INPUT_BG(chalk.bold.cyan(pfx) + chalk.bold(text) + ' '.repeat(pad))
        );
        lastDrawn = 0;
        drawMenu();
      }

      function finish(result: string | null): void {
        if (resolved) return;
        resolved = true;
        process.stdin.removeListener('data', onData);
        if (lastDrawn > 0) {
          process.stdout.write(`\x1B[${lastDrawn}A\x1B[J`);
        }
        // Restore all saved listeners and resume readline
        for (const fn of savedDataListeners) {
          process.stdin.on('data', fn as (...args: any[]) => void);
        }
        for (const fn of savedKpListeners) {
          process.stdin.on('keypress', fn as (...args: any[]) => void);
        }
        rl.resume();
        resolve(result);
      }

      function onData(buf: Buffer): void {
        const s = buf.toString();
        const filtered = getFiltered();

        if (s === '\x1B[A' || s === '\x1BOA') {
          // Arrow up
          if (filtered.length > 0) {
            selected = (selected - 1 + filtered.length) % filtered.length;
            drawMenu();
          }
        } else if (s === '\x1B[B' || s === '\x1BOB') {
          // Arrow down
          if (filtered.length > 0) {
            selected = (selected + 1) % filtered.length;
            drawMenu();
          }
        } else if (s === '\r' || s === '\n') {
          // Enter
          if (filtered.length > 0 && selected < filtered.length) {
            finish(filtered[selected].name);
          } else if (filter.length > 0) {
            // No match — return typed text as plain input
            finish('/' + filter);
          } else {
            finish(null);
          }
        } else if (s === '\x1B') {
          // Escape
          finish(null);
        } else if (s === '\x03') {
          // Ctrl+C
          finish(null);
        } else if (s === '\x7F' || s === '\b') {
          // Backspace
          if (filter.length > 0) {
            filter = filter.slice(0, -1);
            selected = 0;
            updateInputLine();
          } else {
            finish(null);
          }
        } else if (s.length === 1 && s >= ' ') {
          // Regular character — type to filter
          filter += s;
          selected = 0;
          updateInputLine();
        }
      }

      // Save and remove ALL data + keypress listeners to prevent
      // emitKeypressEvents interference with our raw data handler
      const savedKpListeners = process.stdin.rawListeners('keypress').slice();
      const savedDataListeners = process.stdin.rawListeners('data').slice();
      process.stdin.removeAllListeners('keypress');
      process.stdin.removeAllListeners('data');

      // Pause readline (releases stdin), then take raw control
      rl.pause();
      if (process.stdin.isTTY && process.stdin.setRawMode) {
        process.stdin.setRawMode(true);
      }

      // Register handler before resume to avoid missing events
      process.stdin.on('data', onData);
      process.stdin.resume();

      // Draw initial menu
      drawMenu();
    });
  }

  async function handleMessage(
    input: string,
    fromPicker = false
  ): Promise<void> {
    const trimmed = input.trim();
    if (!trimmed) {
      showPrompt(rl);
      return;
    }

    // Overwrite readline echo with styled input (bg color strip)
    if (!fromPicker) {
      echoInput(trimmed);
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
      console.clear();
      showBanner();
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

    const timer = new TaskTimer();
    timer.start();
    clearBlocks();

    isStreaming = true;
    let hasConfirmed = false;

    // Spinner while waiting for first response
    let spinnerIdx = 0;
    const spinner = setInterval(() => {
      const frame = chalk.cyan(
        SPINNER_FRAMES[spinnerIdx % SPINNER_FRAMES.length]
      );
      process.stdout.write(`\r\x1B[2K  ${frame} ${chalk.dim('Thinking...')}`);
      spinnerIdx++;
    }, 80);
    let spinnerCleared = false;
    function clearSpinner(): void {
      if (!spinnerCleared) {
        spinnerCleared = true;
        clearInterval(spinner);
        process.stdout.write('\r\x1B[2K');
      }
    }

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

        clearSpinner();
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
      clearSpinner();
      if (err.name !== 'AbortError') {
        console.log(chalk.red(`Error: ${err.message}`));
      }
      // Stream is broken — reset
      stream = null;
    }

    clearSpinner();
    isStreaming = false;
    console.log(chalk.dim(`\n\u2733 Completed in ${timer.format()}`));
    showPrompt(rl);
  }

  rl.on('line', (input) => {
    if (pickerActive) return; // Picker is handling input
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
