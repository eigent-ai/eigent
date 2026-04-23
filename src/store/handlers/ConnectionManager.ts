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
 * ConnectionManager Module
 *
 * Responsável por gerenciar conexões SSE/streaming do chat.
 * Extraído do chatStore.ts para melhorar manutenibilidade e testabilidade.
 *
 * @module stores/handlers/ConnectionManager
 */

// TODO: Implementar extração completa do ConnectionManager
// Este é um placeholder que será implementado na Story 1.2

import { fetchEventSource } from '@microsoft/fetch-event-source';

// ============================================================================
// TYPES
// ============================================================================

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface ConnectionEvent {
  type: 'message' | 'error' | 'close' | 'open';
  data?: unknown;
  error?: Error;
}

export interface ConnectionConfig {
  taskId: string;
  url: string;
  headers?: Record<string, string>;
  onMessage?: (data: unknown) => void;
  onError?: (error: Error) => void;
  onClose?: () => void;
  onOpen?: () => void;
}

export interface ConnectionState {
  status: ConnectionStatus;
  taskId: string;
  connectedAt?: Date;
  error?: string;
}

// ============================================================================
// CONNECTION CONTROLLER
// ============================================================================

/**
 * AbortController wrapper para conexões SSE
 */
class SSEController {
  private controller: AbortController;

  constructor() {
    this.controller = new AbortController();
  }

  abort(): void {
    this.controller.abort();
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get aborted(): boolean {
    return this.controller.signal.aborted;
  }
}

// ============================================================================
// ACTIVE CONNECTIONS TRACKING
// ============================================================================

const activeConnections = new Map<string, SSEController>();
const connectionStates = new Map<string, ConnectionState>();

// ============================================================================
// CONNECTION MANAGER
// ============================================================================

export const ConnectionManager = {
  /**
   * Verifica se existe uma conexão ativa para uma tarefa
   */
  hasConnection(taskId: string): boolean {
    return activeConnections.has(taskId);
  },

  /**
   * Obtém o estado de uma conexão
   */
  getConnectionState(taskId: string): ConnectionState | undefined {
    return connectionStates.get(taskId);
  },

  /**
   * Obtém todas as conexões ativas
   */
  getActiveConnections(): string[] {
    return Array.from(activeConnections.keys());
  },

  /**
   * Fecha uma conexão específica
   */
  closeConnection(taskId: string): void {
    const controller = activeConnections.get(taskId);
    if (controller) {
      controller.abort();
      activeConnections.delete(taskId);
      connectionStates.set(taskId, {
        status: 'disconnected',
        taskId,
      });
    }
  },

  /**
   * Fecha todas as conexões ativas
   */
  closeAllConnections(): void {
    Array.from(activeConnections.keys()).forEach((taskId) => {
      this.closeConnection(taskId);
    });
  },

  /**
   * Cria uma nova conexão SSE
   */
  async connect(config: ConnectionConfig): Promise<void> {
    const { taskId, url, headers, onMessage, onError, onClose, onOpen } =
      config;

    // Fechar conexão existente se houver
    if (this.hasConnection(taskId)) {
      this.closeConnection(taskId);
    }

    const controller = new SSEController();
    activeConnections.set(taskId, controller);

    connectionStates.set(taskId, {
      status: 'connecting',
      taskId,
    });

    try {
      await fetchEventSource(url, {
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        signal: controller.signal,

        onopen(response) {
          connectionStates.set(taskId, {
            status: 'connected',
            taskId,
            connectedAt: new Date(),
          });
          onOpen?.();
          return Promise.resolve();
        },

        onmessage(event) {
          if (event.data) {
            try {
              const data = JSON.parse(event.data);
              onMessage?.(data);
            } catch {
              console.warn('Failed to parse SSE message:', event.data);
            }
          }
        },

        onerror(error) {
          connectionStates.set(taskId, {
            status: 'error',
            taskId,
            error: error instanceof Error ? error.message : String(error),
          });
          onError?.(error instanceof Error ? error : new Error(String(error)));
        },
      });
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        throw error;
      }
    } finally {
      connectionStates.set(taskId, {
        status: 'disconnected',
        taskId,
      });
      activeConnections.delete(taskId);
      onClose?.();
    }
  },

  /**
   * Reconecta com exponential backoff
   */
  async reconnect(
    config: ConnectionConfig,
    maxRetries: number = 3,
    baseDelayMs: number = 1000
  ): Promise<void> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.connect(config);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt < maxRetries - 1) {
          const delay = baseDelayMs * Math.pow(2, attempt);
          console.log(
            `Reconnection attempt ${attempt + 1} failed, retrying in ${delay}ms...`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Max reconnection attempts reached');
  },
};

export default ConnectionManager;
