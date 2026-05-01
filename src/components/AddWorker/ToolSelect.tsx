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

import { mcpInstall } from '@/api/brain';
import {
  fetchGet,
  fetchPost,
  proxyFetchGet,
  proxyFetchPost,
  proxyFetchPut,
} from '@/api/http';
import IntegrationList from '@/components/Dashboard/IntegrationList';
import { Badge } from '@/components/ui/badge';
import {
  useIntegrationManagement,
  type IntegrationItem,
} from '@/hooks/useIntegrationManagement';
import { useHost } from '@/host';
import { capitalizeFirstLetter, getProxyBaseURL } from '@/lib';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { CircleAlert, X } from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '../ui/checkbox';
import { Textarea } from '../ui/textarea';
import { TooltipSimple } from '../ui/tooltip';

interface McpItem {
  id: number;
  name: string;
  key: string;
  description: string;
  category?: { name: string };
  home_page?: string;
  install_command?: {
    env?: { [key: string]: string };
  };
  toolkit?: string;
  isLocal?: boolean;
}

interface ToolSelectProps {
  onShowEnvConfig?: (mcp: McpItem) => void;
  onSelectedToolsChange?: (tools: McpItem[]) => void;
  initialSelectedTools?: McpItem[];
}

const ToolSelect = forwardRef<
  { installMcp: (id: number, env?: any, activeMcp?: any) => Promise<void> },
  ToolSelectProps
