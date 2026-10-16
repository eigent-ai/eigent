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
import { Button } from '@/components/ui/button';
import { DsText } from '@/components/ui/ds-text';
import { Tag } from '@/components/ui/tag';
import { useHost } from '@/host';
import { markMcpOAuth, probeMcpOAuth } from '@/lib/mcpOAuth';
import { useAuthStore } from '@/store/authStore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { McpOAuthStatus } from '../../../../../electron/main/mcpOAuth/types';

export function McpOAuthControls({
  name,
  url,
  enabled,
}: {
  name: string;
  url: string;
  enabled: boolean;
}) {
  const { t } = useTranslation();
  const oauth = useHost()?.electronAPI as Window['electronAPI'] | undefined;
  const account = useAuthStore((state) => state.email) ?? '';
  const [requiresAuth, setRequiresAuth] = useState(false);
  const [authConfirmed, setAuthConfirmed] = useState(false);
  const [status, setStatus] = useState<McpOAuthStatus>({
    state: 'signin_required',
  });
  const [pending, setPending] = useState(false);
  const alive = useRef(true);
  const identity = { name, url, account };
  const refresh = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      if (!oauth?.mcpOAuthProbe || !account || !url) return;
      try {
        const config = await mcpList();
        const server = config.mcpServers[name] as
          Record<string, unknown> | undefined;
        const marked =
          server?.url === url &&
          server?.auth &&
          typeof server.auth === 'object' &&
          'type' in server.auth &&
          server.auth.type === 'oauth';
        const probe = marked
          ? { requiresAuth: true }
          : await probeMcpOAuth(oauth, url, { force });
        if (!alive.current) return;
        // A 401 without usable OAuth metadata is not a sign-in this app can
        // complete, so it is reported but never offered or marked as OAuth.
        const supportsOAuth = Boolean(probe.requiresAuth && !probe.error);
        setRequiresAuth(Boolean(probe.requiresAuth || probe.error));
        setAuthConfirmed(supportsOAuth);
        if (probe.requiresAuth) {
          if (enabled && supportsOAuth && !marked)
            await markMcpOAuth(name, url);
          if (probe.error) {
            setStatus({ state: 'error', error: probe.error });
            return;
          }
          const result = await oauth.mcpOAuthStatus({
            name,
            url,
            account,
          });
          if (alive.current) setStatus(result);
        } else if (probe.error)
          setStatus({ state: 'error', error: probe.error });
      } catch {
        if (alive.current) {
          setRequiresAuth(true);
          setStatus({ state: 'error', error: 'network' });
        }
      }
    },
    [account, enabled, name, url, oauth]
  );

  useEffect(() => {
    alive.current = true;
    const onChanged = () => void refresh();
    void refresh();
    window.addEventListener('mcp-oauth-changed', onChanged);
    return () => {
      alive.current = false;
      window.removeEventListener('mcp-oauth-changed', onChanged);
    };
  }, [refresh]);

  const signIn = async () => {
    if (!oauth) return;
    setPending(true);
    try {
      const result = await oauth.mcpOAuthSignIn(identity);
      if (alive.current) setStatus(result);
      if (result.state === 'connected') {
        // Also repairs remotes installed before OAuth support was available.
        if (enabled) await markMcpOAuth(name, url);
        window.dispatchEvent(new Event('mcp-oauth-changed'));
      }
    } catch {
      if (alive.current) setStatus({ state: 'error', error: 'network' });
    } finally {
      if (alive.current) setPending(false);
    }
  };

  if (!requiresAuth) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-ds-control-gap"
      aria-live="polite"
    >
      <Tag
        variant="secondary"
        emphasis="default"
        size="xs"
        tone={
          pending
            ? 'information'
            : status.state === 'connected'
              ? 'success'
              : status.state === 'error'
                ? 'error'
                : 'warning'
        }
      >
        {t(
          pending
            ? 'connectors.oauth-pending'
            : `connectors.oauth-${status.state}`
        )}
      </Tag>
      {pending ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void oauth?.mcpOAuthCancel(identity)}
        >
          {t('connectors.cancel')}
        </Button>
      ) : status.state === 'connected' ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            try {
              setStatus(
                (await oauth?.mcpOAuthSignOut(identity)) ?? {
                  state: 'signin_required',
                }
              );
              window.dispatchEvent(new Event('mcp-oauth-changed'));
            } catch {
              setStatus({ state: 'error', error: 'network' });
            }
          }}
        >
          {t('connectors.oauth-sign-out')}
        </Button>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            void (authConfirmed ? signIn() : refresh({ force: true }))
          }
        >
          {t(
            !authConfirmed
              ? 'connectors.retry'
              : status.state === 'error'
                ? 'connectors.oauth-reconnect'
                : 'connectors.oauth-sign-in'
          )}
        </Button>
      )}
      {status.error && status.error !== 'cancelled' ? (
        <DsText role="meta" className="text-ds-ink-muted-default">
          {t(`connectors.oauth-error-${status.error}`)}
        </DsText>
      ) : null}
    </div>
  );
}
