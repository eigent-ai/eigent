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
  fetchGet,
  fetchPost,
  proxyFetchDelete,
  proxyFetchGet,
  proxyFetchPost,
  proxyFetchPut,
} from '@/api/http';
import IntegrationList from '@/components/IntegrationList';
import SearchInput from '@/components/SearchInput';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getProxyBaseURL } from '@/lib';
import { useAuthStore } from '@/store/authStore';
import { motion } from 'framer-motion';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MCPAddDialog from './components/MCPAddDialog';
import MCPConfigDialog from './components/MCPConfigDialog';
import MCPDeleteDialog from './components/MCPDeleteDialog';
import MCPList from './components/MCPList';
import type { MCPConfigForm, MCPUserItem } from './components/types';
import { arrayToArgsJson, parseArgsToArray } from './components/utils';

import { ConfigFile } from 'electron/main/utils/mcpConfig';
import { toast } from 'sonner';

// Filter out Search from integrations (Search is now in its own Connectors tab)
const EXCLUDED_FROM_MCP = ['Search'];

export default function SettingMCP() {
  const { checkAgentTool } = useAuthStore();
  const { t } = useTranslation();
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
  const [activeTab, setActiveTab] = useState<'mcp-tools' | 'your-mcp'>(
    'mcp-tools'
  );
  const [searchQuery, setSearchQuery] = useState('');

  // add: integrations list
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [isLoadingIntegrations, setIsLoadingIntegrations] = useState(true);
  const [refreshKey, setRefreshKey] = useState<number>(0);

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

  // get list
  const fetchList = useCallback(() => {
    setIsLoading(true);
    setError('');
    proxyFetchGet('/api/mcp/users')
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
    proxyFetchGet('/api/config/info')
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
                      await proxyFetchPost('/api/configs', {
                        config_group: 'Notion',
                        config_name: 'MCP_REMOTE_CONFIG_DIR',
                        config_value:
                          response.toolkit_name || 'NotionMCPToolkit',
                      });
                      // Refresh the integrations list to show the installed state
                      fetchList();
                      // Force refresh IntegrationList component
                      setRefreshKey((prev) => prev + 1);
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
                          await proxyFetchGet('/api/configs');
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
                            `/api/configs/${existing.id}`,
                            configPayload
                          );
                        } else {
                          await proxyFetchPost('/api/configs', configPayload);
                        }
                      } catch (configError) {
                        console.warn(
                          'Failed to persist Google Calendar config',
                          configError
                        );
                      }
                      // Refresh the integrations list to show the installed state
                      fetchList();
                      // Force refresh IntegrationList component
                      setRefreshKey((prev) => prev + 1);
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
                                await proxyFetchGet('/api/configs');
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
                                  `/api/configs/${existing.id}`,
                                  payload
                                );
                              } else {
                                await proxyFetchPost('/api/configs', payload);
                              }

                              toast.success(
                                t(
                                  'setting.google-calendar-installed-successfully'
                                )
                              );
                              fetchList();
                              setRefreshKey((prev) => prev + 1);
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
                  const url = `${baseURL}/api/oauth/${key.toLowerCase()}/login`;
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
      });
  }, [fetchList, t]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  // MCP list switch
  const handleSwitch = async (id: number, checked: boolean) => {
    setSwitchLoading((l) => ({ ...l, [id]: true }));
    try {
      await proxyFetchPut(`/api/mcp/users/${id}`, { status: checked ? 1 : 2 });
      fetchList();
    } finally {
      setSwitchLoading((l) => ({ ...l, [id]: false }));
    }
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
      await proxyFetchPut(`/api/mcp/users/${showConfig.id}`, mcpData);

      if (window.ipcRenderer) {
        //Partial payload to empty env {}
        const payload: any = {
          description: configForm.mcp_desc,
          command: configForm.command,
          args: arrayToArgsJson(configForm.argsArr),
        };
        if (configForm.env && Object.keys(configForm.env).length > 0) {
          payload.env = configForm.env;
        }
        window.ipcRenderer.invoke('mcp-update', mcpData.mcp_name, payload);
      }

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
      await proxyFetchPut(`/api/mcp/users/${showConfig.id}`, {
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
        let res = await proxyFetchPost('/api/mcp/import/local', data);
        if (res.detail) {
          toast.error(t('setting.invalid-json'), { closeButton: true });
          setInstalling(false);
          return;
        }
        if (window.ipcRenderer) {
          const mcpServers = data['mcpServers'];
          for (const [key, value] of Object.entries(mcpServers)) {
            await window.ipcRenderer.invoke('mcp-install', key, value);
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
      await proxyFetchDelete(`/api/mcp/users/${deleteTarget.id}`);
      // notify main process
      if (window.ipcRenderer) {
        console.log('deleteTarget', deleteTarget.mcp_key);
        await window.ipcRenderer.invoke('mcp-remove', deleteTarget.mcp_key);
      }
      setDeleteTarget(null);
      fetchList();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="m-auto flex h-auto w-full flex-1 flex-col">
      {/* Header Section */}
      <div className="px-6 pb-6 pt-8 flex w-full items-center justify-between">
        <div className="text-heading-sm font-bold text-text-heading">
          {t('setting.mcp-and-tools')}
        </div>
      </div>

      {/* Content Section */}
      <div className="mb-12 gap-6 flex flex-col">
        <div className="gap-4 rounded-2xl bg-surface-secondary px-6 py-4 flex w-full flex-col items-center justify-between">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as 'mcp-tools' | 'your-mcp')}
            className="w-full"
          >
            <div className="gap-4 border-border-secondary bg-surface-secondary sticky top-[84px] z-10 flex w-full items-center justify-between border-x-0 border-t-0 border-b-[0.5px] border-solid">
              <TabsList
                variant="outline"
                className="h-auto flex-1 justify-start border-0 bg-transparent"
              >
                <TabsTrigger
                  value="mcp-tools"
                  className="data-[state=active]:bg-transparent"
                >
                  {t('setting.mcp-and-tools')}
                </TabsTrigger>
                <TabsTrigger
                  value="your-mcp"
                  className="data-[state=active]:bg-transparent"
                >
                  {t('setting.your-own-mcps')}
                </TabsTrigger>
              </TabsList>
              <div className="gap-2 flex items-center">
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
                  {t('setting.add-mcp-server')}
                </Button>
              </div>
            </div>
            <TabsContent value="mcp-tools" className="mt-4">
              {isLoadingIntegrations ? (
                <div className="gap-4 flex w-full flex-col items-start justify-start">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="rounded-2xl bg-surface-tertiary px-6 py-4 relative w-full overflow-hidden"
                    >
                      <div className="gap-xs flex w-full flex-row items-center justify-between">
                        <div className="gap-xs flex flex-row items-center">
                          <div className="mr-2 h-3 w-3 bg-surface-hover-subtle rounded-full" />
                          <div className="h-5 w-32 rounded-md bg-surface-hover-subtle" />
                          <div className="h-4 w-4 rounded bg-surface-hover-subtle" />
                        </div>
                        <div className="h-9 w-20 rounded-lg bg-surface-hover-subtle" />
                      </div>
                      <motion.div
                        className="inset-0 via-white/20 absolute w-1/2 bg-gradient-to-r from-transparent to-transparent"
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
              ) : filteredIntegrations.length === 0 ? (
                <div className="py-8 text-text-label text-center">
                  {searchQuery.trim()
                    ? t('dashboard.no-results')
                    : t('setting.no-mcp-servers')}
                </div>
              ) : (
                <IntegrationList
                  key={refreshKey}
                  variant="manage"
                  items={filteredIntegrations}
                  showConfigButton={false}
                  showInstallButton={true}
                />
              )}
            </TabsContent>
            <TabsContent value="your-mcp" className="mt-4">
              {isLoading && (
                <div className="py-8 text-text-label text-center">
                  {t('setting.loading')}
                </div>
              )}
              {error && (
                <div className="py-8 text-text-error text-center">{error}</div>
              )}
              {!isLoading && !error && items.length === 0 && (
                <div className="gap-4 py-12 flex flex-col items-center justify-center">
                  <p className="text-body-md text-text-label">
                    {t('setting.no-mcp-servers')}
                  </p>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setShowAdd(true)}
                  >
                    <Plus className="h-4 w-4" />
                    {t('setting.add-mcp-server')}
                  </Button>
                </div>
              )}
              {!isLoading &&
                !error &&
                items.length > 0 &&
                filteredItems.length === 0 && (
                  <div className="py-8 text-text-label text-center">
                    {t('dashboard.no-results')}
                  </div>
                )}
              {!isLoading && !error && filteredItems.length > 0 && (
                <MCPList
                  items={filteredItems}
                  onSetting={setShowConfig}
                  onDelete={setDeleteTarget}
                  onSwitch={handleSwitch}
                  switchLoading={switchLoading}
                />
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Dialogs */}
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
