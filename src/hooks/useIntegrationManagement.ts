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

import {
  fetchDelete,
  fetchPost,
  proxyFetchDelete,
  proxyFetchGet,
  proxyFetchPost,
  proxyFetchPut,
} from '@/api/http';
import { useAuthStore } from '@/store/authStore';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface IntegrationItem {
  key: string;
  name: string;
  desc: string | React.ReactNode;
  env_vars: string[];
  toolkit?: string;
  onInstall: () => void | Promise<void>;
}

/**
 * Hook for managing integration configurations, OAuth, and installation state
 */
export function useIntegrationManagement(items: IntegrationItem[]) {
  const { email, checkAgentTool } = useAuthStore();

  // Local installed status
  const [installed, setInstalled] = useState<{ [key: string]: boolean }>({});
  // Configs cache
  const [configs, setConfigs] = useState<any[]>([]);
  // Lock to prevent concurrent OAuth processing
  const isLockedRef = useRef(false);
  // Cache OAuth event when items are not ready
  const pendingOauthEventRef = useRef<{
    provider: string;
    code: string;
  } | null>(null);
  const [callBackUrl, setCallBackUrl] = useState<string | null>(null);

  // Fetch installed configs
  const fetchInstalled = useCallback(async (ignore: boolean = false) => {
    try {
      const configsRes = await proxyFetchGet('/api/configs');
      if (!ignore) {
        setConfigs(Array.isArray(configsRes) ? configsRes : []);
      }
    } catch (_e) {
      if (!ignore) setConfigs([]);
    }
  }, []);

  // Fetch configs when mounted
  useEffect(() => {
    let ignore = false;
    fetchInstalled(ignore);
    return () => {
      ignore = true;
    };
  }, [fetchInstalled]);

  // Recalculate installed status when items or configs change
  useEffect(() => {
    const map: { [key: string]: boolean } = {};

    items.forEach((item) => {
      if (item.key === 'Google Calendar') {
        // Only mark installed when refresh token is present (auth completed)
        const hasRefreshToken = configs.some(
          (c: any) =>
            c.config_group?.toLowerCase() === 'google calendar' &&
            c.config_name === 'GOOGLE_REFRESH_TOKEN' &&
            c.config_value &&
            String(c.config_value).length > 0
        );
        map[item.key] = hasRefreshToken;
      } else if (item.key === 'LinkedIn') {
        // LinkedIn: check if access token is present
        const hasAccessToken = configs.some(
          (c: any) =>
            c.config_group?.toLowerCase() === 'linkedin' &&
            c.config_name === 'LINKEDIN_ACCESS_TOKEN' &&
            c.config_value &&
            String(c.config_value).length > 0
        );
        map[item.key] = hasAccessToken;
      } else {
        // For other integrations, use config_group presence
        const hasConfig = configs.some(
          (c: any) => c.config_group?.toLowerCase() === item.key.toLowerCase()
        );
        map[item.key] = hasConfig;
      }
    });

    setInstalled(map);
  }, [items, configs]);

  // Save environment variable and config
  const saveEnvAndConfig = useCallback(
    async (provider: string, envVarKey: string, value: string) => {
      const configPayload = {
        // Keep exact group name to satisfy backend whitelist
        config_group: provider,
        config_name: envVarKey,
        config_value: value,
      };

      // Fetch latest configs to avoid stale state when deciding POST/PUT
      let latestConfigs: any[] = Array.isArray(configs) ? configs : [];
      try {
        const fresh = await proxyFetchGet('/api/configs');
        if (Array.isArray(fresh)) latestConfigs = fresh;
      } catch {}

      // Backend uniqueness is by config_name for a user
      let existingConfig = latestConfigs.find(
        (c: any) => c.config_name === envVarKey
      );

      if (existingConfig) {
        await proxyFetchPut(`/api/configs/${existingConfig.id}`, configPayload);
      } else {
        const res = await proxyFetchPost('/api/configs', configPayload);
        if (
          res &&
          res.detail &&
          (res.detail as string).toLowerCase().includes('already exists')
        ) {
          try {
            const again = await proxyFetchGet('/api/configs');
            const found = Array.isArray(again)
              ? again.find((c: any) => c.config_name === envVarKey)
              : null;
            if (found) {
              await proxyFetchPut(`/api/configs/${found.id}`, configPayload);
            }
          } catch {}
        }
      }

      if (window.electronAPI?.envWrite) {
        await window.electronAPI.envWrite(email, { key: envVarKey, value });
      }
    },
    [configs, email]
  );

  // Process OAuth callback
  const processOauth = useCallback(
    async (data: { provider: string; code: string }) => {
      if (isLockedRef.current) return;
      if (!items || items.length === 0) {
        // Items not ready, cache event, wait for items to have value
        pendingOauthEventRef.current = data;
        return;
      }
      const provider = data.provider.toLowerCase();
      const hasProviderInItems = items.some(
        (item) => item.key.toLowerCase() === provider
      );
      if (!hasProviderInItems) {
        return;
      }
      isLockedRef.current = true;
      try {
        const tokenResult = await proxyFetchPost(
          `/api/oauth/${provider}/token`,
          { code: data.code }
        );
        const currentItem = items.find(
          (item) => item.key.toLowerCase() === provider
        );
        if (provider === 'slack') {
          if (
            tokenResult.access_token &&
            currentItem &&
            currentItem.env_vars &&
            currentItem.env_vars.length > 0
          ) {
            const envVarKey = currentItem.env_vars[0];
            await saveEnvAndConfig(
              currentItem.key,
              envVarKey,
              tokenResult.access_token
            );
            await fetchInstalled();
            console.log(
              'Slack authorization successful and configuration saved!'
            );
          } else {
            console.log(
              'Slack authorization successful, but access_token not found or env configuration not found'
            );
          }
        } else if (provider === 'linkedin') {
          // LinkedIn OAuth: save token via local backend endpoint and config
          if (tokenResult.access_token) {
            try {
              // Save token to local backend toolkit (token file is stored locally)
              await fetchPost('/linkedin/save-token', {
                access_token: tokenResult.access_token,
                refresh_token: tokenResult.refresh_token,
                expires_in: tokenResult.expires_in,
              });

              // Also save to config for UI status tracking
              await saveEnvAndConfig(
                'LinkedIn',
                'LINKEDIN_ACCESS_TOKEN',
                tokenResult.access_token
              );
              if (tokenResult.refresh_token) {
                await saveEnvAndConfig(
                  'LinkedIn',
                  'LINKEDIN_REFRESH_TOKEN',
                  tokenResult.refresh_token
                );
              }

              await fetchInstalled();
              console.log(
                'LinkedIn authorization successful and configuration saved!'
              );
            } catch (e) {
              console.error('Failed to save LinkedIn token:', e);
            }
          } else {
            console.log(
              'LinkedIn authorization successful, but access_token not found'
            );
          }
        }
      } catch (e: any) {
        console.log(`${data.provider} authorization failed: ${e.message || e}`);
      } finally {
        isLockedRef.current = false;
      }
    },
    [items, saveEnvAndConfig, fetchInstalled]
  );

  // Listen to main process OAuth authorization callback
  useEffect(() => {
    const handler = (_event: any, data: { provider: string; code: string }) => {
      if (!data.provider || !data.code) return;
      processOauth(data);
    };
    window.ipcRenderer?.on('oauth-authorized', handler);
    return () => {
      window.ipcRenderer?.off('oauth-authorized', handler);
    };
  }, [processOauth]);

  // Listen to OAuth callback URL notification
  useEffect(() => {
    const handler = (_event: any, data: { url: string; provider: string }) => {
      if (data.url && data.provider) {
        setCallBackUrl(data.url);
      }
    };
    window.ipcRenderer?.on('oauth-callback-url', handler);
    return () => {
      window.ipcRenderer?.off('oauth-callback-url', handler);
    };
  }, []);

  // Process cached OAuth event when items are ready
  useEffect(() => {
    if (items && items.length > 0 && pendingOauthEventRef.current) {
      const pending = pendingOauthEventRef.current;
      const provider = pending.provider.toLowerCase();
      const hasProviderInItems = items.some(
        (item) => item.key.toLowerCase() === provider
      );
      if (hasProviderInItems) {
        processOauth(pending);
        pendingOauthEventRef.current = null;
      }
    }
  }, [items, processOauth]);

  // Uninstall integration
  const handleUninstall = useCallback(
    async (item: IntegrationItem) => {
      checkAgentTool(item.key);
      const groupKey = item.key.toLowerCase();
      const toDelete = configs.filter(
        (c: any) => c.config_group && c.config_group.toLowerCase() === groupKey
      );
      for (const config of toDelete) {
        try {
          await proxyFetchDelete(`/api/configs/${config.id}`);
          // Delete env
          if (
            item.env_vars &&
            item.env_vars.length > 0 &&
            window.electronAPI?.envRemove
          ) {
            await window.electronAPI.envRemove(email, item.env_vars[0]);
          }
        } catch (_e) {
          // Ignore error
        }
      }

      // Clean up authentication tokens for Google Calendar, Notion, and LinkedIn
      if (item.key === 'Google Calendar') {
        try {
          await fetchDelete('/uninstall/tool/google_calendar');
          console.log('Cleaned up Google Calendar authentication tokens');
        } catch (e) {
          console.log('Failed to clean up Google Calendar tokens:', e);
        }
      } else if (item.key === 'Notion') {
        try {
          await fetchDelete('/uninstall/tool/notion');
          console.log('Cleaned up Notion authentication tokens');
        } catch (e) {
          console.log('Failed to clean up Notion tokens:', e);
        }
      } else if (item.key === 'LinkedIn') {
        try {
          await fetchDelete('/uninstall/tool/linkedin');
          console.log('Cleaned up LinkedIn authentication tokens');
        } catch (e) {
          console.log('Failed to clean up LinkedIn tokens:', e);
        }
      }

      // Update configs after deletion
      setConfigs((prev) =>
        prev.filter((c: any) => c.config_group?.toLowerCase() !== groupKey)
      );
    },
    [configs, email, checkAgentTool]
  );

  // Helper to create MCP object from integration item
  const createMcpFromItem = useCallback((item: IntegrationItem, id: number) => {
    const mcp = {
      name: item.name,
      key: item.key,
      install_command: {
        env: {} as any,
      },
      id,
    };
    item.env_vars.forEach((key) => {
      mcp.install_command.env[key] = '';
    });
    return mcp;
  }, []);

  return {
    installed,
    configs,
    callBackUrl,
    fetchInstalled,
    saveEnvAndConfig,
    handleUninstall,
    createMcpFromItem,
  };
}