>(({ onShowEnvConfig, onSelectedToolsChange, initialSelectedTools }, ref) => {
  const host = useHost();
  const electronAPI = host?.electronAPI;
  const { t } = useTranslation();
  // state management - remove internal selected state, use parent passed initialSelectedTools
  const [keyword, setKeyword] = useState<string>('');
  const { email } = useAuthStore();
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [userMcpList, setUserMcpList] = useState<any[]>([]);

  const integrationItems = integrations as IntegrationItem[];
  const { installed: webInstalled } =
    useIntegrationManagement(integrationItems);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // select management
  const addOption = useCallback(
    (item: McpItem, isLocal?: boolean) => {
      const currentSelected = initialSelectedTools || [];
      if (isLocal) {
        if (!currentSelected.find((i) => i.key === item.key)) {
          const newSelected = [...currentSelected, { ...item, isLocal }];
          onSelectedToolsChange?.(newSelected);
        }
        return;
      }
      if (!currentSelected.find((i) => i.id === item.id)) {
        if (!isLocal) isLocal = false;
        const newSelected = [...currentSelected, { ...item, isLocal }];
        onSelectedToolsChange?.(newSelected);
      }
    },
    [initialSelectedTools, onSelectedToolsChange]
  );

  const fetchIntegrationsData = useCallback(
    (keyword?: string) => {
      proxyFetchGet('/api/v1/config/info')
        .then((res) => {
          if (res && typeof res === 'object' && !res.error) {
            const baseURL = getProxyBaseURL();

            const list = Object.entries(res)
              .filter(([key]) => {
                if (!keyword) return true;
                return key.toLowerCase().includes(keyword.toLowerCase());
              })
              .map(([key, value]: [string, any]) => {
                let onInstall = null;

                // Special handling for Notion MCP
                if (key.toLowerCase() === 'notion') {
                  onInstall = async () => {
                    try {
                      const response = await fetchPost('/install/tool/notion');
                      if (response.success) {
                        // Check if there's a warning (connection failed but installation marked as complete)
                        if (response.warning) {
                          console.warn(
                            'Notion MCP connection warning:',
                            response.warning
                          );
                          // Still proceed but log the warning
                        }
                        // Save to config to mark as installed
                        await proxyFetchPost('/api/v1/configs', {
                          config_group: 'Notion',
                          config_name: 'MCP_REMOTE_CONFIG_DIR',
                          config_value:
                            response.toolkit_name || 'NotionMCPToolkit',
                        });
                        console.log('Notion MCP installed successfully');
                        // After successful installation, add to selected tools
                        const notionItem = {
                          id: 0, // Use 0 for integration items
                          key: key,
                          name: key,
                          description:
                            'Notion workspace integration for reading and managing Notion pages',
                          toolkit: 'notion_mcp_toolkit', // Add the toolkit name
                          isLocal: true,
                        };
                        addOption(notionItem, true);
                      } else {
                        console.error(
                          'Failed to install Notion MCP:',
                          response.error || 'Unknown error'
                        );
                        throw new Error(
                          response.error || 'Failed to install Notion MCP'
                        );
                      }
                    } catch (error: any) {
                      console.error(
                        'Failed to install Notion MCP:',
                        error.message
                      );
                      throw error;
                    }
                  };
                } else if (key.toLowerCase() === 'google calendar') {
                  onInstall = async () => {
                    try {
                      const response = await fetchPost(
                        '/install/tool/google_calendar'
                      );
                      if (response.success) {
                        if (response.warning) {
                          console.warn(
                            'Google Calendar connection warning:',
                            response.warning
                          );
                        }
                        try {
                          const existingConfigs =
                            await proxyFetchGet('/api/v1/configs');
                          const existing = Array.isArray(existingConfigs)
                            ? existingConfigs.find(
                                (c: any) =>
                                  c.config_group?.toLowerCase() ===
                                    'google calendar' &&
                                  c.config_name === 'GOOGLE_REFRESH_TOKEN'
                              )
                            : null;

                          const configPayload = {
                            config_group: 'Google Calendar',
                            config_name: 'GOOGLE_REFRESH_TOKEN',
                            config_value: 'exists',
                          };

                          if (existing) {
                            await proxyFetchPut(
                              `/api/v1/configs/${existing.id}`,
                              configPayload
                            );
                          } else {
                            await proxyFetchPost(
                              '/api/v1/configs',
                              configPayload
                            );
                          }
                        } catch (configError) {
                          console.warn(
                            'Failed to persist Google Calendar config',
                            configError
                          );
                        }
                        console.log('Google Calendar installed successfully');
                        const calendarItem = {
                          id: 0, // Use 0 for integration items
                          key: key,
                          name: key,
                          description:
                            'Google Calendar integration for managing events and schedules',
                          toolkit: 'google_calendar_toolkit', // Add the toolkit name
                          isLocal: true,
                        };
                        addOption(calendarItem, true);
                      } else if (response.status === 'authorizing') {
                        console.log(
                          'Google Calendar authorization in progress. Please complete in browser.'
                        );
                        if (response.message) {
                          console.log(response.message);
                        }
                      } else {
                        console.error(
                          'Failed to install Google Calendar:',
                          response.error || 'Unknown error'
                        );
                        throw new Error(
                          response.error || 'Failed to install Google Calendar'
                        );
                      }
                      return response;
                    } catch (error: any) {
                      if (!error.message?.includes('authorization')) {
                        console.error(
                          'Failed to install Google Calendar:',
                          error.message
                        );
                        throw error;
                      }
                      return null; // Return null on authorization flow errors
                    }
                  };
                } else {
                  onInstall = () =>
                    window.open(
                      `${baseURL}/api/v1/oauth/${key.toLowerCase()}/login`,
                      '_blank',
                      'width=600,height=700'
                    );
                }

                return {
                  key: key,
                  name: key,
                  env_vars: value.env_vars,
                  toolkit: value.toolkit,
                  desc:
                    value.env_vars && value.env_vars.length > 0
                      ? `${t('layout.environmental-variables-required')} ${value.env_vars.join(
                          ', '
                        )}`
                      : key.toLowerCase() === 'notion'
                        ? t('layout.notion-workspace-integration')
                        : key.toLowerCase() === 'google calendar'
                          ? t('layout.google-calendar-integration')
                          : '',
                  onInstall,
                };
              });
            setIntegrations(list);
          } else {
            console.error('Failed to fetch integrations:', res);
            setIntegrations([]);
          }
        })
        .catch((error) => {
          console.error('Error fetching integrations:', error);
          setIntegrations([]);
        });
    },
    [addOption, t]
  );

  const fetchInstalledMcps = useCallback(() => {
    proxyFetchGet('/api/v1/mcp/users')
      .then((res) => {
        let dataList: any[] = [];
        if (Array.isArray(res)) {
          dataList = res;
        } else if (res && Array.isArray(res.items)) {
          dataList = res.items;
        }
        setUserMcpList(dataList);
      })
      .catch((error) => {
        console.error('Error fetching installed MCPs:', error);
        setUserMcpList([]);
      });
  }, []);

  // public save env/config logic
  const saveEnvAndConfig = async (
    provider: string,
    envVarKey: string,
    value: string
  ) => {
    // First fetch current configs to check for existing ones
    const configsRes = await proxyFetchGet('/api/v1/configs');
    const configs = Array.isArray(configsRes) ? configsRes : [];

    const configPayload = {
      config_group: capitalizeFirstLetter(provider),
      config_name: envVarKey,
      config_value: value,
    };

    // Check if config already exists
    const existingConfig = configs.find(
      (c: any) =>
        c.config_name === envVarKey &&
        c.config_group?.toLowerCase() === provider.toLowerCase()
    );

    if (existingConfig) {
      // Update existing config
      await proxyFetchPut(
        `/api/v1/configs/${existingConfig.id}`,
        configPayload
      );
    } else {
      // Create new config
      await proxyFetchPost('/api/v1/configs', configPayload);
    }

    if (electronAPI?.envWrite) {
      await electronAPI.envWrite(email, { key: envVarKey, value });
    }
  };
  // MCP install related
  const installMcp = async (
    id: number,
    envValue?: { [key: string]: any },
    activeMcp?: any
  ) => {
    // is exa search or google calendar
    if (activeMcp && envValue) {
      const env: { [key: string]: string } = {};
      Object.keys(envValue).map((key) => {
        env[key] = envValue[key]?.value;
      });
      activeMcp.install_command.env = env;

      // Save all env vars and wait for completion
      console.log('[installMcp] Saving env vars for', activeMcp.key);
      try {
        await Promise.all(
          Object.keys(activeMcp.install_command.env).map(async (key) => {
            console.log(
              '[installMcp] Saving',
              key,
              '=',
              activeMcp.install_command.env[key]
            );
            return saveEnvAndConfig(
              activeMcp.key,
              key,
              activeMcp.install_command.env[key]
            );
          })
        );
        console.log('[installMcp] All env vars saved successfully');
      } catch (error) {
        console.error('[installMcp] Failed to save env vars:', error);
        // Continue anyway to trigger installation
      }

      if (activeMcp.key !== 'Google Calendar') {
        const integrationItem = integrations.find(
          (item) => item.key === activeMcp.key
        );
        addOption(
          {
            id: activeMcp.id,
            key: activeMcp.key,
            name: activeMcp.name ?? activeMcp.key,
            description:
              typeof integrationItem?.desc === 'string'
                ? integrationItem.desc
                : '',
            toolkit: integrationItem?.toolkit,
            isLocal: true,
          },
          true
        );
        return;
      }

      // Trigger instantiation for Google Calendar
      if (activeMcp.key === 'Google Calendar') {
        console.log(
          '[ToolSelect installMcp] Starting Google Calendar installation'
        );
        try {
          const response = await fetchPost('/install/tool/google_calendar');

          if (response.success) {
            console.log('[ToolSelect installMcp] Immediate success');
            // Mark as successfully installed by writing refresh token marker
            const existingConfigs = await proxyFetchGet('/api/v1/configs');
            const existing = Array.isArray(existingConfigs)
              ? existingConfigs.find(
                  (c: any) =>
                    c.config_group?.toLowerCase() === 'google calendar' &&
                    c.config_name === 'GOOGLE_REFRESH_TOKEN'
                )
              : null;

            const configPayload = {
              config_group: 'Google Calendar',
              config_name: 'GOOGLE_REFRESH_TOKEN',
              config_value: 'exists',
            };

            if (existing) {
              await proxyFetchPut(
                `/api/v1/configs/${existing.id}`,
                configPayload
              );
            } else {
              await proxyFetchPost('/api/v1/configs', configPayload);
            }

            // Refresh integrations to update install status
            fetchIntegrationsData();

            const selectedItem = {
              id: activeMcp.id,
              key: activeMcp.key,
              name: activeMcp.name,
              description:
                'Google Calendar integration for managing events and schedules',
              toolkit: 'google_calendar_toolkit',
              isLocal: true,
            };
            addOption(selectedItem, true);
          } else if (response.status === 'authorizing') {
            // Authorization in progress - browser should have opened
            console.log(
              '[ToolSelect installMcp] Authorization required, starting polling loop'
            );

            // WAIT for OAuth status completion instead of using setInterval
            const start = Date.now();
            const timeoutMs = 5 * 60 * 1000; // 5 minutes

            while (Date.now() - start < timeoutMs) {
              try {
                const statusResponse = await fetchGet(
                  '/oauth/status/google_calendar'
                );
                console.log(
                  '[ToolSelect installMcp] OAuth status:',
                  statusResponse.status
                );

                if (statusResponse.status === 'success') {
                  console.log(
                    '[ToolSelect installMcp] Authorization completed successfully!'
                  );

                  // Try installing again now that authorization is complete
                  const retryResponse = await fetchPost(
                    '/install/tool/google_calendar'
                  );
                  if (retryResponse.success) {
                    // Mark as successfully installed
                    const existingConfigs =
                      await proxyFetchGet('/api/v1/configs');
                    const existing = Array.isArray(existingConfigs)
                      ? existingConfigs.find(
                          (c: any) =>
                            c.config_group?.toLowerCase() ===
                              'google calendar' &&
                            c.config_name === 'GOOGLE_REFRESH_TOKEN'
                        )
                      : null;

                    const configPayload = {
                      config_group: 'Google Calendar',
                      config_name: 'GOOGLE_REFRESH_TOKEN',
                      config_value: 'exists',
                    };

                    if (existing) {
                      await proxyFetchPut(
                        `/api/v1/configs/${existing.id}`,
                        configPayload
                      );
                    } else {
                      await proxyFetchPost('/api/v1/configs', configPayload);
                    }

                    fetchIntegrationsData();

                    const selectedItem = {
                      id: activeMcp.id,
                      key: activeMcp.key,
                      name: activeMcp.name,
                      description:
                        'Google Calendar integration for managing events and schedules',
                      toolkit: 'google_calendar_toolkit',
                      isLocal: true,
                    };
                    addOption(selectedItem, true);
                  }
                  console.log(
                    '[ToolSelect installMcp] Installation complete, returning'
                  );
                  return;
                } else if (statusResponse.status === 'failed') {
                  console.error(
                    '[ToolSelect installMcp] Authorization failed:',
                    statusResponse.error
                  );
                  return;
                } else if (statusResponse.status === 'cancelled') {
                  console.log(
                    '[ToolSelect installMcp] Authorization cancelled'
                  );
                  return;
                }
              } catch (error) {
                console.error(
                  '[ToolSelect installMcp] Error polling OAuth status:',
                  error
                );
              }

              // Wait before next poll
              await new Promise((r) => setTimeout(r, 1500));
            }

            console.log('[ToolSelect installMcp] Polling timeout');
            return;
          } else {
            console.error(
              'Failed to install Google Calendar:',
              response.error || 'Unknown error'
            );
          }
        } catch (error: any) {
          console.error('Failed to install Google Calendar:', error.message);
        }
      }
      return;
    }
    try {
      await proxyFetchPost('/api/v1/mcp/install?mcp_id=' + id);
      const listRes = await proxyFetchGet('/api/v1/mcps', {
        page: 1,
        size: 200,
        keyword: '',
      });
      const items =
        listRes?.items && Array.isArray(listRes.items) ? listRes.items : [];
      const installedMcp = items.find((mcp: McpItem) => mcp.id === id);
      if (installedMcp?.install_command) {
        const installCmd = { ...installedMcp.install_command };
        if (envValue) {
          const env: { [key: string]: string } = {};
          Object.keys(envValue).map((key) => {
            env[key] = envValue[key]?.value;
          });
          installCmd.env = env;
        }
        await mcpInstall(installedMcp.key, installCmd);
      }
      if (installedMcp) {
        addOption(installedMcp);
      }
    } catch (e) {
      console.error('Failed to install MCP:', e);
    }
  };

  // expose install method to parent component
  useImperativeHandle(ref, () => ({
    installMcp,
  }));

  const removeOption = useCallback(
    (item: McpItem) => {
      const currentSelected = initialSelectedTools || [];
      const newSelected = currentSelected.filter((i) => i.id !== item.id);
      onSelectedToolsChange?.(newSelected);
    },
    [initialSelectedTools, onSelectedToolsChange]
  );

  const buildLocalToolFromIntegration = useCallback(
    (item: IntegrationItem): McpItem => {
      const normalizedToolkit =
        item.name === 'Notion' ? 'notion_mcp_toolkit' : item.toolkit;
      return {
        id: 0,
        key: item.key,
        name: item.name,
        description: typeof item.desc === 'string' ? item.desc : '',
        toolkit: normalizedToolkit,
        isLocal: true,
      };
    },
    []
  );

  const isIntegrationInAgentSelection = useCallback(
    (item: IntegrationItem) =>
      !!(initialSelectedTools || []).find(
        (s) => s.isLocal && s.key === item.key
      ),
    [initialSelectedTools]
  );

  const handleToggleIntegrationForAgent = useCallback(
    (item: IntegrationItem, selected: boolean) => {
      if (selected) {
        addOption(buildLocalToolFromIntegration(item), true);
      } else {
        const found = (initialSelectedTools || []).find(
          (s) => s.isLocal && s.key === item.key
        );
        if (found) removeOption(found);
      }
    },
    [
      addOption,
      buildLocalToolFromIntegration,
      initialSelectedTools,
      removeOption,
    ]
  );

  const handleToggleUserMcp = useCallback(
    (row: any, selected: boolean) => {
      if (selected) {
        addOption({
          id: row.id,
          key: row.mcp_key || String(row.id),
          name: row.mcp_name || row.mcp_key,
          description: String(row.mcp_desc || ''),
          mcp_name: row.mcp_name,
        } as McpItem);
      } else {
        const found = (initialSelectedTools || []).find((i) => i.id === row.id);
        if (found) removeOption(found);
      }
    },
    [addOption, initialSelectedTools, removeOption]
  );

  // Effects
  useEffect(() => {
    fetchIntegrationsData();
    fetchInstalledMcps();
  }, [fetchIntegrationsData, fetchInstalledMcps]);

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      fetchIntegrationsData(keyword);
    }, 500);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [keyword, fetchIntegrationsData]);

  const webConnectedItems = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return integrations
      .filter((i: IntegrationItem) => webInstalled[i.key])
      .filter((i: IntegrationItem) => {
        if (!kw) return true;
        const descStr = typeof i.desc === 'string' ? i.desc.toLowerCase() : '';
        return (
          (i.key || '').toLowerCase().includes(kw) ||
          (i.name || '').toLowerCase().includes(kw) ||
          descStr.includes(kw)
        );
      });
  }, [integrations, webInstalled, keyword]);

  const webNotConnectedItems = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return integrations
      .filter((i: IntegrationItem) => !webInstalled[i.key])
      .filter((i: IntegrationItem) => {
        if (!kw) return true;
        const descStr = typeof i.desc === 'string' ? i.desc.toLowerCase() : '';
        return (
          (i.key || '').toLowerCase().includes(kw) ||
          (i.name || '').toLowerCase().includes(kw) ||
          descStr.includes(kw)
        );
      });
  }, [integrations, webInstalled, keyword]);

  const ownPicks = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return userMcpList.filter((opt) => {
      if (!kw) return true;
      const name = String(opt.mcp_name || '').toLowerCase();
      const desc = String(opt.mcp_desc || '').toLowerCase();
      const key = String(opt.mcp_key || '').toLowerCase();
      return name.includes(kw) || desc.includes(kw) || key.includes(kw);
    });
  }, [userMcpList, keyword]);

  const listHasItems =
    webConnectedItems.length > 0 ||
    webNotConnectedItems.length > 0 ||
    ownPicks.length > 0;

  const showSearchPlaceholder =
    keyword.length === 0 && (initialSelectedTools?.length ?? 0) === 0;

  // render functions
  const renderSelectedItems = () => (
    <>
      {(initialSelectedTools || []).map((item: any) => (
        <Badge
          key={item.id + item.key + (item.isLocal + '')}
          variant="secondary"
          size="sm"
          className="flex w-auto flex-shrink-0"
        >
          {item.name || item.mcp_name || item.key || `tool_${item.id}`}
          <div className="rounded-sm flex items-center justify-center bg-transparent">
            <X
              className="h-4 w-4 text-ds-text-neutral-default-disabled hover:text-ds-text-neutral-default-default shrink-0 cursor-pointer"
              onClick={() => removeOption(item)}
            />
          </div>
        </Badge>
      ))}
    </>
  );

  const renderCustomMcpItem = (item: any) => {
    const checked = !!(initialSelectedTools || []).find(
      (i) => i.id === item.id
    );
    return (
      <div
        key={item.id}
        className="gap-2 rounded-lg bg-ds-bg-neutral-subtle-default py-2 px-3 last:mb-1 min-h-0 flex w-auto items-center"
      >
        <Checkbox
          checked={checked}
          onCheckedChange={(c) => {
            if (c === 'indeterminate') return;
            handleToggleUserMcp(item, c === true);
          }}
          onClick={(e) => e.stopPropagation()}
          aria-label={String(item.mcp_name || item.mcp_key || '')}
        />
        <span className="min-w-0 text-sm font-bold leading-5 text-ds-text-neutral-default-default sm:text-base line-clamp-2 flex-1 break-words">
          {capitalizeFirstLetter(item.mcp_name || '')}
        </span>
      </div>
    );
  };

  return (
    <div className="min-w-0 w-full" ref={containerRef}>
      <div className="gap-1.5 min-w-0 flex w-full flex-col">
        <div className="gap-1 text-sm font-bold leading-normal text-ds-text-neutral-default-default min-h-5 flex shrink-0 items-center">
          {t('workforce.agent-tool')}
          <TooltipSimple content={t('workforce.agent-tool-tooltip')}>
            <CircleAlert
              size={16}
              className="text-ds-icon-neutral-default-default shrink-0"
            />
          </TooltipSimple>
        </div>
        <div
          onMouseDown={() => inputRef.current?.focus()}
          className={cn(
            'focus-within:ring-ds-border-brand-default-default/35 gap-1.5 rounded-lg border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default min-w-0 px-2 py-1.5 flex max-h-[120px] min-h-[40px] w-full flex-wrap content-center items-center justify-start border border-solid focus-within:ring-2'
          )}
        >
          {renderSelectedItems()}
          <Textarea
            variant="none"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            ref={inputRef}
            placeholder={
              showSearchPlaceholder ? t('setting.search-mcp') : undefined
            }
            aria-label={t('workforce.agent-tool')}
            aria-controls="agent-tool-picker-panel"
            className="p-0 text-sm leading-5 text-ds-text-neutral-default-default placeholder:text-ds-text-neutral-muted-default !min-h-[20px] min-w-[8ch] flex-1 resize-none border-none !shadow-none !ring-0 !ring-offset-0 focus-visible:ring-0"
            rows={1}
          />
        </div>

        <div
          id="agent-tool-picker-panel"
          role="region"
          aria-label={t('workforce.agent-tool')}
          className="min-w-0 rounded-lg border-ds-border-neutral-muted-default bg-ds-bg-neutral-default-default w-full overflow-hidden border border-solid"
        >
          <div className="scrollbar-always-visible gap-1.5 px-2 py-2 min-h-0 flex h-[260px] flex-col overflow-x-hidden overflow-y-auto">
            {listHasItems ? (
              <div
                className="text-ds-text-neutral-default-default min-w-0 gap-3 flex flex-col"
                data-mcp-list="unified"
              >
                {webConnectedItems.length > 0 && (
                  <div>
                    <div className="text-body-sm font-medium text-ds-text-neutral-subtle-default px-2 py-1">
                      {t('setting.mcp-sidebar-web')}
                    </div>
                    <IntegrationList
                      className="!space-y-1.5"
                      variant="select"
                      onShowEnvConfig={onShowEnvConfig}
                      addOption={addOption}
                      items={webConnectedItems}
                      translationNamespace="layout"
                      selectWithCheckbox
                      isIntegrationSelected={isIntegrationInAgentSelection}
                      onToggleIntegration={handleToggleIntegrationForAgent}
                    />
                  </div>
                )}
                {ownPicks.length > 0 && (
                  <div>
                    <div className="text-body-sm font-medium text-ds-text-neutral-subtle-default px-2 py-1 mb-1">
                      {t('setting.your-own-mcps')}
                    </div>
                    <div className="min-w-0 gap-2 flex flex-col">
                      {ownPicks.map(renderCustomMcpItem)}
                    </div>
                  </div>
                )}
                {webNotConnectedItems.length > 0 && (
                  <div>
                    <div className="text-body-sm font-medium text-ds-text-neutral-subtle-default px-2 py-1">
                      {t('setting.mcp-sidebar-not-connected')}
                    </div>
                    <IntegrationList
                      className="!space-y-1.5"
                      variant="select"
                      onShowEnvConfig={onShowEnvConfig}
                      addOption={addOption}
                      items={webNotConnectedItems}
                      translationNamespace="layout"
                      selectWithCheckbox
                      isIntegrationSelected={isIntegrationInAgentSelection}
                      onToggleIntegration={handleToggleIntegrationForAgent}
                    />
                  </div>
                )}
              </div>
            ) : (
              <p className="text-body-md text-ds-text-neutral-muted-default px-2 py-2 text-center break-words">
                {t('dashboard.no-results')}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

ToolSelect.displayName = 'ToolSelect';

export default ToolSelect;
