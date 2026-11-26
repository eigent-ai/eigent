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

import { fetchGet, fetchPost } from '@/api/http';
import type { Provider } from '@/types';

// Apple Intelligence as a local provider. See
// docs/apple-intelligence-models-plan.md. The backend owns the decision of
// whether it can run here; this module only reads that answer and never lets
// a failed check break Settings or model selection.

export const APPLE_INTELLIGENCE_PROVIDER_ID = 'apple-intelligence' as const;
export const APPLE_ON_DEVICE_MODEL = 'apple-on-device' as const;
export const APPLE_INTELLIGENCE_NAME = 'Apple Intelligence';

/** Saved records keep no endpoint; the backend fills in the live bridge. */
export const APPLE_INTELLIGENCE_API_KEY = 'not-required';

export const appleIntelligenceProvider: Provider = {
  id: APPLE_INTELLIGENCE_PROVIDER_ID,
  name: APPLE_INTELLIGENCE_NAME,
  apiKey: '',
  apiHost: '',
  description: '',
};

export type AppleIntelligenceModelStatus = {
  id: string;
  available: boolean;
  reason: string | null;
  context_size: number | null;
  capabilities: string[];
};

export type AppleIntelligenceStatus = {
  available: boolean;
  reason: string | null;
  models: AppleIntelligenceModelStatus[];
};

export type AppleIntelligenceTestResult = {
  ok: boolean;
  elapsed_ms: number | null;
  code?: string;
  message?: string;
};

/** Reasons with their own status copy in `setting.apple-intelligence.*`. */
const KNOWN_REASONS = new Set([
  'not_apple_silicon',
  'bridge_missing',
  'bridge_unavailable',
  'unsupported_os',
  'not_eligible',
  'apple_intelligence_off',
  'model_not_ready',
]);

/** Shown when the backend's answer could not be read. */
export const UNREADABLE_APPLE_INTELLIGENCE_STATUS: AppleIntelligenceStatus = {
  available: false,
  reason: 'bridge_unavailable',
  models: [],
};

/**
 * Whether Settings offers the provider. Only the macOS desktop app offers it:
 * Windows, Linux and the web client never see it. Unsupported Macs (Intel,
 * older macOS) still see it, with the reason it cannot run. Nothing is
 * started until the provider is opened.
 */
export function isAppleIntelligenceOffered(
  platform: string | null | undefined
): boolean {
  return platform === 'darwin';
}

/** i18n key for the status line. */
export function appleIntelligenceStatusKey(
  status: AppleIntelligenceStatus
): string {
  if (status.available) return 'setting.apple-intelligence.ready';
  const reason = status.reason ?? '';
  return `setting.apple-intelligence.${
    KNOWN_REASONS.has(reason) ? reason.replace(/_/g, '-') : 'unavailable'
  }`;
}

export function onDeviceModel(
  status: AppleIntelligenceStatus
): AppleIntelligenceModelStatus | undefined {
  return status.models.find((model) => model.id === APPLE_ON_DEVICE_MODEL);
}

function parseStatus(value: unknown): AppleIntelligenceStatus | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.available !== 'boolean') return null;
  const models = Array.isArray(raw.models)
    ? raw.models.flatMap((model): AppleIntelligenceModelStatus[] => {
        if (!model || typeof model !== 'object') return [];
        const item = model as Record<string, unknown>;
        if (typeof item.id !== 'string') return [];
        return [
          {
            id: item.id,
            available: item.available === true,
            reason: typeof item.reason === 'string' ? item.reason : null,
            context_size:
              typeof item.context_size === 'number' ? item.context_size : null,
            capabilities: Array.isArray(item.capabilities)
              ? item.capabilities.filter(
                  (entry): entry is string => typeof entry === 'string'
                )
              : [],
          },
        ];
      })
    : [];
  return {
    available: raw.available,
    reason: typeof raw.reason === 'string' ? raw.reason : null,
    models,
  };
}

/**
 * The backend's answer, or null when it could not be read (an older backend,
 * a network error). Callers treat null as "hide the provider".
 */
export async function fetchAppleIntelligenceStatus(
  refresh = false
): Promise<AppleIntelligenceStatus | null> {
  try {
    const response = await fetchGet(
      '/model/apple-intelligence/status',
      refresh ? { refresh: true } : undefined
    );
    return parseStatus(response);
  } catch {
    return null;
  }
}

export async function testAppleIntelligence(): Promise<AppleIntelligenceTestResult> {
  try {
    const response = await fetchPost('/model/apple-intelligence/test');
    if (response && typeof response.ok === 'boolean') {
      return {
        ok: response.ok,
        elapsed_ms:
          typeof response.elapsed_ms === 'number' ? response.elapsed_ms : null,
        code: typeof response.code === 'string' ? response.code : undefined,
        message:
          typeof response.message === 'string' ? response.message : undefined,
      };
    }
  } catch {
    // Reported below as a failed test.
  }
  return { ok: false, elapsed_ms: null, code: 'bridge_unavailable' };
}
