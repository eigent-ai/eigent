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
 * MessageHandler Module
 *
 * Responsável por toda manipulação de mensagens dentro do chat.
 * Extraído do chatStore.ts para melhorar manutenibilidade e testabilidade.
 *
 * @module stores/handlers/MessageHandler
 */

import { generateUniqueId } from '@/lib';

// ============================================================================
// GLOBAL TYPES (from chatbox.d.ts - redeclared here for module scope)
// ============================================================================

interface TaskInfo {
  id: string;
  content: string;
  status?: string;
  agent?: Agent;
  terminal?: string[];
  fileList?: FileInfo[];
  project_id?: string;
  toolkits?: ToolKit[];
  failure_count?: number;
  reAssignTo?: string;
}

interface ToolKit {
  toolkitName: string;
  toolkitMethods: string;
  message: string;
  toolkitStatus?: string;
}

interface FileInfo {
  name: string;
  type: string;
  path: string;
  content?: string;
  agent_id?: string;
  task_id?: string;
  project_id?: string;
  isFolder?: boolean;
  relativePath?: string;
}

interface File {
  fileName: string;
  filePath: string;
}

interface Agent {
  agent_id: string;
  name: string;
  type: string;
  status?: string;
  tasks: TaskInfo[];
  log: AgentMessage[];
}

interface AgentMessage {
  step: string;
  data: Record<string, unknown>;
  status?: string;
}

interface Message {
  id: string;
  role: 'user' | 'agent';
  content: string;
  step?: string;
  agent_id?: string;
  isConfirm?: boolean;
  taskType?: 1 | 2 | 3;
  taskInfo?: TaskInfo[];
  taskRunning?: TaskInfo[];
  summaryTask?: string;
  taskAssigning?: Agent[];
  showType?: 'tree' | 'list';
  rePort?: unknown;
  fileList?: FileInfo[];
  task_id?: string;
  summary?: string;
  agent_name?: string;
  attaches?: File[];
}

interface Task {
  messages: Message[];
  [key: string]: unknown;
}

// Re-export for external use
export type { Agent, Message, TaskInfo };

// ============================================================================
// TYPES
// ============================================================================

/** Input para adicionar uma mensagem */
export interface AddMessageInput {
  taskId: string;
  message: Message;
}

/** Input para atualizar uma mensagem */
export interface UpdateMessageInput {
  taskId: string;
  messageId: string;
  message: Partial<Message>;
}

/** Input para definir mensagens (substituição completa) */
export interface SetMessagesInput {
  taskId: string;
  messages: Message[];
}

/** Output de uma operação de mensagem */
export interface MessageOperationResult {
  success: boolean;
  error?: string;
}

/** Função setter do Zustand */
type SetFunction = (fn: (state: any) => any) => void;

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Valida se uma mensagem tem os campos obrigatórios
 */
export function validateMessage(message: Partial<Message>): message is Message {
  return (
    typeof message.id === 'string' &&
    typeof message.role === 'string' &&
    (message.role === 'user' || message.role === 'agent') &&
    typeof message.content === 'string'
  );
}

/**
 * Cria uma mensagem com ID gerado automaticamente
 */
export function createMessage(
  content: string,
  role: 'user' | 'agent',
  extras?: Partial<Message>
): Message {
  return {
    id: generateUniqueId(),
    role,
    content,
    ...extras,
  };
}

/**
 * Clona uma mensagem com overrides
 */
export function cloneMessage(
  original: Message,
  overrides: Partial<Message>
): Message {
  return {
    ...original,
    ...overrides,
    id: overrides.id || original.id, // Manter ID original se não especificado
  };
}

// ============================================================================
// MESSAGE OPERATIONS
// ============================================================================

/**
 * Adiciona uma ou mais mensagens a uma tarefa
 */
