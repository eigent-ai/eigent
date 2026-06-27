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

const normalizeUrlIdentity = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';

  try {
    return new URL(trimmed).origin.toLowerCase();
  } catch {
    return trimmed.replace(/\/+$/, '').toLowerCase();
  }
};

const normalizeIdentityPart = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

export function getAuthEnvironmentKey(): string {
  const parts = [
    `mode:${normalizeIdentityPart(import.meta.env.MODE)}`,
    `local:${normalizeIdentityPart(import.meta.env.VITE_USE_LOCAL_PROXY)}`,
    `base:${normalizeUrlIdentity(import.meta.env.VITE_BASE_URL)}`,
    `proxy:${normalizeUrlIdentity(import.meta.env.VITE_PROXY_URL)}`,
    `brain:${normalizeUrlIdentity(import.meta.env.VITE_BRAIN_ENDPOINT)}`,
    `stack:${normalizeIdentityPart(import.meta.env.VITE_STACK_PROJECT_ID)}`,
  ];
  const key = parts.filter(Boolean).join('|');
  return key || 'eigent:local-default';
}
