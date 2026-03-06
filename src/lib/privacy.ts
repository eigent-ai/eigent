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

/** API field names for privacy settings - must match backend UserPrivacySettings */
export const PRIVACY_API_FIELDS = [
  'take_screenshot',
  'access_local_software',
  'access_your_address',
  'password_storage',
] as const;

export function isPrivacyAllEnabled(res: Record<string, unknown>): boolean {
  return PRIVACY_API_FIELDS.every((key) => res[key] === true);
}

const STORAGE_KEY = 'eigent_privacy_enabled';

export function getPrivacyStorageKey(email: string | null): string {
  return email ? `${STORAGE_KEY}_${email}` : STORAGE_KEY;
}

export function getStoredPrivacyEnabled(email: string | null): boolean {
  try {
    const key = getPrivacyStorageKey(email);
    const fallback = localStorage.getItem(STORAGE_KEY);
    return localStorage.getItem(key) === 'true' || fallback === 'true';
  } catch {
    return false;
  }
}

export function setStoredPrivacyEnabled(
  email: string | null,
  enabled: boolean
): void {
  try {
    const key = getPrivacyStorageKey(email);
    localStorage.setItem(key, enabled ? 'true' : 'false');
    if (email) localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {
    /* ignore */
  }
}
