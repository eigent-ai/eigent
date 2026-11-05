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

/**
 * Env Hub through its connector (the Connector Gateway's env_hub provider):
 * a finished Task is bundled on this computer, uploaded to the one-time URL
 * the connector hands out, and converted into an environment. The bytes go
 * straight from the local backend to that URL, never through the connector.
 */

import {
  executeConnectorAction,
  fetchConnectorProvider,
  type ConnectorProvider,
} from '@/api/connectors';
import {
  uploadRunHarborTaskBundle,
  type RunHarborTaskBundle,
} from '@/service/workspaceGitApi';

export const ENV_HUB_SERVICE = 'env_hub';
const BUNDLE_FORMAT = '1';
const SUBMISSIONS_KEY = 'eigent-env-hub-submissions';

export type EnvHubConversionStatus =
  'queued' | 'running' | 'succeeded' | 'failed';

export interface EnvHubConversion {
  conversion_id: string;
  status: EnvHubConversionStatus;
  stage?: string | null;
  environment_id?: string | null;
  environment_url?: string | null;
  error?: { code?: string; message?: string } | null;
}

interface EnvHubUpload {
  upload_id: string;
  upload_url: string;
  method: string;
  headers?: Record<string, string>;
}

/** Whether this account's Connector Gateway offers Env Hub, and its connection. */
export async function fetchEnvHubProvider(): Promise<ConnectorProvider | null> {
  const response = await fetchConnectorProvider(ENV_HUB_SERVICE);
  return response.enabled && response.provider ? response.provider : null;
}

export const isEnvHubConnected = (provider: ConnectorProvider | null) =>
  Boolean(provider?.connection?.configured);

/** Upload a bundled Task to Env Hub and start its conversion. */
export async function submitRunToEnvHub(
  runId: string,
  made: RunHarborTaskBundle
): Promise<EnvHubConversion> {
  const upload = await executeConnectorAction<EnvHubUpload>(
    `${ENV_HUB_SERVICE}.create_upload`,
    {
      filename: made.bundle.filename,
      contentType: made.bundle.content_type,
      sizeBytes: made.bundle.size_bytes,
      sha256: made.bundle.sha256,
    }
  );
  await uploadRunHarborTaskBundle(runId, {
    upload_url: upload.upload_url,
    method: upload.method || 'PUT',
    headers: upload.headers ?? {},
  });
  return executeConnectorAction<EnvHubConversion>(
    `${ENV_HUB_SERVICE}.submit_conversion`,
    {
      uploadId: upload.upload_id,
      title: made.title,
      formatVersion: BUNDLE_FORMAT,
      source: {
        app: 'eigent',
        appVersion: import.meta.env.VITE_APP_VERSION || 'dev',
        taskId: runId,
      },
    }
  );
}

export const fetchEnvHubConversion = (conversionId: string) =>
  executeConnectorAction<EnvHubConversion>(
    `${ENV_HUB_SERVICE}.get_conversion`,
    { conversionId }
  );

export const isEnvHubConversionDone = (conversion: EnvHubConversion) =>
  conversion.status === 'succeeded' || conversion.status === 'failed';

type Submissions = Record<string, EnvHubConversion>;

function readSubmissions(): Submissions {
  try {
    const value = JSON.parse(localStorage.getItem(SUBMISSIONS_KEY) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

/** The Env Hub conversion last started for a Task on this computer. */
export function rememberedEnvHubConversion(
  runId: string
): EnvHubConversion | null {
  return readSubmissions()[runId] ?? null;
}

export function rememberEnvHubConversion(
  runId: string,
  conversion: EnvHubConversion
): void {
  try {
    localStorage.setItem(
      SUBMISSIONS_KEY,
      JSON.stringify({ ...readSubmissions(), [runId]: conversion })
    );
  } catch {
    // Without storage the status is only kept while the card is shown.
  }
}
