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

import { mcpList, mcpUpdate } from '@/api/brain';
import type { McpOAuthIdentity } from '../../electron/main/mcpOAuth/types';

export type McpConnectorIssue = { name: string; reason: string };

export function mcpConnectorIssue(content: string): McpConnectorIssue | null {
  const marker = 'mcp_connector_unavailable:';
  const index = content.indexOf(marker);
  if (index >= 0) {
    try {
      const issue: unknown = JSON.parse(content.slice(index + marker.length));
      if (
        issue &&
        typeof issue === 'object' &&
        'name' in issue &&
        'reason' in issue &&
        typeof issue.name === 'string' &&
        typeof issue.reason === 'string'
      )
        return issue as McpConnectorIssue;
    } catch {
      return null;
    }
  }
  const match = content.match(
    /mcp_(oauth_required|oauth_unavailable|auth_failed):([^\s,):]+)(?::([^\s,)]+))?/
  );
  if (!match) return null;
  try {
    return {
      name: decodeURIComponent(match[2]),
      reason:
        match[1] === 'oauth_required'
          ? 'signin_required'
          : (match[3] ?? 'mcp_auth_failed'),
    };
  } catch {
    return null;
  }
}

export async function resolveMcpIdentity(
  name: string,
  account: string
): Promise<McpOAuthIdentity | null> {
  const config = await mcpList();
  const server = config.mcpServers[name];
  if (
    !server ||
    typeof server !== 'object' ||
    !('url' in server) ||
    typeof server.url !== 'string'
  )
    return null;
  return { name, account, url: server.url };
}

type McpOAuthProbeResult = Awaited<
  ReturnType<Window['electronAPI']['mcpOAuthProbe']>
>;

// Connector rows mount in both the list and the detail view, and every
// sign-in change refreshes them. Share settled probes so opening Connectors
// does not send a new initialize request to every remote server each time.
const PROBE_TTL_MS = 5 * 60_000;
const probeCache = new Map<
  string,
  { at: number; result: Promise<McpOAuthProbeResult> }
>();

export function probeMcpOAuth(
  api: Pick<Window['electronAPI'], 'mcpOAuthProbe'>,
  url: string,
  { force = false }: { force?: boolean } = {}
): Promise<McpOAuthProbeResult> {
  const cached = probeCache.get(url);
  if (!force && cached && Date.now() - cached.at < PROBE_TTL_MS)
    return cached.result;
  const result = api.mcpOAuthProbe(url).then(
    (value: McpOAuthProbeResult) => {
      // Failures are retried rather than remembered.
      if (value.error && probeCache.get(url)?.result === result)
        probeCache.delete(url);
      return value;
    },
    (error: unknown) => {
      if (probeCache.get(url)?.result === result) probeCache.delete(url);
      throw error;
    }
  );
  probeCache.set(url, { at: Date.now(), result });
  return result;
}

export function clearMcpOAuthProbeCache(): void {
  probeCache.clear();
}

// Mark a connector as OAuth only once its server has proven OAuth support or
// sign-in has succeeded. The backend then replaces any Authorization header.
export async function markMcpOAuth(name: string, url: string): Promise<void> {
  const config = await mcpList();
  const server = config.mcpServers[name] as Record<string, unknown> | undefined;
  if (!server || server.url !== url) return;
  const auth = server.auth as { type?: unknown } | undefined;
  if (auth?.type === 'oauth') return;
  await mcpUpdate(name, { ...server, auth: { type: 'oauth' } });
}
