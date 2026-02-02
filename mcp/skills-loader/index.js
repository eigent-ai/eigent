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

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findRepoRoot(startDir) {
  let current = startDir;
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(current, 'package.json'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return startDir;
}

const repoRoot = findRepoRoot(__dirname);
const skillsDir = process.env.SKILLS_DIR
  ? path.resolve(process.env.SKILLS_DIR)
  : path.join(repoRoot, 'skills');

function listSkillFiles() {
  if (!fs.existsSync(skillsDir)) {
    return [];
  }
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => entry.name);
}

function getSkillPath(name) {
  const safeName = String(name || '').trim();
  if (!safeName) return null;

  const files = listSkillFiles();
  const exact = files.find((f) => f === safeName);
  const byStem = files.find((f) => path.parse(f).name === safeName);
  const picked = exact || byStem;
  if (!picked) return null;

  const fullPath = path.resolve(skillsDir, picked);
  if (!fullPath.startsWith(skillsDir)) {
    return null;
  }
  return fullPath;
}

const server = new Server(
  { name: 'skills-loader', version: '0.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'list_skills',
        description: 'List available skill files in the skills directory.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_skill',
        description: 'Get a skill file content by name.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Skill filename or stem (without extension).',
            },
          },
          required: ['name'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params ?? {};

  if (name === 'list_skills') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ skillsDir, files: listSkillFiles() }, null, 2),
        },
      ],
    };
  }

  if (name === 'get_skill') {
    const skillPath = getSkillPath(args?.name);
    if (!skillPath) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { ok: false, error: 'Skill not found', name: args?.name },
              null,
              2
            ),
          },
        ],
      };
    }
    const content = fs.readFileSync(skillPath, 'utf-8');
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { ok: true, name: path.basename(skillPath), content },
            null,
            2
          ),
        },
      ],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: `Unknown tool: ${String(name)}`,
      },
    ],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
