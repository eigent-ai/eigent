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

import dotenv from 'dotenv';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import type { CliConfig } from './types.js';

const CONFIG_DIR = path.join(os.homedir(), '.eigent');
const CONFIG_FILE = path.join(CONFIG_DIR, 'cli-config.json');

const DEFAULTS: CliConfig = {
  apiUrl: 'http://localhost:5001',
  apiKey: '',
  modelPlatform: 'openai',
  modelType: 'gpt-4o',
  email: 'cli@eigent.ai',
  workspace: process.cwd(),
  apiEndpoint: null,
};

/**
 * Find and load .env.development by walking up from cwd to find the repo root.
 */
function loadDotEnv(): void {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    const envFile = path.join(dir, '.env.development');
    if (fs.existsSync(envFile)) {
      dotenv.config({ path: envFile, quiet: true } as any);
      return;
    }
    dir = path.dirname(dir);
  }
}

export function loadConfig(): CliConfig {
  // Load .env.development first (won't override existing env vars)
  loadDotEnv();

  const config = { ...DEFAULTS };

  // Load from file
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const stored = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      Object.assign(config, stored);
    } catch {
      // Ignore invalid config file
    }
  }

  // Env vars override file config
  if (process.env.EIGENT_API_URL) config.apiUrl = process.env.EIGENT_API_URL;
  if (process.env.EIGENT_API_KEY) config.apiKey = process.env.EIGENT_API_KEY;
  if (process.env.EIGENT_MODEL_PLATFORM)
    config.modelPlatform = process.env.EIGENT_MODEL_PLATFORM;
  if (process.env.EIGENT_MODEL_TYPE)
    config.modelType = process.env.EIGENT_MODEL_TYPE;
  if (process.env.EIGENT_EMAIL) config.email = process.env.EIGENT_EMAIL;
  if (process.env.EIGENT_WORKSPACE)
    config.workspace = process.env.EIGENT_WORKSPACE;
  if (process.env.EIGENT_API_ENDPOINT)
    config.apiEndpoint = process.env.EIGENT_API_ENDPOINT;

  return config;
}

export function saveConfig(config: Partial<CliConfig>): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  const existing = loadConfig();
  const merged = { ...existing, ...config };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2) + '\n');
}

function ask(
  rl: readline.Interface,
  question: string,
  defaultVal: string
): Promise<string> {
  return new Promise((resolve) => {
    rl.question(`${question} [${defaultVal}]: `, (answer) => {
      resolve(answer.trim() || defaultVal);
    });
  });
}

export async function runConfigWizard(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const current = loadConfig();

  console.log('\nEigent CLI Configuration\n');

  const apiUrl = await ask(rl, 'Backend URL', current.apiUrl);
  const apiKey = await ask(rl, 'API Key', current.apiKey || 'sk-...');
  const modelPlatform = await ask(rl, 'Model Platform', current.modelPlatform);
  const modelType = await ask(rl, 'Model Type', current.modelType);
  const email = await ask(rl, 'Email', current.email);

  saveConfig({ apiUrl, apiKey, modelPlatform, modelType, email });
  console.log(`\nConfig saved to ${CONFIG_FILE}\n`);
  rl.close();
}
