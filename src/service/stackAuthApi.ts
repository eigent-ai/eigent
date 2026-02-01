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

import { proxyFetchPost } from '@/api/http';

export type StackAuthFlowType = 'login' | 'signup';

type StackLoginResponse = {
  code?: number;
  text?: string;
  [key: string]: any;
};

function isUserNotFoundResponse(
  res: StackLoginResponse | null | undefined
): boolean {
  if (!res || typeof res !== 'object') return false;
  // Backend returns code 1 for user errors (not found, blocked, etc.).
  // The text field is i18n-translated, so we cannot match on English strings.
  // Falling back to signup for any code-1 error is safe: if the user exists
  // but is blocked, the signup call returns the same "blocked" error.
  return res.code === 1;
}

export async function loginByStackToken(params: {
  token: string;
  type: StackAuthFlowType;
  inviteCode?: string;
}): Promise<StackLoginResponse> {
  const searchParams = new URLSearchParams();
  searchParams.set('token', params.token);
  searchParams.set('type', params.type);
  if (params.inviteCode) {
    searchParams.set('invite_code', params.inviteCode);
  }

  // Endpoint is defined as POST, but consumes query params.
  return proxyFetchPost(`/api/login-by_stack?${searchParams.toString()}`, {
    token: params.token,
    invite_code: params.inviteCode ?? '',
  });
}

export function getLoginErrorMessage(
  data: any,
  fallbackCheckEmail: string,
  fallbackGeneric: string
): string {
  if (!data || typeof data !== 'object' || typeof data.code !== 'number') {
    return '';
  }

  if (data.code === 0) {
    return '';
  }

  if (data.code === 10) {
    return data.text || fallbackCheckEmail;
  }

  if (data.code === 1 && Array.isArray(data.error) && data.error.length > 0) {
    const firstError = data.error[0];
    if (typeof firstError === 'string') {
      return firstError;
    }
    if (typeof firstError?.msg === 'string') {
      return firstError.msg;
    }
    if (typeof firstError?.message === 'string') {
      return firstError.message;
    }
  }

  return data.text || fallbackGeneric;
}

/**
 * Attempts a passwordless SSO login first, and auto-creates the user if not found.
 * This matches the UX request: "check existing profile; if missing, create like signup".
 */
export async function loginByStackWithAutoCreate(
  token: string
): Promise<StackLoginResponse> {
  const loginRes = await loginByStackToken({ token, type: 'login' });
  if (!isUserNotFoundResponse(loginRes)) return loginRes;
  return loginByStackToken({ token, type: 'signup' });
}