export function addMessages(
  set: SetFunction,
  taskId: string,
  messages: Message | Message[]
): MessageOperationResult {
  const messageArray = Array.isArray(messages) ? messages : [messages];

  // Validar todas as mensagens antes de adicionar
  for (const msg of messageArray) {
    if (!validateMessage(msg)) {
      return {
        success: false,
        error: `Invalid message format: missing required fields`,
      };
    }
  }

  set((state) => {
    const task = state.tasks[taskId];
    if (!task) {
      console.warn(`Task ${taskId} not found when adding messages`);
      return state;
    }

    return {
      tasks: {
        ...state.tasks,
        [taskId]: {
          ...task,
          messages: [...task.messages, ...messageArray],
          hasMessages: true,
        },
      },
    };
  });

  return { success: true };
}

/**
 * Atualiza uma mensagem existente pelo ID
 */
export function updateMessage(
  set: SetFunction,
  taskId: string,
  messageId: string,
  updates: Partial<Message>
): MessageOperationResult {
  set((state) => {
    const task = state.tasks[taskId];
    if (!task) {
      console.warn(`Task ${taskId} not found when updating message`);
      return state;
    }

    const taskWithMessages = task as { messages: Message[] };
    const messageIndex = taskWithMessages.messages.findIndex(
      (m: Message) => m.id === messageId
    );
    if (messageIndex === -1) {
      console.warn(`Message ${messageId} not found in task ${taskId}`);
      return state;
    }

    const updatedMessages = [...task.messages];
    updatedMessages[messageIndex] = {
      ...updatedMessages[messageIndex],
      ...updates,
      id: messageId, // Manter ID original
    };

    return {
      tasks: {
        ...state.tasks,
        [taskId]: {
          ...task,
          messages: updatedMessages,
        },
      },
    };
  });

  return { success: true };
}

/**
 * Substitui todas as mensagens de uma tarefa
 */
export function setMessages(
  set: SetFunction,
  taskId: string,
  messages: Message[]
): MessageOperationResult {
  // Validar todas as mensagens
  for (const msg of messages) {
    if (!validateMessage(msg)) {
      return {
        success: false,
        error: `Invalid message in array: missing required fields`,
      };
    }
  }

  set((state) => {
    const task = state.tasks[taskId];
    if (!task) {
      console.warn(`Task ${taskId} not found when setting messages`);
      return state;
    }

    return {
      tasks: {
        ...state.tasks,
        [taskId]: {
          ...task,
          messages,
          hasMessages: messages.length > 0,
        },
      },
    };
  });

  return { success: true };
}

/**
 * Remove uma mensagem pelo ID
 */
export function deleteMessage(
  set: SetFunction,
  taskId: string,
  messageId: string
): MessageOperationResult {
  set((state) => {
    const task = state.tasks[taskId];
    if (!task) {
      console.warn(`Task ${taskId} not found when deleting message`);
      return state;
    }

    const filteredMessages = (task.messages as Message[]).filter(
      (m: Message) => m.id !== messageId
    );

    return {
      tasks: {
        ...state.tasks,
        [taskId]: {
          ...task,
          messages: filteredMessages,
          hasMessages: filteredMessages.length > 0,
        },
      },
    };
  });

  return { success: true };
}

/**
 * Encontra uma mensagem pelo ID
 */
export function findMessage(
  task: Task,
  messageId: string
): Message | undefined {
  return task.messages.find((m) => m.id === messageId);
}

/**
 * Encontra o índice de uma mensagem pelo ID
 */
export function findMessageIndex(task: Task, messageId: string): number {
  return task.messages.findIndex((m) => m.id === messageId);
}

/**
 * Obtém a última mensagem de uma tarefa
 */
export function getLastMessage(task: Task): Message | undefined {
  return task.messages[task.messages.length - 1];
}

/**
 * Obtém todas as mensagens de um agente específico
 */
export function getAgentMessages(task: Task, agentId: string): Message[] {
  return task.messages.filter((m) => m.agent_id === agentId);
}

/**
 * Obtém todas as mensagens de usuário
 */
export function getUserMessages(task: Task): Message[] {
  return task.messages.filter((m) => m.role === 'user');
}

/**
 * Obtém todas as mensagens de agente
 */
