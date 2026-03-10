#!/usr/bin/env node
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
import { Command } from 'commander';
import {
  addCollapsibleBlock,
  clearBlocks,
  renderCollapsed,
  shouldCollapse,
} from './collapsible.js';
import { loadConfig, runConfigWizard } from './config.js';
import { startRepl } from './repl.js';
import { TaskTimer } from './timer.js';

const program = new Command();

program
  .name('eigent')
  .description('Eigent AI coding agent CLI')
  .version('0.1.0');

program
  .command('config')
  .description('Configure API key, model, and backend URL')
  .action(async () => {
    await runConfigWizard();
  });

program
  .argument(
    '[question]',
    'Question to ask (starts interactive mode if omitted)'
  )
  .option('--api-url <url>', 'Backend URL')
  .option('--api-key <key>', 'API key')
  .option('--model <model>', 'Model type (e.g. gpt-4o)')
  .option('--platform <platform>', 'Model platform (e.g. openai)')
  .action(
    async (question: string | undefined, opts: Record<string, string>) => {
      const config = loadConfig();

      // CLI flags override config
      if (opts.apiUrl) config.apiUrl = opts.apiUrl;
      if (opts.apiKey) config.apiKey = opts.apiKey;
      if (opts.model) config.modelType = opts.model;
      if (opts.platform) config.modelPlatform = opts.platform;

      if (!config.apiKey) {
        console.log('No API key configured. Run: eigent config');
        process.exit(1);
      }

      if (question) {
        // One-shot mode: send question, print result, exit
        const { EigentClient } = await import('./client.js');
        const { renderEvent } = await import('./renderer.js');
        const client = new EigentClient(config);

        const healthy = await client.checkHealth();
        if (!healthy) {
          console.error(`Cannot connect to backend at ${config.apiUrl}`);
          process.exit(1);
        }

        // Styled user input echo
        console.log(chalk.bold.cyan('\u276F ') + chalk.bold(question));
        console.log();

        const timer = new TaskTimer();
        timer.start();
        clearBlocks();

        const { AgentStep } = await import('./types.js');
        let hasConfirmed = false;
        for await (const event of client.startChat(
          question,
          config.workspace
        )) {
          const rendered = renderEvent(event);
          if (rendered.output) {
            if (rendered.raw) {
              process.stdout.write(rendered.output);
            } else if (
              rendered.collapsible &&
              shouldCollapse(rendered.output)
            ) {
              const block = addCollapsibleBlock(rendered.output);
              console.log(renderCollapsed(block));
            } else {
              console.log(rendered.output);
            }
          }

          // Auto-confirm task plan to start execution (only once)
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
                console.error(
                  `Failed to auto-start: ${(err as Error).message}`
                );
              }
            }
          }

          if (rendered.isEnd || rendered.isWaitConfirm) {
            client.abort();
            break;
          }
        }

        console.log(chalk.dim(`\n\u2733 Completed in ${timer.format()}`));
      } else {
        // Interactive REPL mode
        await startRepl(config);
      }
    }
  );

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

program.parse();
