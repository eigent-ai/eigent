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
import { Button } from '@/components/ui/button';
import { DsText } from '@/components/ui/ds-text';
import { useHost } from '@/host';
import { resolveMcpIdentity, type McpConnectorIssue } from '@/lib/mcpOAuth';
import { useAuthStore } from '@/store/authStore';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { McpOAuthIdentity } from '../../../electron/main/mcpOAuth/types';

export function McpConnectorNotice({ issue }: { issue: McpConnectorIssue }) {
  const { t } = useTranslation();
  const oauth = useHost()?.electronAPI as Window['electronAPI'] | undefined;
  const account = useAuthStore((state) => state.email) ?? '';
  const [pending, setPending] = useState<McpOAuthIdentity | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    [
      'broker_unavailable',
      'network',
      'encryption_unavailable',
      'invalid_request',
      'invalid_metadata',
    ].includes(issue.reason)
      ? issue.reason
      : null
  );
  const needsSignIn = [
    'signin_required',
    'mcp_auth_failed',
    'refresh_failed',
  ].includes(issue.reason);
  const signIn = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const identity = await resolveMcpIdentity(issue.name, account);
      if (!identity || !oauth?.mcpOAuthSignIn) {
        setError('broker_unavailable');
        return;
      }
      const config = await mcpList();
      await mcpUpdate(identity.name, {
        ...(config.mcpServers[identity.name] as Record<string, unknown>),
        auth: { type: 'oauth' },
      });
      setPending(identity);
      const result = await oauth.mcpOAuthSignIn(identity);
      setConnected(result.state === 'connected');
      setError(result.error ?? null);
      window.dispatchEvent(new Event('mcp-oauth-changed'));
    } catch {
      setError('network');
    } finally {
      setPending(null);
      setBusy(false);
    }
  };
  return (
    <aside
      className="flex flex-wrap items-center gap-ds-12 rounded-ds-card bg-ds-bg-warning-subtle-default p-ds-12"
      data-mcp-connector-notice={issue.name}
      aria-live="polite"
    >
      <div className="min-w-0 flex-1 break-words">
        <DsText role="base">
          {t(
            connected
              ? 'connectors.oauth-task-ready'
              : needsSignIn
                ? 'connectors.oauth-task-signin'
                : 'connectors.oauth-task-unavailable',
            { name: issue.name }
          )}
        </DsText>
        {error && error !== 'cancelled' ? (
          <DsText role="meta">{t(`connectors.oauth-error-${error}`)}</DsText>
        ) : null}
      </div>
      {pending ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void oauth?.mcpOAuthCancel(pending)}
        >
          {t('connectors.cancel')}
        </Button>
      ) : !connected && needsSignIn ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => void signIn()}
        >
          {t('connectors.oauth-sign-in')}
        </Button>
      ) : null}
    </aside>
  );
}
