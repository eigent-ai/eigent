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

export const PROVIDER_VALID_STATUS = {
  notValid: 1,
  valid: 2,
} as const;

export const normalizeProviderValid = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === PROVIDER_VALID_STATUS.valid;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return (
      normalized === String(PROVIDER_VALID_STATUS.valid) ||
      normalized === 'true' ||
      normalized === 'valid' ||
      normalized === 'is_valid'
    );
  }
  return false;
};

export const getProviderValid = (
  provider?: { is_valid?: unknown; is_vaild?: unknown } | null
): boolean => normalizeProviderValid(provider?.is_valid ?? provider?.is_vaild);

export const toProviderValidStatus = (isValid: boolean): number =>
  isValid ? PROVIDER_VALID_STATUS.valid : PROVIDER_VALID_STATUS.notValid;
