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

import {
  proxyFetchDelete,
  proxyFetchGet,
  proxyFetchPost,
  proxyFetchPut,
} from '@/api/http';
import { getAuthStore } from '@/store/authStore';
import type { GroupedHistoryResponse, ProjectGroup } from '@/types/history';
import {
  getRefreshToken,
  parseLoginResponse,
  setRefreshToken,
} from '@web/lib/authTokens';
import { isWebUiMock } from '@web/lib/mockMode';
import { getMockGroupedProjects, getMockProjectGroup } from '@web/mock/state';
import type { BillingSummary, UserAccount, UserProfile } from '@web/types';

export async function loginWithPassword(
  email: string,
  password: string
): Promise<void> {
  const response = await proxyFetchPost('/api/v1/user/login', {
    email,
    password,
  });
  const parsed = parseLoginResponse(response);
  if (!parsed) {
    throw new Error('Invalid login response');
  }
  setRefreshToken(parsed.refresh_token);
  getAuthStore().setAuth({
    token: parsed.access_token,
    email: parsed.email,
    username: parsed.email.split('@')[0],
    user_id: 0,
  });
}

export async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const response = await proxyFetchPost('/api/v1/user/refresh', {
      refresh_token: refreshToken,
    });
    const parsed = parseLoginResponse(response);
    if (!parsed) return false;
    setRefreshToken(parsed.refresh_token);
    getAuthStore().setAuth({
      token: parsed.access_token,
      email: parsed.email,
      username: parsed.email.split('@')[0],
      user_id: getAuthStore().user_id ?? 0,
    });
    return true;
  } catch {
    return false;
  }
}

export function logoutWeb(): void {
  setRefreshToken(null);
  getAuthStore().logout();
}

export async function fetchCurrentUser(): Promise<UserAccount> {
  return proxyFetchGet('/api/v1/user') as Promise<UserAccount>;
}

export async function updateUserProfile(
  profile: UserProfile
): Promise<UserProfile> {
  return proxyFetchPut('/api/v1/user/profile', profile) as Promise<UserProfile>;
}

export async function fetchBillingSummary(): Promise<BillingSummary> {
  return proxyFetchGet(
    '/api/v1/user/billing-summary'
  ) as Promise<BillingSummary>;
}

export async function fetchGroupedProjects(): Promise<ProjectGroup[]> {
  if (isWebUiMock()) {
    return getMockGroupedProjects();
  }
  const response = (await proxyFetchGet(
    '/api/v1/chat/histories/grouped?include_tasks=true'
  )) as GroupedHistoryResponse;
  return response?.projects ?? [];
}

export async function fetchProjectGroup(
  projectId: string
): Promise<ProjectGroup | null> {
  if (isWebUiMock()) {
    return getMockProjectGroup(projectId);
  }
  try {
    return (await proxyFetchGet(
      `/api/v1/chat/histories/grouped/${encodeURIComponent(projectId)}`
    )) as ProjectGroup;
  } catch {
    return null;
  }
}

export async function renameProject(
  projectId: string,
  newName: string
): Promise<void> {
  await proxyFetchPut(
    `/api/v1/chat/project/${encodeURIComponent(projectId)}/name?new_name=${encodeURIComponent(newName)}`
  );
}

export async function deleteHistory(historyId: number): Promise<void> {
  await proxyFetchDelete(`/api/v1/chat/history/${historyId}`);
}

export async function fetchChatSteps(taskId: string): Promise<
  {
    id: number;
    step: string;
    data: unknown;
    timestamp?: number | null;
  }[]
> {
  return proxyFetchGet('/api/v1/chat/steps', { task_id: taskId }) as Promise<
    {
      id: number;
      step: string;
      data: unknown;
      timestamp?: number | null;
    }[]
  >;
}

export async function fetchChatSnapshots(apiTaskId: string): Promise<
  {
    id: number;
    image_url?: string;
    browser_url?: string;
    created_at?: string;
  }[]
> {
  return proxyFetchGet('/api/v1/chat/snapshots', {
    api_task_id: apiTaskId,
  }) as Promise<
    {
      id: number;
      image_url?: string;
      browser_url?: string;
      created_at?: string;
    }[]
  >;
}

export async function autoLoginLocal(): Promise<void> {
  const response = (await proxyFetchPost('/api/v1/user/auto-login')) as {
    token?: string;
    email?: string;
  };
  if (!response?.token || !response?.email) {
    throw new Error('Auto login failed');
  }
  getAuthStore().setAuth({
    token: response.token,
    email: response.email,
    username: response.email.split('@')[0],
    user_id: 0,
  });
}
