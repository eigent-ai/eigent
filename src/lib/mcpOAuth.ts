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

import { mcpList } from '@/api/brain';
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
