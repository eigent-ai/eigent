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

import { v4 as uuidv4 } from 'uuid';
import type { ChatPayload, CliConfig, SSEEvent } from './types.js';

export class EigentClient {
  private config: CliConfig;
  private base: string;
  private projectId: string;
  private abortController: AbortController | null = null;

  constructor(config: CliConfig) {
    this.config = config;
    this.base = config.apiUrl.replace(/\/+$/, '');
    this.projectId = uuidv4();
  }

  getProjectId(): string {
    return this.projectId;
  }

  /** Reset project ID for a new conversation. */
  newSession(): void {
    this.projectId = uuidv4();
  }

  /**
   * Abort the current SSE connection. Call this after you're done
   * consuming events to prevent the process from hanging.
   */
  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  async *startChat(
    question: string,
    workspace?: string
  ): AsyncGenerator<SSEEvent> {
    const taskId = uuidv4();
    const payload: ChatPayload = {
      project_id: this.projectId,
      task_id: taskId,
      question,
      email: this.config.email,
      model_platform: this.config.modelPlatform,
      model_type: this.config.modelType,
      api_key: this.config.apiKey,
      api_url: this.config.apiEndpoint || null,
      language: 'en',
      allow_local_system: true,
      attaches: [],
      browser_port: 9222,
      installed_mcp: { mcpServers: {} },
      env_path: null,
      search_config: null,
      new_agents: [],
      summary_prompt: '',
      workspace: workspace ? `${workspace}/project_${this.projectId}` : null,
    };

    yield* this.streamSSE(`${this.base}/chat`, 'POST', payload);
  }

  async improveChat(question: string): Promise<void> {
    const taskId = uuidv4();
    const url = `${this.base}/chat/${this.projectId}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, task_id: taskId }),
    });
    if (!res.ok) {
      throw new Error(
        `Failed to send follow-up: ${res.status} ${res.statusText}`
      );
    }
  }

  async confirmAndStartTask(
    tasks: { id: string; content: string }[]
  ): Promise<void> {
    // PUT /task/{id} — update task plan
    const putUrl = `${this.base}/task/${this.projectId}`;
    const putRes = await fetch(putUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: tasks }),
    });
    if (!putRes.ok) {
      throw new Error(
        `Failed to update task: ${putRes.status} ${putRes.statusText}`
      );
    }

    // POST /task/{id}/start — trigger execution
    const startUrl = `${this.base}/task/${this.projectId}/start`;
    const startRes = await fetch(startUrl, { method: 'POST' });
    if (!startRes.ok) {
      throw new Error(
        `Failed to start task: ${startRes.status} ${startRes.statusText}`
      );
    }
  }

  async humanReply(agent: string, reply: string): Promise<void> {
    const url = `${this.base}/chat/${this.projectId}/human-reply`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent, reply }),
    });
    if (!res.ok) {
      throw new Error(
        `Failed to send human reply: ${res.status} ${res.statusText}`
      );
    }
  }

  async stopChat(): Promise<void> {
    this.abortController?.abort();
    try {
      await fetch(`${this.base}/chat/${this.projectId}`, {
        method: 'DELETE',
      });
    } catch {
      // Ignore errors on stop
    }
  }

  async skipTask(): Promise<void> {
    this.abortController?.abort();
    try {
      await fetch(`${this.base}/chat/${this.projectId}/skip-task`, {
        method: 'POST',
      });
    } catch {
      // Ignore errors on skip
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async *streamSSE(
    url: string,
    method: string,
    body?: unknown
  ): AsyncGenerator<SSEEvent> {
    this.abortController = new AbortController();

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: this.abortController.signal,
    });

    if (!res.ok) {
      throw new Error(`Backend error: ${res.status} ${res.statusText}`);
    }

    if (!res.body) {
      throw new Error('No response body');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const json = trimmed.slice(6);
          try {
            const event: SSEEvent = JSON.parse(json);
            yield event;
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      throw err;
    }
  }
}
