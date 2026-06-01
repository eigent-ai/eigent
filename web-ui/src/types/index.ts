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

export type SessionStatus = 'ongoing' | 'done' | 'unknown';

export interface WebSpace {
  id: string;
  name: string;
  folderPath: string;
}

export interface WebSession {
  id: number;
  taskId: string;
  projectId: string;
  question: string;
  summary?: string;
  status: SessionStatus;
  tokens: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface WebProject {
  projectId: string;
  name: string;
  sessionCount: number;
  totalTokens: number;
  latestActivity: string;
  lastPrompt: string;
  ongoingCount: number;
  completedCount: number;
  sessions: WebSession[];
}

export interface BillingSummary {
  email: string;
  subscription_mode: string;
  plan_name: string;
  credits_total: number;
  credits_daily: number;
  credits_monthly: number;
  credits_permanent: number;
}

export interface UserProfile {
  fullname: string;
  nickname: string;
  work_desc: string;
}

export interface UserAccount {
  email: string;
  avatar?: string;
  username?: string;
  nickname?: string;
  fullname?: string;
  work_desc?: string;
  credits: number;
}

export interface SessionTimelineItem {
  id: number;
  label: string;
  timestamp?: number;
  detail?: string;
}

export interface SessionSnapshot {
  id: number;
  imageUrl?: string;
  browserUrl?: string;
  createdAt?: string;
}

export interface SessionSidePanelData {
  taskId: string;
  status: SessionStatus;
  question: string;
  summary?: string;
  tokens: number;
  createdAt?: string;
  updatedAt?: string;
  timeline: SessionTimelineItem[];
  snapshots: SessionSnapshot[];
  resultFiles: { filename: string; url: string; relativePath?: string }[];
  errorMessage?: string;
}

export type TaskControlAction = 'pause' | 'resume' | 'stop';