export function getAgentTaskMessages(task: Task): Message[] {
  return task.messages.filter((m) => m.role === 'agent');
}

/**
 * Conta o número de mensagens em uma tarefa
 */
export function getMessageCount(task: Task): number {
  return task.messages.length;
}

// ============================================================================
// BULK OPERATIONS
// ============================================================================

/**
 * Limpa todas as mensagens de uma tarefa
 */
export function clearMessages(
  set: SetFunction,
  taskId: string
): MessageOperationResult {
  return setMessages(set, taskId, []);
}

/**
 * Adiciona múltiplas mensagens de uma vez
 */
export function addBulkMessages(
  set: SetFunction,
  taskId: string,
  messages: Message[],
  options?: {
    prepend?: boolean;
    unique?: boolean;
  }
): MessageOperationResult {
  if (messages.length === 0) {
    return { success: true };
  }

  set((state) => {
    const task = state.tasks[taskId];
    if (!task) {
      console.warn(`Task ${taskId} not found for bulk message add`);
      return state;
    }

    let newMessages: Message[];

    if (options?.prepend) {
      newMessages = options.unique
        ? [
            ...messages.filter(
              (m: Message) =>
                !task.messages.some((em: Message) => em.id === m.id)
            ),
            ...task.messages,
          ]
        : [...messages, ...task.messages];
    } else {
      newMessages = options?.unique
        ? [
            ...task.messages,
            ...messages.filter(
              (m: Message) =>
                !task.messages.some((em: Message) => em.id === m.id)
            ),
          ]
        : [...task.messages, ...messages];
    }

    return {
      tasks: {
        ...state.tasks,
        [taskId]: {
          ...task,
          messages: newMessages,
          hasMessages: newMessages.length > 0,
        },
      },
    };
  });

  return { success: true };
}

// ============================================================================
// STREAMING HELPERS
// ============================================================================

/**
 * Cria ou atualiza uma mensagem de streaming (para responses parciais)
 */
export function upsertStreamingMessage(
  set: SetFunction,
  taskId: string,
  messageId: string,
  content: string,
  extras?: Partial<Message>
): MessageOperationResult {
  set((state) => {
    const task = state.tasks[taskId];
    if (!task) return state;

    const existingIndex = task.messages.findIndex(
      (m: Message) => m.id === messageId
    );

    if (existingIndex !== -1) {
      // Update existing streaming message
      const updatedMessages = [...task.messages];
      updatedMessages[existingIndex] = {
        ...updatedMessages[existingIndex],
        content,
        ...extras,
      };
      return {
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...task,
            messages: updatedMessages,
          },
        },
      };
    } else {
      // Create new streaming message
      return {
        tasks: {
          ...state.tasks,
          [taskId]: {
            ...task,
            messages: [
              ...task.messages,
              {
                id: messageId,
                role: 'agent' as const,
                content,
                ...extras,
              },
            ],
            hasMessages: true,
          },
        },
      };
    }
  });

  return { success: true };
}

/**
 * Finaliza uma mensagem de streaming, marcandamente completada
 */
export function finalizeStreamingMessage(
  set: SetFunction,
  taskId: string,
  messageId: string,
  finalContent?: string
): MessageOperationResult {
  if (finalContent !== undefined) {
    return updateMessage(set, taskId, messageId, {
      content: finalContent,
    });
  }
  return { success: true };
}

// ============================================================================
// EXPORTS
// ============================================================================

export const MessageHandler = {
  // Core operations
  addMessages,
  updateMessage,
  setMessages,
  deleteMessage,

  // Queries
  findMessage,
  findMessageIndex,
  getLastMessage,
  getAgentMessages,
  getUserMessages,
  getAgentTaskMessages,
  getMessageCount,

  // Bulk operations
  clearMessages,
  addBulkMessages,

  // Streaming
  upsertStreamingMessage,
  finalizeStreamingMessage,

  // Utilities
  validateMessage,
  createMessage,
  cloneMessage,
};

export default MessageHandler;
