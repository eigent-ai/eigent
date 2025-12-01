// History API types for project-grouped structure

export interface HistoryTask {
  id: number;
  task_id: string;
  project_id: string;
  question: string;
  language: string;
  model_platform: string;
  model_type: string;
  api_key?: string;
  api_url?: string;
  max_retries: number;
  file_save_path?: string;
  installed_mcp?: string;
  project_name?: string;
  summary?: string;
  tokens: number;
  status: number;
  created_at?: string;
  updated_at?: string;
}

export interface ProjectGroup {
  project_id: string;
  project_name?: string;
  total_tokens: number;
  task_count: number;
  latest_task_date: string;
  last_prompt: string;
  tasks: HistoryTask[];
  // Additional project-level metadata
  total_completed_tasks: number;
  total_ongoing_tasks: number;
  average_tokens_per_task: number;
}

export interface GroupedHistoryResponse {
  projects: ProjectGroup[];
  total_projects: number;
  total_tasks: number;
  total_tokens: number;
}

// Legacy flat response for backward compatibility
export interface FlatHistoryResponse {
  items: HistoryTask[];
  total: number;
  page: number;
  size: number;
}

export interface HistoryApiOptions {
  grouped?: boolean; // New parameter to control response format
  include_tasks?: boolean; // Whether to include individual tasks in groups
}