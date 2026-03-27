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

import type {
  AgentMessageStatusType,
  AgentStatusType,
  AgentStepType,
  TaskStatusType,
} from './constants';

// Global type definitions for ChatBox component

declare global {
  interface FileInfo {
    name: string;
    type: string;
    path: string;
    content?: string;
    icon?: React.ElementType;
    agent_id?: string;
    task_id?: string;
    project_id?: string;
    isFolder?: boolean;
    relativePath?: string;
  }

  interface ProjectInfo {
    id: string;
    name: string;
    path: string;
    taskCount: number;
    createdAt: Date;
  }

  interface TaskInfo {
    report?: string | undefined;
    id: string;
    content: string;
    status?: TaskStatusType;
    agent?: Agent;
    terminal?: string[];
    fileList?: FileInfo[];
    project_id?: string;
    toolkits?: {
      toolkitName: string;
      toolkitMethods: string;
      message: string;
      toolkitStatus?: AgentStatus;
    }[];
    failure_count?: number;
    reAssignTo?: string;
  }

  interface File {
    fileName: string;
    filePath: string;
  }

  type AgentStatus = AgentStatusType;

  interface ActiveWebView {
    id: string;
    url: string;
    processTaskId: string;
    img: string;
  }

  interface Agent {
    agent_id: string;
    name: string;
    type: AgentNameType;
    status?: AgentStatus;
    tasks: TaskInfo[];
    log: AgentMessage[];
    img?: string[];
    activeWebviewIds?: ActiveWebView[];
    tools?: string[];
    workerInfo?: {
      name: string;
      description: string;
      tools: any;
      mcp_tools: any;
      selectedTools: any;
    };
  }

  interface Message {
    id: string;
    role: 'user' | 'agent';
    content: string;
    step?: AgentStepType;
    agent_id?: string;
    isConfirm?: boolean;
    taskType?: 1 | 2 | 3;
    taskInfo?: TaskInfo[];
    taskRunning?: TaskInfo[];
    summaryTask?: string;
    taskAssigning?: Agent[];
    showType?: 'tree' | 'list';
    rePort?: any;
    fileList?: FileInfo[];
    task_id?: string;
    summary?: string;
    agent_name?: string;
    attaches?: File[];
  }

  interface AgentMessage {
    step: AgentStepType;
    data: {
      project_id?: string;
      failure_count?: number;
      tokens?: number;
      sub_tasks?: TaskInfo[];
      summary_task?: string;
      content?: string;
      notice?: string;
      answer?: string;
      agent_name?: string;
      agent_id?: string;
      assignee_id?: string;
      task_id?: string;
      toolkit_name?: string;
      method_name?: string;
      state?: string;
      message?: string;
      question?: string;
      agent?: string;
      file_path?: string;
      process_task_id?: string;
      output?: string;
      result?: string;
      tools?: string[];
      //Context Length
      current_length?: number;
      max_length?: number;
      text?: string;
      direct?: boolean;
    };
    status?: AgentMessageStatusType;
  }

  type AgentNameType =
    | 'developer_agent'
    | 'browser_agent'
    | 'document_agent'
    | 'multi_modal_agent'
    | 'social_media_agent';

  interface AgentNameMap {
    developer_agent: 'Developer Agent';
    browser_agent: 'Browser Agent';
    document_agent: 'Document Agent';
    multi_modal_agent: 'Multi Modal Agent';
    social_media_agent: 'Social Media Agent';
  }
  type WorkspaceType =
    | 'workflow'
    | 'developer_agent'
    | 'browser_agent'
    | 'document_agent'
    | 'multi_modal_agent'
    | 'social_media_agent'
    | null;
}

export {};
