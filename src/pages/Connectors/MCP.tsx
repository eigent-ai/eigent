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

import { mcpInstall, mcpRemove, mcpUpdate } from '@/api/brain';
import {
  fetchGet,
  fetchPost,
  proxyFetchDelete,
  proxyFetchGet,
  proxyFetchPost,
  proxyFetchPut,
} from '@/api/http';
import cursorIcon from '@/assets/icon/cursor.svg';
import githubIcon from '@/assets/icon/github.svg';
import googleIcon from '@/assets/icon/google.svg';
import googleCalendarIcon from '@/assets/icon/google_calendar.svg';
import googleGmailIcon from '@/assets/icon/google_gmail.svg';
import larkIcon from '@/assets/icon/lark.png';
import linkedinIcon from '@/assets/icon/linkedin.svg';
import notionIcon from '@/assets/icon/notion.svg';
import ragIcon from '@/assets/icon/rag.svg';
import redditIcon from '@/assets/icon/reddit.svg';
import slackIcon from '@/assets/icon/slack.svg';
import telegramIcon from '@/assets/icon/telegram.svg';
import vsCodeIcon from '@/assets/icon/vs-code.svg';
import whatsappIcon from '@/assets/icon/whatsapp.svg';
import xIcon from '@/assets/icon/x.svg';
import ellipseIcon from '@/assets/mcp/Ellipse-25.svg';
import SearchInput from '@/components/Dashboard/SearchInput';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { TooltipSimple } from '@/components/ui/tooltip';
import {
  useIntegrationManagement,
  type IntegrationItem,
} from '@/hooks/useIntegrationManagement';
import { capitalizeFirstLetter, getProxyBaseURL } from '@/lib';
import { useAuthStore } from '@/store/authStore';
import { motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronUp,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  Wrench,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { GoogleSearchPanel } from './components/GoogleSearchPanel';
import MCPAddDialog from './components/MCPAddDialog';
import MCPConfigDialog from './components/MCPConfigDialog';
import MCPDeleteDialog from './components/MCPDeleteDialog';
import { MCPEnvDialog } from './components/MCPEnvDialog';
import type { MCPConfigForm, MCPUserItem } from './components/types';
import { arrayToArgsJson, parseArgsToArray } from './components/utils';

import { ConfigFile } from 'electron/main/utils/mcpConfig';
import { toast } from 'sonner';

// Filter out Search from integrations (it's now a hardcoded connector item below)
const EXCLUDED_FROM_MCP = ['Search', 'RAG'];

const GOOGLE_SEARCH_ID = 'google-search' as const;

const COMING_SOON_NAMES = [
  'X(Twitter)',
  'WhatsApp',
  'Reddit',
  'Github',
] as const;

const INTEGRATION_ICON_BY_KEY: Record<string, string> = {
  notion: notionIcon,
  slack: slackIcon,
  'google calendar': googleCalendarIcon,
  gmail: googleGmailIcon,
  'google gmail': googleGmailIcon,
  linkedin: linkedinIcon,
  lark: larkIcon,
  rag: ragIcon,
  telegram: telegramIcon,
  whatsapp: whatsappIcon,
  x: xIcon,
  'x(twitter)': xIcon,
  twitter: xIcon,
  reddit: redditIcon,
  github: githubIcon,
  cursor: cursorIcon,
  'vs code': vsCodeIcon,
  vscode: vsCodeIcon,
};

function integrationLeadingIconUrl(integrationKey: string): string | undefined {
  return INTEGRATION_ICON_BY_KEY[integrationKey.toLowerCase().trim()];
}

export default function SettingMCP() {
  const { checkAgentTool } = useAuthStore();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<MCPUserItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showConfig, setShowConfig] = useState<MCPUserItem | null>(null);
  const [configForm, setConfigForm] = useState<MCPConfigForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addType, setAddType] = useState<'local' | 'remote'>('local');
  const [localJson, setLocalJson] = useState(
    `{
  "mcpServers": {
    "sequential-thinking": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-sequential-thinking"
      ]
    }
  }
}`
  );
  const [remoteName, setRemoteName] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [installing, setInstalling] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MCPUserItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [switchLoading, setSwitchLoading] = useState<Record<number, boolean>>(
    {}
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [webCollapsed, setWebCollapsed] = useState(false);
  const [yourCollapsed, setYourCollapsed] = useState(false);
  const [selected, setSelected] = useState<
    | { type: 'web'; key: string }
    | { type: 'your'; id: number }
    | { type: typeof GOOGLE_SEARCH_ID }
    | null
  >(null);
  const [showEnvConfig, setShowEnvConfig] = useState(false);
  const [activeMcp, setActiveMcp] = useState<any | null>(null);
  const [folderHint, setFolderHint] = useState<'web' | 'your' | null>(null);

  const [integrations, setIntegrations] = useState<any[]>([]);
  const [isLoadingIntegrations, setIsLoadingIntegrations] = useState(true);

  const integrationItems = useMemo((): IntegrationItem[] => {
    const searchItem: IntegrationItem = {
      key: 'Search',
      name: 'Search',
      desc: '',
      env_vars: [],
      onInstall: async () => {},
    };
    return [searchItem, ...(integrations as IntegrationItem[])];
  }, [integrations]);

  const {
    installed,
    fetchInstalled,
    saveEnvAndConfig,
    handleUninstall,
    createMcpFromItem,
  } = useIntegrationManagement(integrationItems);

  const searchConnected = !!installed.Search;

  const refreshConnectorConfigs = useCallback(() => {
    void fetchInstalled();
  }, [fetchInstalled]);

  useEffect(() => {
    const action = searchParams.get('connectorAction');
    const section = searchParams.get('connectorSection');
    if (action !== 'add' && section !== 'mcp-tools' && section !== 'your-mcp') {
      return;
    }
    const next = new URLSearchParams(searchParams);
    if (action === 'add') {
      setShowAdd(true);
      next.delete('connectorAction');
    }
    if (section === 'mcp-tools') {
      setFolderHint('web');
      setWebCollapsed(false);
      setYourCollapsed(true);
      next.delete('connectorSection');
    }
    if (section === 'your-mcp') {
      setFolderHint('your');
      setYourCollapsed(false);
      setWebCollapsed(true);
      next.delete('connectorSection');
    }
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Filter integrations (MCP & Tools) by search
  const filteredIntegrations = useMemo(() => {
    if (!searchQuery.trim()) return integrations;
    const q = searchQuery.toLowerCase().trim();
    return integrations.filter(
      (item) =>
        (item.key || '').toLowerCase().includes(q) ||
        (item.name || '').toLowerCase().includes(q) ||
        (item.desc || '').toLowerCase().includes(q)
    );
  }, [integrations, searchQuery]);

  // Filter your MCPs by search
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase().trim();
    return items.filter(
      (item) =>
        (item.mcp_name || '').toLowerCase().includes(q) ||
        (item.mcp_desc || '').toLowerCase().includes(q) ||
        (item.mcp_key || '').toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  const webConnected = useMemo(
    () => filteredIntegrations.filter((i) => installed[i.key]),
    [filteredIntegrations, installed]
  );

  type SortedWebItem =
    | { kind: 'google-search'; connected: boolean }
    | {
        kind: 'integration';
        item: IntegrationItem;
        connected: boolean;
        comingSoon: boolean;
      };

  const sortedWebItems = useMemo((): SortedWebItem[] => {
    const all: SortedWebItem[] = [
      { kind: 'google-search', connected: searchConnected },
      ...filteredIntegrations.map((item) => ({
        kind: 'integration' as const,
        item,
        connected: !!installed[item.key],
        comingSoon: (COMING_SOON_NAMES as readonly string[]).includes(
          item.name
        ),
      })),
    ];

    const priority = (w: SortedWebItem) => {
      if (w.kind === 'integration' && w.comingSoon) return 2;
      return w.connected ? 0 : 1;
    };
    const getName = (w: SortedWebItem) =>
      w.kind === 'google-search' ? 'Google Search' : w.item.name;

    return [...all].sort((a, b) => {
      const diff = priority(a) - priority(b);
      return diff !== 0 ? diff : getName(a).localeCompare(getName(b));
    });
  }, [filteredIntegrations, installed, searchConnected]);

  // get list
  const fetchList = useCallback(() => {
    setIsLoading(true);
    setError('');
    proxyFetchGet('/api/v1/mcp/users')
      .then((res) => {
        if (Array.isArray(res)) {
          setItems(res);
        } else if (Array.isArray(res.items)) {
          setItems(res.items);
        } else {
          setItems([]);
        }
      })
      .catch((err) => {
        setError(err?.message || t('setting.load-failed'));
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [t]);

  // get integrations
  useEffect(() => {
    setIsLoadingIntegrations(true);
    proxyFetchGet('/api/v1/config/info')
      .then((res) => {
        if (res && typeof res === 'object') {
          const baseURL = getProxyBaseURL();
          const list = Object.entries(res).map(
            ([key, value]: [string, any]) => {
              let onInstall = null;

              // Special handling for Notion MCP
              if (key.toLowerCase() === 'notion') {
                onInstall = async () => {
                  try {
                    const response = await fetchPost('/install/tool/notion');
                    if (response.success) {
                      // Check if there's a warning (connection failed but installation marked as complete)
                      if (response.warning) {
                        toast.warning(response.warning, { duration: 5000 });
                      } else {
                        toast.success(
                          t('setting.notion-mcp-installed-successfully')
                        );
                      }
                      // Save to config to mark as installed
                      await proxyFetchPost('/api/v1/configs', {
                        config_group: 'Notion',
                        config_name: 'MCP_REMOTE_CONFIG_DIR',
                        config_value:
                          response.toolkit_name || 'NotionMCPToolkit',
                      });
                      // Refresh the integrations list to show the installed state
                      fetchList();
                      void fetchInstalled();
                    } else {
                      toast.error(
                        response.error ||
                          t('setting.failed-to-install-notion-mcp')
                      );
                    }
                  } catch (error: any) {
                    toast.error(
                      error.message || t('setting.failed-to-install-notion-mcp')
                    );
                  }
                };
              } else if (key.toLowerCase() === 'google calendar') {
                onInstall = async () => {
                  try {
                    const response = await fetchPost(
                      '/install/tool/google_calendar'
                    );
                    if (response.success) {
                      // Check if there's a warning (connection failed but installation marked as complete)
                      if (response.warning) {
                        toast.warning(response.warning, { duration: 5000 });
                      } else {
                        toast.success(
                          t('setting.google-calendar-installed-successfully')
                        );
                      }
                      try {
                        // Ensure we persist a marker config to indicate installation
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
                      // Refresh the integrations list to show the installed state
                      fetchList();
                      void fetchInstalled();
                    } else if (response.status === 'authorizing') {
                      // Authorization in progress - start polling for completion
                      toast.info(
                        t('setting.please-complete-authorization-in-browser')
                      );

                      // Poll for authorization completion via oauth status endpoint
                      const pollInterval = setInterval(async () => {
                        try {
                          const statusResp = await fetchGet(
                            '/oauth/status/google_calendar'
                          );
                          if (statusResp?.status === 'success') {
                            clearInterval(pollInterval);
                            // Now that auth succeeded, run install again to initialize toolkit
                            const finalize = await fetchPost(
                              '/install/tool/google_calendar'
                            );
                            if (finalize?.success) {
                              const configs =
                                await proxyFetchGet('/api/v1/configs');
                              const existing = Array.isArray(configs)
                                ? configs.find(
                                    (c: any) =>
                                      c.config_group?.toLowerCase() ===
                                        'google calendar' &&
                                      c.config_name === 'GOOGLE_REFRESH_TOKEN'
                                  )
                                : null;

                              const payload = {
                                config_group: 'Google Calendar',
                                config_name: 'GOOGLE_REFRESH_TOKEN',
                                config_value: 'exists',
                              };

                              if (existing) {
                                await proxyFetchPut(
                                  `/api/v1/configs/${existing.id}`,
                                  payload
                                );
                              } else {
                                await proxyFetchPost(
                                  '/api/v1/configs',
                                  payload
                                );
                              }

                              toast.success(
                                t(
                                  'setting.google-calendar-installed-successfully'
                                )
                              );
                              fetchList();
                              void fetchInstalled();
                            }
                          } else if (
                            statusResp?.status === 'failed' ||
                            statusResp?.status === 'cancelled'
                          ) {
                            clearInterval(pollInterval);
                            const msg =
                              statusResp?.error ||
                              (statusResp?.status === 'cancelled'
                                ? t('setting.authorization-cancelled')
                                : t('setting.authorization-failed'));
                            toast.error(msg);
                          }
                          // if still authorizing, continue polling
                        } catch (err) {
                          console.error('Polling oauth status failed', err);
                        }
                      }, 2000);

                      // Safety timeout
                      setTimeout(
                        () => clearInterval(pollInterval),
                        5 * 60 * 1000
                      );
                    } else {
                      toast.error(
                        response.error ||
                          response.message ||
                          t('setting.failed-to-install-google-calendar')
                      );
                    }
                  } catch (error: any) {
                    toast.error(
                      error.message ||
                        t('setting.failed-to-install-google-calendar')
                    );
                  }
                };
              } else {
                onInstall = () => {
                  const url = `${baseURL}/api/v1/oauth/${key.toLowerCase()}/login`;
                  // Open in a new window to avoid navigating the app/webview
                  window.open(url, '_blank');
                };
              }

              return {
                key,
                name: key,
                env_vars: value.env_vars,
                desc:
                  value.env_vars && value.env_vars.length > 0
                    ? `${t(
                        'setting.environmental-variables-required'
                      )}: ${value.env_vars.join(', ')}`
                    : key.toLowerCase() === 'notion'
                      ? t('setting.notion-workspace-integration')
                      : key.toLowerCase() === 'google calendar'
                        ? t('setting.google-calendar-integration')
                        : '',
                onInstall,
              };
            }
          );
          setIntegrations(
            list.filter((item) => !EXCLUDED_FROM_MCP.includes(item.key))
          );
        }
      })
      .finally(() => {
        setIsLoadingIntegrations(false);
        void fetchInstalled();
      });
  }, [fetchList, t, fetchInstalled]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // MCP list switch
  const handleSwitch = async (id: number, checked: boolean) => {
    setSwitchLoading((l) => ({ ...l, [id]: true }));
    try {
      await proxyFetchPut(`/api/v1/mcp/users/${id}`, {
        status: checked ? 1 : 2,
      });
      fetchList();
    } finally {
      setSwitchLoading((l) => ({ ...l, [id]: false }));
    }
  };

  const onCloseEnv = useCallback(() => {
    setShowEnvConfig(false);
    setActiveMcp(null);
  }, []);

  const handleWebInstall = useCallback(
    async (item: IntegrationItem) => {
      if (item.key === 'Lark' || item.key === 'RAG') {
        const mcp = createMcpFromItem(item, item.key === 'Lark' ? 15 : 16);
        setActiveMcp(mcp);
        setShowEnvConfig(true);
        return;
      }

      if (item.key === 'Google Calendar') {
        const mcp = createMcpFromItem(item, 14);
        setActiveMcp(mcp);
        setShowEnvConfig(true);
        return;
      }

      if (item.key === 'LinkedIn') {
        const baseUrl = getProxyBaseURL();
        window.open(
          `${baseUrl}/api/v1/oauth/linkedin/login`,
          '_blank',
          'width=600,height=700'
        );
        return;
      }

      if (installed[item.key]) return;
      await item.onInstall();
      await fetchInstalled();
      fetchList();
    },
    [installed, createMcpFromItem, fetchInstalled, fetchList]
  );

  const onEnvConnect = useCallback(
    async (mcp: any) => {
      await fetchInstalled();
      await Promise.all(
        Object.keys(mcp.install_command.env).map(async (k) => {
          return saveEnvAndConfig(mcp.key, k, mcp.install_command.env[k]);
        })
      );

      if (mcp.key === 'Google Calendar') {
        const calendarItem = integrations.find(
          (it: IntegrationItem) => it.key === 'Google Calendar'
        );
        try {
          if (calendarItem?.onInstall) await calendarItem.onInstall();
          else await fetchPost('/install/tool/google_calendar');
        } catch (_) {}
      }

      await fetchInstalled();
      fetchList();
      onCloseEnv();
    },
    [fetchInstalled, saveEnvAndConfig, integrations, fetchList, onCloseEnv]
  );

  const handleOpenWebConfig = useCallback(
    (item: IntegrationItem) => {
      if (item.env_vars?.length > 0) {
        const mcp = createMcpFromItem(item, -1);
        setActiveMcp(mcp);
        setShowEnvConfig(true);
      }
    },
    [createMcpFromItem]
  );

  const renderSidebarRow = (
    tabId: string,
    label: string,
    kind: 'web' | 'your',
    isActive: boolean,
    onSelect: () => void,
    webInstalled?: boolean,
    yourEnabled?: boolean,
    integrationKey?: string
  ) => {
    const assetUrl =
      kind === 'web' && integrationKey
        ? integrationLeadingIconUrl(integrationKey)
        : undefined;

    return (
      <button
        key={tabId}
        type="button"
        onClick={onSelect}
        className={`flex w-full items-center justify-between rounded-xl px-3 py-2 transition-all duration-200 ${
          isActive
            ? 'bg-ds-bg-neutral-subtle-default hover:bg-ds-bg-neutral-subtle-default'
            : 'bg-fill-fill-transparent hover:bg-fill-fill-transparent-hover'
        } `}
      >
        <div className="flex min-w-0 items-center justify-center gap-3">
          {kind === 'web' ? (
            assetUrl ? (
              <img
                src={assetUrl}
                alt=""
                className="h-5 w-5 shrink-0 object-contain"
              />
            ) : (
              <img
                src={ellipseIcon}
                alt=""
                className="h-3 w-3 shrink-0"
                style={{
                  filter: webInstalled
                    ? 'grayscale(0%) brightness(0) saturate(100%) invert(41%) sepia(99%) saturate(749%) hue-rotate(81deg) brightness(95%) contrast(92%)'
                    : 'none',
                }}
              />
            )
          ) : (
            <Wrench className="h-5 w-5 shrink-0 text-ds-icon-neutral-muted-default" />
          )}
          <span
            className={`truncate text-left text-body-sm font-medium ${isActive ? 'text-ds-text-neutral-default-default' : 'text-ds-text-neutral-muted-default'}`}
          >
            {label}
          </span>
        </div>
        {kind === 'your' && yourEnabled ? (
          <div className="m-1 h-2 w-2 shrink-0 rounded-full bg-ds-text-success-default-default" />
        ) : null}
      </button>
    );
  };

  useEffect(() => {
    if (!folderHint) return;
    if (folderHint === 'your') {
      if (isLoading) return;
      if (filteredItems.length > 0) {
        setSelected({ type: 'your', id: filteredItems[0].id });
      }
      setFolderHint(null);
      return;
    }
    if (folderHint === 'web') {
      if (isLoadingIntegrations) return;
      const pick = filteredIntegrations[0];
      if (pick) setSelected({ type: 'web', key: pick.key });
      setFolderHint(null);
    }
  }, [
    folderHint,
    filteredItems,
    filteredIntegrations,
    isLoading,
    isLoadingIntegrations,
  ]);

  useEffect(() => {
    if (!selected) return;
    if (selected.type === GOOGLE_SEARCH_ID) return;
    if (selected.type === 'web') {
      if (!integrations.some((i) => i.key === selected.key)) {
        setSelected(null);
      }
      return;
    }
    if (!items.some((i) => i.id === selected.id)) {
      setSelected(null);
    }
  }, [selected, integrations, items]);

  useEffect(() => {
    if (selected || isLoadingIntegrations || isLoading || folderHint) return;
    const pick = webConnected[0] || filteredItems[0] || filteredIntegrations[0];
    if (!pick) return;
    if ('mcp_name' in pick) {
      setSelected({ type: 'your', id: pick.id });
    } else {
      setSelected({ type: 'web', key: pick.key });
    }
  }, [
    selected,
    webConnected,
    filteredIntegrations,
    filteredItems,
    isLoadingIntegrations,
    isLoading,
    folderHint,
  ]);

  const renderConnectionPanel = () => {
    if (!selected) {
      return (
        <div className="py-16 text-center text-body-md text-ds-text-neutral-muted-default">
          {t('setting.mcp-select-connection')}
        </div>
      );
    }

    if (selected.type === GOOGLE_SEARCH_ID) {
      return (
        <div className="flex w-full flex-col rounded-2xl bg-ds-bg-neutral-subtle-default">
          <div className="mx-6 flex flex-row flex-wrap items-center justify-between gap-4 border-x-0 border-b-[0.5px] border-t-0 border-solid border-ds-border-neutral-default-default py-4">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ds-bg-neutral-default-default p-1">
                <img
                  src={googleIcon}
                  alt=""
                  className="h-5 w-5 object-contain"
                />
              </div>
              <div className="text-body-base min-w-0 truncate font-bold text-ds-text-neutral-default-default">
                Google Search
              </div>
            </div>
            {searchConnected && (
              <span className="rounded-full bg-ds-bg-success-subtle-default px-2.5 py-0.5 text-label-xs font-medium text-ds-text-success-default-default">
                {t('setting.configured', { defaultValue: 'Configured' })}
              </span>
            )}
          </div>
          <GoogleSearchPanel onConfigured={refreshConnectorConfigs} />
        </div>
      );
    }

    if (selected.type === 'web') {
      const item = integrations.find((i) => i.key === selected.key) as
        | IntegrationItem
        | undefined;
      if (!item) return null;
      const isConn = !!installed[item.key];
      const isComingSoon = (COMING_SOON_NAMES as readonly string[]).includes(
        item.name
      );
      const headerAssetUrl = integrationLeadingIconUrl(item.key);

      return (
        <div className="flex w-full flex-col rounded-2xl bg-ds-bg-neutral-subtle-default">
          <div className="mx-6 flex flex-row flex-wrap items-center justify-between gap-4 border-x-0 border-b-[0.5px] border-t-0 border-solid border-ds-border-neutral-default-default py-4">
            <div className="flex min-w-0 items-center gap-2">
              {headerAssetUrl ? (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ds-bg-neutral-default-default p-1">
                  <img
                    src={headerAssetUrl}
                    alt=""
                    className="h-5 w-5 object-contain"
                  />
                </div>
              ) : (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ds-bg-neutral-default-default p-1">
                  <img
                    src={ellipseIcon}
                    alt=""
                    className="h-3 w-3"
                    style={{
                      filter: isConn
                        ? 'grayscale(0%) brightness(0) saturate(100%) invert(41%) sepia(99%) saturate(749%) hue-rotate(81deg) brightness(95%) contrast(92%)'
                        : 'none',
                    }}
                  />
                </div>
              )}
              <div className="text-body-base min-w-0 truncate font-bold text-ds-text-neutral-default-default">
                {item.name}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                disabled={isComingSoon}
                variant={
                  isComingSoon ? 'ghost' : isConn ? 'outline' : 'primary'
                }
                size="sm"
                onClick={() => {
                  if (isComingSoon) return;
                  if (isConn) void handleUninstall(item);
                  else void handleWebInstall(item);
                }}
              >
                {isComingSoon
                  ? t('setting.coming-soon')
                  : isConn
                    ? t('setting.disconnect')
                    : t('setting.connect')}
              </Button>
              {item.env_vars?.length > 0 ? (
                <TooltipSimple content={t('setting.setting')}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    buttonContent="icon-only"
                    aria-label={t('setting.setting')}
                    onClick={() => handleOpenWebConfig(item)}
                  >
                    <Settings2 className="h-4 w-4" />
                  </Button>
                </TooltipSimple>
              ) : null}
            </div>
          </div>
          {item.desc ? (
            <div className="px-6 py-4">
              <span className="whitespace-pre-wrap text-body-sm text-ds-text-neutral-muted-default">
                {item.desc}
              </span>
            </div>
          ) : null}
        </div>
      );
    }

    const userItem = items.find((i) => i.id === selected.id);
    if (!userItem) return null;
    const enabled = userItem.status === 1;

    return (
      <div className="flex w-full flex-col rounded-2xl bg-ds-bg-neutral-subtle-default">
        <div className="mx-6 flex flex-row flex-wrap items-center justify-between gap-4 border-x-0 border-b-[0.5px] border-t-0 border-solid border-ds-border-neutral-default-default py-4">
          <div className="flex min-w-0 items-center gap-2">
            <Wrench className="h-7 w-7 shrink-0 rounded-lg bg-ds-bg-neutral-default-default p-1 text-ds-icon-neutral-muted-default" />
            <div className="text-body-base min-w-0 truncate font-bold text-ds-text-neutral-default-default">
              {capitalizeFirstLetter(userItem.mcp_name || '')}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              variant="outline"
              size="default"
              checked={enabled}
              disabled={!!switchLoading[userItem.id]}
              onCheckedChange={(checked) =>
                void handleSwitch(userItem.id, checked)
              }
              aria-label={enabled ? t('setting.disable') : t('setting.enable')}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  buttonContent="icon-only"
                  aria-label={t('setting.more-options', {
                    defaultValue: 'More options',
                  })}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => setShowConfig(userItem)}
                >
                  <Pencil className="h-4 w-4" />
                  {t('setting.edit', { defaultValue: 'Edit' })}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer text-ds-text-status-error-strong-default focus:text-ds-text-status-error-strong-default"
                  onClick={() => setDeleteTarget(userItem)}
                >
                  <Trash2 className="h-4 w-4 text-ds-text-status-error-strong-default" />
                  {t('setting.delete', { defaultValue: 'Delete' })}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    );
  };

  // config dialog
  useEffect(() => {
    if (showConfig) {
      setConfigForm({
        mcp_name: showConfig.mcp_name || '',
        mcp_desc: showConfig.mcp_desc || '',
        command: showConfig.command || '',
        argsArr: showConfig.args ? parseArgsToArray(showConfig.args) : [],
        env: showConfig.env ? { ...showConfig.env } : {},
      });
      setErrorMsg(null);
    } else {
      setConfigForm(null);
      setErrorMsg(null);
    }
  }, [showConfig]);

  const handleConfigSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!configForm || !showConfig) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      const mcpData = {
        mcp_name: configForm.mcp_name,
        mcp_desc: configForm.mcp_desc,
        command: configForm.command,
        args: arrayToArgsJson(configForm.argsArr),
        env: configForm.env,
      };
      await proxyFetchPut(`/api/v1/mcp/users/${showConfig.id}`, mcpData);

      const payload: Record<string, unknown> = {
        description: configForm.mcp_desc,
        command: configForm.command,
        args: arrayToArgsJson(configForm.argsArr),
      };
      if (configForm.env && Object.keys(configForm.env).length > 0) {
        payload.env = configForm.env;
      }
      await mcpUpdate(mcpData.mcp_name, payload);

      setShowConfig(null);
      fetchList();
    } catch (err: any) {
      setErrorMsg(err?.message || t('setting.save-failed'));
    } finally {
      setSaving(false);
    }
  };
  const handleConfigClose = () => {
    setShowConfig(null);
    setConfigForm(null);
    setErrorMsg(null);
  };
  const handleConfigSwitch = async (checked: boolean) => {
    if (!showConfig) return;
    setSaving(true);
    try {
      await proxyFetchPut(`/api/v1/mcp/users/${showConfig.id}`, {
        status: checked ? 1 : 0,
      });
      setShowConfig((prev) =>
        prev ? { ...prev, status: checked ? 1 : 0 } : prev
      );
      fetchList();
    } finally {
      setSaving(false);
    }
  };

  // add MCP dialog
  const handleInstall = async () => {
    setInstalling(true);
    try {
      if (addType === 'local') {
        let data: ConfigFile;
        try {
          data = JSON.parse(localJson);

          // validate mcpServers structure
          if (!data.mcpServers || typeof data.mcpServers !== 'object') {
            throw new Error('Invalid mcpServers');
          }

          // check for name conflicts with existing items
          const serverNames = Object.keys(data.mcpServers);
          const conflict = serverNames.find((name) =>
            items.some((d) => d.mcp_name === name)
          );
          if (conflict) {
            toast.error(
              t('setting.mcp-server-already-exists', { name: conflict }),
              {
                closeButton: true,
              }
            );
            setInstalling(false);
            return;
          }
        } catch (e) {
          console.error('Invalid JSON:', e);
          toast.error(t('setting.invalid-json'), { closeButton: true });
          setInstalling(false);
          return;
        }
        let res = await proxyFetchPost('/api/v1/mcp/import/local', data);
        if (res.detail) {
          toast.error(t('setting.invalid-json'), { closeButton: true });
          setInstalling(false);
          return;
        }
        const mcpServers = data['mcpServers'];
        if (mcpServers && typeof mcpServers === 'object') {
          for (const [key, value] of Object.entries(mcpServers)) {
            await mcpInstall(key, value as Record<string, unknown>);
          }
        }
      }
      setShowAdd(false);
      setLocalJson(`{
				"mcpServers": {}
			}`);
      setRemoteName('');
      setRemoteUrl('');
      fetchList();
    } finally {
      setInstalling(false);
    }
  };

  // delete dialog
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      checkAgentTool(deleteTarget.mcp_name);
      await proxyFetchDelete(`/api/v1/mcp/users/${deleteTarget.id}`);
      await mcpRemove(deleteTarget.mcp_key);
      if (selected?.type === 'your' && selected.id === deleteTarget.id) {
        setSelected(null);
      }
      setDeleteTarget(null);
      fetchList();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="m-auto flex h-auto w-full flex-1 flex-col">
      <div className="flex w-full items-center justify-between px-6 pb-6 pt-8">
        <div className="text-heading-sm font-bold text-ds-text-neutral-default-default">
          {t('setting.mcps-and-tools')}
        </div>
      </div>

      <div className="mb-12 flex flex-col gap-6">
        <div className="flex w-full flex-col items-start justify-between rounded-2xl bg-ds-bg-neutral-default-default px-3 py-2">
          <div className="z-10 mb-4 flex w-full flex-wrap items-center justify-between gap-3 border-x-0 border-b-[0.5px] border-t-0 border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default px-3 py-2">
            <div className="text-body-base font-bold text-ds-text-neutral-default-default">
              {t('setting.connectors')}
            </div>
            <div className="flex items-center gap-2">
              <SearchInput
                variant="icon"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('setting.search-mcp')}
              />
              <Button
                variant="primary"
                size="sm"
                onClick={() => setShowAdd(true)}
              >
                <Plus className="h-4 w-4" />
                {t('setting.mcp-add')}
              </Button>
            </div>
          </div>

          <div className="flex w-full flex-row items-start justify-between gap-4 px-3">
            <div className="sticky top-[var(--home-hub-history-tabs-offset,49px)] z-10 -ml-2 mr-4 h-fit max-h-[calc(100vh-var(--home-hub-history-tabs-offset,49px)-2rem)] w-[240px] shrink-0 self-start overflow-y-auto rounded-2xl bg-ds-bg-neutral-default-default">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => setWebCollapsed(!webCollapsed)}
                    className="flex items-center justify-between rounded-lg bg-transparent px-3 py-2 transition-colors hover:bg-ds-bg-neutral-default-default"
                  >
                    <div className="text-body-sm font-bold text-ds-text-neutral-default-default">
                      {t('setting.mcp-sidebar-built-in')}
                    </div>
                    {webCollapsed ? (
                      <ChevronDown className="h-4 w-4 text-ds-text-neutral-muted-default" />
                    ) : (
                      <ChevronUp className="h-4 w-4 text-ds-text-neutral-muted-default" />
                    )}
                  </button>
                  <div
                    className={`overflow-hidden transition-all duration-300 ease-in-out ${
                      webCollapsed
                        ? 'max-h-0 opacity-0'
                        : 'max-h-[2000px] opacity-100'
                    }`}
                  >
                    {isLoadingIntegrations ? (
                      <div className="flex flex-col gap-2 px-1">
                        {[1, 2, 3].map((i) => (
                          <div
                            key={i}
                            className="h-9 rounded-xl bg-ds-bg-neutral-strong-default"
                          />
                        ))}
                      </div>
                    ) : (
                      <>
                        {sortedWebItems.map((wi) => {
                          if (wi.kind === 'google-search') {
                            const isActive =
                              selected?.type === GOOGLE_SEARCH_ID;
                            return (
                              <button
                                key="google-search"
                                type="button"
                                onClick={() =>
                                  setSelected({ type: GOOGLE_SEARCH_ID })
                                }
                                className={`flex w-full items-center justify-between rounded-xl px-3 py-2 transition-all duration-200 ${
                                  isActive
                                    ? 'bg-ds-bg-neutral-subtle-default hover:bg-ds-bg-neutral-subtle-default'
                                    : 'bg-fill-fill-transparent hover:bg-fill-fill-transparent-hover'
                                }`}
                              >
                                <div className="flex min-w-0 items-center gap-3">
                                  <img
                                    src={googleIcon}
                                    alt=""
                                    className="h-5 w-5 shrink-0 object-contain"
                                  />
                                  <span
                                    className={`truncate text-left text-body-sm font-medium ${
                                      isActive
                                        ? 'text-ds-text-neutral-default-default'
                                        : 'text-ds-text-neutral-muted-default'
                                    }`}
                                  >
                                    Google Search
                                  </span>
                                </div>
                                {wi.connected && (
                                  <div className="m-1 h-2 w-2 shrink-0 rounded-full bg-ds-text-success-default-default" />
                                )}
                              </button>
                            );
                          }

                          const {
                            item,
                            connected: isConn,
                            comingSoon: isComingSoon,
                          } = wi;
                          const assetUrl = integrationLeadingIconUrl(item.key);
                          const isActive =
                            selected?.type === 'web' &&
                            selected.key === item.key;
                          return (
                            <button
                              key={`web-${item.key}`}
                              type="button"
                              disabled={isComingSoon}
                              onClick={() =>
                                !isComingSoon &&
                                setSelected({ type: 'web', key: item.key })
                              }
                              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 transition-all duration-200 ${
                                isActive
                                  ? 'bg-ds-bg-neutral-subtle-default hover:bg-ds-bg-neutral-subtle-default'
                                  : 'bg-fill-fill-transparent hover:bg-fill-fill-transparent-hover'
                              } ${isComingSoon ? 'cursor-not-allowed opacity-40' : ''}`}
                            >
                              <div className="flex min-w-0 items-center gap-3">
                                {assetUrl ? (
                                  <img
                                    src={assetUrl}
                                    alt=""
                                    className="h-5 w-5 shrink-0 object-contain"
                                  />
                                ) : (
                                  <img
                                    src={ellipseIcon}
                                    alt=""
                                    className="h-3 w-3 shrink-0"
                                    style={{
                                      filter: isConn
                                        ? 'grayscale(0%) brightness(0) saturate(100%) invert(41%) sepia(99%) saturate(749%) hue-rotate(81deg) brightness(95%) contrast(92%)'
                                        : 'none',
                                    }}
                                  />
                                )}
                                <span
                                  className={`truncate text-left text-body-sm font-medium ${
                                    isActive
                                      ? 'text-ds-text-neutral-default-default'
                                      : 'text-ds-text-neutral-muted-default'
                                  }`}
                                >
                                  {item.name}
                                </span>
                              </div>
                              {isConn && (
                                <div className="m-1 h-2 w-2 shrink-0 rounded-full bg-ds-text-success-default-default" />
                              )}
                            </button>
                          );
                        })}
                      </>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => setYourCollapsed(!yourCollapsed)}
                    className="flex items-center justify-between rounded-lg bg-transparent px-3 py-2 transition-colors hover:bg-ds-bg-neutral-default-default"
                  >
                    <div className="text-body-sm font-bold text-ds-text-neutral-default-default">
                      {t('setting.your-own-mcps')}
                    </div>
                    {yourCollapsed ? (
                      <ChevronDown className="h-4 w-4 text-ds-text-neutral-muted-default" />
                    ) : (
                      <ChevronUp className="h-4 w-4 text-ds-text-neutral-muted-default" />
                    )}
                  </button>
                  <div
                    className={`overflow-hidden transition-all duration-300 ease-in-out ${
                      yourCollapsed
                        ? 'max-h-0 opacity-0'
                        : 'max-h-[2000px] opacity-100'
                    }`}
                  >
                    {isLoading ? (
                      <div className="px-3 py-1 text-body-xs text-ds-text-neutral-muted-default">
                        {t('setting.loading')}
                      </div>
                    ) : error ? (
                      <div className="px-3 py-1 text-body-xs text-ds-text-status-error-strong-default">
                        {error}
                      </div>
                    ) : filteredItems.length === 0 ? (
                      <div className="px-3 py-2">
                        <p className="text-body-xs text-ds-text-neutral-muted-default">
                          {items.length === 0
                            ? t('setting.no-mcp-servers', {
                                defaultValue: 'No MCPs',
                              })
                            : t('dashboard.no-results')}
                        </p>
                      </div>
                    ) : (
                      filteredItems.map((item) =>
                        renderSidebarRow(
                          `your-${item.id}`,
                          capitalizeFirstLetter(item.mcp_name || ''),
                          'your',
                          selected?.type === 'your' && selected.id === item.id,
                          () => setSelected({ type: 'your', id: item.id }),
                          undefined,
                          item.status === 1
                        )
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="sticky top-[80px] z-10 min-w-0 flex-1">
              {isLoadingIntegrations && !selected ? (
                <div className="flex w-full flex-col items-start justify-start gap-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="relative w-full overflow-hidden rounded-2xl bg-ds-bg-neutral-strong-default px-6 py-4"
                    >
                      <div className="flex w-full flex-row items-center justify-between gap-xs">
                        <div className="flex flex-row items-center gap-xs">
                          <div className="mr-2 h-3 w-3 rounded-full bg-ds-bg-neutral-default-hover" />
                          <div className="h-5 w-32 rounded-md bg-ds-bg-neutral-default-hover" />
                        </div>
                        <div className="h-9 w-20 rounded-lg bg-ds-bg-neutral-default-hover" />
                      </div>
                      <motion.div
                        className="via-white/20 absolute inset-0 w-1/2 bg-gradient-to-r from-transparent to-transparent"
                        initial={{ x: '-100%' }}
                        animate={{ x: '200%' }}
                        transition={{
                          repeat: Infinity,
                          duration: 1.5,
                          ease: 'linear',
                        }}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                renderConnectionPanel()
              )}
            </div>
          </div>
        </div>
      </div>

      <MCPEnvDialog
        showEnvConfig={showEnvConfig}
        onClose={onCloseEnv}
        onConnect={onEnvConnect}
        activeMcp={activeMcp}
      />

      <MCPConfigDialog
        open={!!showConfig}
        form={configForm}
        mcp={showConfig}
        onChange={setConfigForm as any}
        onSave={handleConfigSave}
        onClose={handleConfigClose}
        loading={saving}
        errorMsg={errorMsg}
        onSwitchStatus={handleConfigSwitch}
      />
      <MCPAddDialog
        open={showAdd}
        addType={addType}
        setAddType={setAddType}
        localJson={localJson}
        setLocalJson={setLocalJson}
        remoteName={remoteName}
        setRemoteName={setRemoteName}
        remoteUrl={remoteUrl}
        setRemoteUrl={setRemoteUrl}
        installing={installing}
        onClose={() => setShowAdd(false)}
        onInstall={handleInstall}
      />
      <MCPDeleteDialog
        open={!!deleteTarget}
        target={deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        loading={deleting}
      />
    </div>
  );
}
