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

const REFRESH_TOKEN_KEY = 'eigent_web_refresh_token';

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setRefreshToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(REFRESH_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    }
  } catch {
    // ignore storage failures
  }
}

export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  email: string;
}

export function parseLoginResponse(data: unknown): LoginResponse | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  if (
    typeof record.access_token !== 'string' ||
    typeof record.refresh_token !== 'string' ||
    typeof record.email !== 'string'
  ) {
    return null;
  }
  return {
    access_token: record.access_token,
    refresh_token: record.refresh_token,
    token_type:
      typeof record.token_type === 'string' ? record.token_type : 'bearer',
    email: record.email,
  };
}
