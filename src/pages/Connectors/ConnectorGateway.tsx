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
  disconnectProvider,
  fetchConnectedProviders,
  fetchConnectorProvider,
  fetchConnectorProviders,
  invalidateConnectorProvidersCache,
  prefetchConnectorProviders,
  type ConnectorProvider,
} from '@/api/connectors';
import {
  fetchPost,
  proxyFetchDelete,
  proxyFetchGet,
  proxyFetchPost,
  proxyFetchPut,
} from '@/api/http';
import SearchInput from '@/components/Dashboard/SearchInput';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import {
  useIntegrationManagement,
  type IntegrationItem,
} from '@/hooks/useIntegrationManagement';
import { capitalizeFirstLetter, getProxyBaseURL } from '@/lib';
import { integrationLeadingIconUrl } from '@/lib/connectorIcons';
import { useAuthStore } from '@/store/authStore';
import { useServerCapabilityStore } from '@/store/serverCapabilityStore';
import type { TFunction } from 'i18next';
import {
  BadgeCheck,
  ChevronDown,
  Ellipsis,
  ExternalLink,
  Hammer,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Settings,
  Trash2,
  Wrench,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import AddConnectorDialog, {
  ProviderIcon,
  actionLabel,
  isConnectedProvider,
  providerActionCount,
  providerLabel,
  type AddConnectorTarget,
} from './components/AddConnectorDialog';
import AddCustomConnectorDialog from './components/AddCustomConnectorDialog';
import { GoogleSearchPanel } from './components/GoogleSearchPanel';
import MCPConfigDialog from './components/MCPConfigDialog';
import MCPDeleteDialog from './components/MCPDeleteDialog';
import type {
  ConnectorInstallHint,
  MCPConfigForm,
  MCPUserItem,
} from './components/types';
import { arrayToArgsJson, parseArgsToArray } from './components/utils';

const IS_LOCAL_MODE = import.meta.env.VITE_USE_LOCAL_PROXY === 'true';
const OVERVIEW_ID = '__overview__';
const HIDDEN_BUILT_INS = new Set([
  'RAG',
  'X(Twitter)',
  'WhatsApp',
  'Reddit',
  'Github',
]);

/** Preferred hosted connector service keys for the overview recommendations. */
const RECOMMENDED_SERVICE_KEYS = [
  ['slack'],
  ['notion'],
  ['gmail', 'google_gmail'],
  ['google_drive', 'googledrive', 'google-drive'],
  ['github'],
  ['google_calendar', 'googlecalendar', 'google-calendar'],
  ['stripe'],
  ['feishu', 'lark'],
] as const;

type ConnectorListItem =
  | {
      id: string;
      source: 'open';
      name: string;
      active: true;
      provider: ConnectorProvider;
    }
  | {
      id: string;
      source: 'builtin';
      name: string;
      active: true;
      item: IntegrationItem;
    }
  | {
      id: string;
      source: 'custom';
      name: string;
      active: boolean;
      subtype: 'local' | 'remote';
      item: MCPUserItem;
    };

async function upsertConfigValue(group: string, name: string, value: string) {
  const response = await proxyFetchGet('/api/v1/configs');
  const configs = Array.isArray(response) ? response : [];
  const existing = configs.find((config: any) => config.config_name === name);
  const payload = {
    config_group: group,
    config_name: name,
    config_value: value,
  };
  if (existing) {
    await proxyFetchPut(`/api/v1/configs/${existing.id}`, payload);
  } else {
    await proxyFetchPost('/api/v1/configs', payload);
  }
}

function createBuiltInInstallAction(
  key: string,
  t: TFunction
): () => Promise<void> | void {
  if (key === 'Search') return () => undefined;
  if (key === 'Notion') {
    return async () => {
      const response = await fetchPost('/install/tool/notion');
      if (!response?.success) {
        throw new Error(
          response?.error || t('connectors.notion-install-failed')
        );
      }
      await upsertConfigValue(
        'Notion',
        'MCP_REMOTE_CONFIG_DIR',
        response.toolkit_name || 'NotionMCPToolkit'
      );
    };
  }
  if (key === 'Google Calendar') {
    return async () => {
      const response = await fetchPost('/install/tool/google_calendar');
      if (response?.success) {
        await upsertConfigValue(
          'Google Calendar',
          'GOOGLE_REFRESH_TOKEN',
          'exists'
        );
        return;
      }
      if (response?.status !== 'authorizing') {
        throw new Error(
          response?.error ||
            response?.message ||
            t('connectors.google-calendar-install-failed')
        );
      }
    };
  }

  return () => {
    const baseUrl = getProxyBaseURL();
    window.open(
      `${baseUrl}/api/v1/oauth/${key.toLowerCase()}/login`,
      '_blank',
      'width=600,height=700'
    );
  };
}

function buildBuiltInItems(response: unknown, t: TFunction): IntegrationItem[] {
  const info =
    response && typeof response === 'object'
      ? (response as Record<string, any>)
      : {};
  const items = Object.entries(info)
    .filter(([key]) => !HIDDEN_BUILT_INS.has(key))
    .map(([key, value]) => ({
      key,
      name: key,
      env_vars: Array.isArray(value?.env_vars) ? value.env_vars : [],
      toolkit: value?.toolkit,
      desc:
        Array.isArray(value?.env_vars) && value.env_vars.length
          ? t('connectors.requires', { vars: value.env_vars.join(', ') })
          : key === 'Notion'
            ? t('connectors.notion-desc')
            : key === 'Google Calendar'
              ? t('connectors.google-calendar-desc')
              : t('connectors.generic-desc', { name: key }),
      onInstall: createBuiltInInstallAction(key, t),
    }));

  if (!items.some((item) => item.key === 'Search')) {
    items.unshift({
      key: 'Search',
      name: t('connectors.google-search'),
      env_vars: ['GOOGLE_API_KEY', 'SEARCH_ENGINE_ID'],
      toolkit: undefined,
      desc: t('connectors.google-search-desc'),
      onInstall: createBuiltInInstallAction('Search', t),
    });
  }
  return items;
}

function configuredSearch(configs: any[]): boolean {
  const names = new Set(
    configs
      .filter((config) => String(config.config_value || '').trim())
      .map((config) => config.config_name)
  );
  return names.has('GOOGLE_API_KEY') && names.has('SEARCH_ENGINE_ID');
}

function sourceLabel(item: ConnectorListItem, t: TFunction): string {
  if (item.source === 'open') return t('connectors.source-open');
  if (item.source === 'builtin') return t('connectors.source-built-in');
  return item.subtype === 'remote'
    ? t('connectors.source-remote')
    : t('connectors.source-local');
}

function connectorListRank(item: ConnectorListItem): number {
  if (item.source === 'custom') return 0;
  if (item.source === 'open') return 1;
  if (item.source === 'builtin' && item.item.key === 'Search') return 3;
  return 2;
}

function normalizedProviderKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function findOpenProviderByKeys(
  providers: ConnectorProvider[],
  serviceKeys: readonly string[]
): ConnectorProvider | null {
  const keys = new Set(serviceKeys.map(normalizedProviderKey));
  return (
    providers.find((provider) => {
      const service = normalizedProviderKey(provider.service);
      const label = normalizedProviderKey(providerLabel(provider));
      return keys.has(service) || keys.has(label);
    }) || null
  );
}

async function resolveOpenProviderByName(
  name: string
): Promise<ConnectorProvider | null> {
  const normalized = name.toLowerCase().trim();
  const candidates = Array.from(
    new Set([
      name,
      normalized.replace(/\s+/g, '_'),
      normalized.replace(/\s+/g, '-'),
      normalized.replace(/\s+/g, ''),
      normalized,
    ])
  );

  for (const query of candidates) {
    try {
      const search = await fetchConnectorProviders({
        page: 1,
        pageSize: 24,
        query,
      });
      const exact = findOpenProviderByKeys(search.providers, candidates);
      if (exact) return exact;
      const fuzzy =
        search.providers.find((provider) => {
          const service = provider.service.toLowerCase();
          const label = providerLabel(provider).toLowerCase();
          return service.includes(normalized) || label.includes(normalized);
        }) || null;
      if (fuzzy) return fuzzy;
    } catch {
      return null;
    }
  }
  return null;
}

export default function ConnectorGateway() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { checkAgentTool, modelType } = useAuthStore();
  const capabilityStatus = useServerCapabilityStore((state) => state.status);
  const connectorGatewayEnabled = useServerCapabilityStore((state) =>
    state.isConnectorGatewayEnabled()
  );
  const fetchCapabilities = useServerCapabilityStore(
    (state) => state.fetchCapabilities
  );

  const [builtInItems, setBuiltInItems] = useState<IntegrationItem[]>([]);
  const [customMcps, setCustomMcps] = useState<MCPUserItem[]>([]);
  const [openConnections, setOpenConnections] = useState<ConnectorProvider[]>(
    []
  );
  const [selectedId, setSelectedId] = useState<string>(OVERVIEW_ID);
  const [recommendedProviders, setRecommendedProviders] = useState<
    ConnectorProvider[]
  >([]);
  const [recommendedLoading, setRecommendedLoading] = useState(false);
  const [openDetail, setOpenDetail] = useState<ConnectorProvider | null>(null);
  const [listQuery, setListQuery] = useState('');
  const [loadingOpen, setLoadingOpen] = useState(false);
  const [loadingCustom, setLoadingCustom] = useState(false);
  const [loadingBuiltIns, setLoadingBuiltIns] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [browseDialogOpen, setBrowseDialogOpen] = useState(false);
  const [browseDialogTarget, setBrowseDialogTarget] =
    useState<AddConnectorTarget>(null);
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [showConfig, setShowConfig] = useState<MCPUserItem | null>(null);
  const [configForm, setConfigForm] = useState<MCPConfigForm | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MCPUserItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [actionsExpanded, setActionsExpanded] = useState(false);
  const [actionsOverflow, setActionsOverflow] = useState(false);
  const preferredSelectionRef = useRef<ConnectorInstallHint | null>(null);
  const actionsListRef = useRef<HTMLDivElement | null>(null);

  const {
    installed: rawBuiltInInstalled,
    configs,
    fetchInstalled: refreshBuiltIns,
    saveEnvAndConfig,
    handleUninstall,
  } = useIntegrationManagement(builtInItems);

  // Google Search is enabled by default on managed models; custom-model users
  // must provide their own Google Custom Search credentials.
  const searchRequiresApiKey = modelType === 'custom';
  const builtInInstalled = useMemo(() => {
    const next = { ...rawBuiltInInstalled };
    next.Search = searchRequiresApiKey ? configuredSearch(configs) : true;
    return next;
  }, [configs, rawBuiltInInstalled, searchRequiresApiKey]);

  // When Google Search is enabled by default there is nothing to install, so
  // keep it out of the Add-connector dialog; it still shows in the sidebar.
  const dialogBuiltInItems = useMemo(
    () =>
      searchRequiresApiKey
        ? builtInItems
        : builtInItems.filter((item) => item.key !== 'Search'),
    [builtInItems, searchRequiresApiKey]
  );

  const loadBuiltInCatalog = useCallback(async () => {
    setLoadingBuiltIns(true);
    try {
      const response = await proxyFetchGet('/api/v1/config/info');
      setBuiltInItems(buildBuiltInItems(response, t));
    } catch (error: any) {
      setPageError(error?.message || t('connectors.load-built-in-failed'));
      setBuiltInItems(buildBuiltInItems({}, t));
    } finally {
      setLoadingBuiltIns(false);
    }
  }, [t]);

  const loadCustomMcps = useCallback(async () => {
    setLoadingCustom(true);
    try {
      const response = await proxyFetchGet('/api/v1/mcp/users');
      setCustomMcps(
        Array.isArray(response)
          ? response
          : Array.isArray(response?.items)
            ? response.items
            : []
      );
    } catch (error: any) {
      setPageError(error?.message || t('connectors.load-custom-failed'));
      setCustomMcps([]);
    } finally {
      setLoadingCustom(false);
    }
  }, [t]);

  const loadOpenConnections = useCallback(async () => {
    if (!connectorGatewayEnabled) {
      setOpenConnections([]);
      return;
    }
    setLoadingOpen(true);
    try {
      setOpenConnections(await fetchConnectedProviders());
    } catch (error: any) {
      setPageError(error?.message || t('connectors.load-gateway-failed'));
      setOpenConnections([]);
    } finally {
      setLoadingOpen(false);
    }
  }, [connectorGatewayEnabled, t]);

  const refreshAll = useCallback(async () => {
    setPageError(null);
    await Promise.all([
      loadOpenConnections(),
      loadCustomMcps(),
      refreshBuiltIns(),
    ]);
  }, [loadCustomMcps, loadOpenConnections, refreshBuiltIns]);

  useEffect(() => {
    void fetchCapabilities();
    void loadBuiltInCatalog();
    void loadCustomMcps();
  }, [fetchCapabilities, loadBuiltInCatalog, loadCustomMcps]);

  useEffect(() => {
    if (capabilityStatus !== 'ready' || !connectorGatewayEnabled) return;
    // Warm the browse-dialog page-1 cache so Add Connector opens instantly.
    void prefetchConnectorProviders({ page: 1, pageSize: 60 });
    void loadOpenConnections();
  }, [capabilityStatus, connectorGatewayEnabled, loadOpenConnections]);

  useEffect(() => {
    if (capabilityStatus !== 'ready' || !connectorGatewayEnabled) {
      setRecommendedProviders([]);
      setRecommendedLoading(false);
      return;
    }

    let cancelled = false;
    setRecommendedLoading(true);
    void (async () => {
      const catalog = await fetchConnectorProviders({
        page: 1,
        pageSize: 60,
      });
      if (cancelled) return;
      const providers: ConnectorProvider[] = [];
      const seen = new Set<string>();
      for (const serviceKeys of RECOMMENDED_SERVICE_KEYS) {
        const provider = findOpenProviderByKeys(catalog.providers, serviceKeys);
        if (
          !provider ||
          seen.has(provider.service) ||
          isConnectedProvider(provider)
        ) {
          continue;
        }
        seen.add(provider.service);
        providers.push(provider);
      }
      for (const provider of catalog.providers) {
        if (providers.length >= RECOMMENDED_SERVICE_KEYS.length) break;
        if (seen.has(provider.service) || isConnectedProvider(provider)) {
          continue;
        }
        seen.add(provider.service);
        providers.push(provider);
      }
      setRecommendedProviders(providers);
      setRecommendedLoading(false);
    })().catch(() => {
      if (cancelled) return;
      setRecommendedProviders([]);
      setRecommendedLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [capabilityStatus, connectorGatewayEnabled]);

  const connectorItems = useMemo<ConnectorListItem[]>(() => {
    const openItems: ConnectorListItem[] = openConnections.map((provider) => ({
      id: `open:${provider.service}`,
      source: 'open',
      name: providerLabel(provider),
      active: true,
      provider,
    }));
    const builtIns: ConnectorListItem[] = builtInItems
      .filter((item) => builtInInstalled[item.key])
      .map((item) => ({
        id: `builtin:${item.key}`,
        source: 'builtin',
        name: item.name,
        active: true,
        item,
      }));
    const custom: ConnectorListItem[] = customMcps.map((item) => ({
      id: `custom:${item.id}`,
      source: 'custom',
      name: capitalizeFirstLetter(item.mcp_name || item.mcp_key || ''),
      active: Number(item.status) === 1,
      subtype: Number(item.type) === 2 ? 'remote' : 'local',
      item,
    }));
    return [...openItems, ...builtIns, ...custom].sort((left, right) => {
      const rankDelta = connectorListRank(left) - connectorListRank(right);
      if (rankDelta !== 0) return rankDelta;
      if (left.active !== right.active) return left.active ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
  }, [builtInInstalled, builtInItems, customMcps, openConnections]);

  useEffect(() => {
    const preferred = preferredSelectionRef.current;
    if (preferred) {
      const match = connectorItems.find((item) => {
        if (preferred.source === 'open') {
          return item.id === `open:${preferred.key}`;
        }
        if (preferred.source === 'builtin') {
          return item.id === `builtin:${preferred.key}`;
        }
        return (
          item.source === 'custom' &&
          (item.item.mcp_name === preferred.key ||
            item.item.mcp_key === preferred.key)
        );
      });
      if (match) {
        setSelectedId(match.id);
        preferredSelectionRef.current = null;
        return;
      }
    }

    if (selectedId === OVERVIEW_ID) return;
    if (connectorItems.some((item) => item.id === selectedId)) return;
    setSelectedId(OVERVIEW_ID);
  }, [connectorItems, selectedId]);

  const selected = useMemo(
    () => connectorItems.find((item) => item.id === selectedId) || null,
    [connectorItems, selectedId]
  );

  const selectedOpenService =
    selected?.source === 'open' ? selected.provider.service : null;

  useEffect(() => {
    if (!selectedOpenService) {
      setOpenDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setActionsExpanded(false);
    void fetchConnectorProvider(selectedOpenService)
      .then((response) => {
        if (!cancelled) setOpenDetail(response.provider);
      })
      .catch(() => {
        // Fall back to the list-provider data via `openDetail || item.provider`.
        if (!cancelled) setOpenDetail(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedOpenService]);

  const openDetailProvider =
    selected?.source === 'open' ? openDetail || selected.provider : null;

  useLayoutEffect(() => {
    const element = actionsListRef.current;
    if (!element || !openDetailProvider?.actions?.length) {
      setActionsOverflow(false);
      return;
    }
    setActionsOverflow(element.scrollHeight > 200);
  }, [openDetailProvider?.actions, openDetailProvider?.service, detailLoading]);

  useEffect(() => {
    const action = searchParams.get('connectorAction');
    const section = searchParams.get('connectorSection');
    if (action !== 'add' && section !== 'mcp-tools' && section !== 'your-mcp') {
      return;
    }
    if (section === 'your-mcp') {
      setCustomDialogOpen(true);
    } else {
      setBrowseDialogTarget(null);
      setBrowseDialogOpen(true);
    }
    const next = new URLSearchParams(searchParams);
    next.delete('connectorAction');
    next.delete('connectorSection');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!showConfig) {
      setConfigForm(null);
      setConfigError(null);
      return;
    }
    setConfigForm({
      mcp_name: showConfig.mcp_name || '',
      mcp_desc: showConfig.mcp_desc || '',
      command: showConfig.command || '',
      argsArr: showConfig.args ? parseArgsToArray(showConfig.args) : [],
      env: showConfig.env ? { ...showConfig.env } : {},
      server_url: showConfig.server_url || '',
    });
  }, [showConfig]);

  const visibleItems = useMemo(() => {
    const query = listQuery.trim().toLowerCase();
    if (!query) return connectorItems;
    return connectorItems.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        sourceLabel(item, t).toLowerCase().includes(query)
    );
  }, [connectorItems, listQuery, t]);

  const openBrowseDialog = (target: AddConnectorTarget = null) => {
    // Non-local hosts always use Connector Gateway providers — never Built-in.
    // Open the dialog immediately and resolve the matching hosted provider in the
    // background so the button never feels dead.
    if (!IS_LOCAL_MODE && target?.source === 'builtin') {
      setBrowseDialogTarget(null);
      setBrowseDialogOpen(true);
      if (connectorGatewayEnabled) {
        const builtInKey = target.item.key;
        void resolveOpenProviderByName(builtInKey).then((provider) => {
          if (provider) {
            setBrowseDialogTarget({ source: 'open', provider });
          }
        });
      }
      return;
    }
    setBrowseDialogTarget(target);
    setBrowseDialogOpen(true);
  };

  const openCustomDialog = () => {
    setCustomDialogOpen(true);
  };

  const openRecommendedConnector = (provider: ConnectorProvider) => {
    const existing = connectorItems.find(
      (item) =>
        item.source === 'open' && item.provider.service === provider.service
    );
    if (existing) {
      setSelectedId(existing.id);
      return;
    }
    openBrowseDialog({ source: 'open', provider });
  };

  const handleInstalled = useCallback(
    async (hint: ConnectorInstallHint) => {
      preferredSelectionRef.current = hint;
      invalidateConnectorProvidersCache();
      await refreshAll();
    },
    [refreshAll]
  );

  const handleDisconnectOpen = async (provider: ConnectorProvider) => {
    setActionLoading(true);
    try {
      await disconnectProvider(
        provider.service,
        provider.connection?.connectionName
      );
      invalidateConnectorProvidersCache();
      toast.success(
        t('connectors.disconnected', { name: providerLabel(provider) })
      );
      await loadOpenConnections();
    } catch (error: any) {
      toast.error(error?.message || t('connectors.disconnect-failed'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDisconnectBuiltIn = async (item: IntegrationItem) => {
    setActionLoading(true);
    try {
      await handleUninstall(item);
      await refreshBuiltIns();
      toast.success(t('connectors.disconnected', { name: item.name }));
    } catch (error: any) {
      toast.error(error?.message || t('connectors.disconnect-failed'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleCustomSwitch = async (item: MCPUserItem, checked: boolean) => {
    setActionLoading(true);
    try {
      const key = item.mcp_key || item.mcp_name;
      if (checked) {
        if (Number(item.type) === 2) {
          await mcpInstall(key, { url: item.server_url || '' });
        } else {
          await mcpInstall(key, {
            description: item.mcp_desc || '',
            command: item.command || '',
            args: item.args ? parseArgsToArray(item.args) : [],
            ...(item.env && Object.keys(item.env).length
              ? { env: item.env }
              : {}),
          });
        }
      } else {
        await mcpRemove(key);
      }
      try {
        await proxyFetchPut(`/api/v1/mcp/users/${item.id}`, {
          status: checked ? 1 : 2,
        });
      } catch {
        // The runtime install/remove already succeeded; only the saved status
        // is stale now, so surface that specifically.
        toast.error(
          t(
            checked
              ? 'connectors.status-save-failed-enabled'
              : 'connectors.status-save-failed-disabled'
          )
        );
      }
      await loadCustomMcps();
    } catch (error: any) {
      toast.error(error?.message || t('connectors.update-failed'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfigSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!configForm || !showConfig) return;
    setActionLoading(true);
    setConfigError(null);
    try {
      const isRemote = Number(showConfig.type) === 2;
      const payload = isRemote
        ? {
            mcp_name: configForm.mcp_name,
            mcp_desc: configForm.mcp_desc,
            server_url: configForm.server_url,
          }
        : {
            mcp_name: configForm.mcp_name,
            mcp_desc: configForm.mcp_desc,
            command: configForm.command,
            args: arrayToArgsJson(configForm.argsArr),
            env: configForm.env,
          };
      await proxyFetchPut(`/api/v1/mcp/users/${showConfig.id}`, payload);
      if (isRemote) {
        await mcpUpdate(showConfig.mcp_key || showConfig.mcp_name, {
          url: configForm.server_url,
        });
      } else {
        const brainPayload: Record<string, unknown> = {
          description: configForm.mcp_desc,
          command: configForm.command,
          args: arrayToArgsJson(configForm.argsArr),
        };
        if (Object.keys(configForm.env).length) {
          brainPayload.env = configForm.env;
        }
        await mcpUpdate(
          showConfig.mcp_key || showConfig.mcp_name,
          brainPayload
        );
      }
      setShowConfig(null);
      await loadCustomMcps();
      toast.success(t('connectors.updated'));
    } catch (error: any) {
      setConfigError(error?.message || t('connectors.save-failed'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      checkAgentTool(deleteTarget.mcp_name);
      await proxyFetchDelete(`/api/v1/mcp/users/${deleteTarget.id}`);
      const key = deleteTarget.mcp_key || deleteTarget.mcp_name;
      if (key) await mcpRemove(key);
      setDeleteTarget(null);
      await loadCustomMcps();
      toast.success(t('connectors.deleted'));
    } catch (error: any) {
      toast.error(error?.message || t('connectors.delete-failed'));
    } finally {
      setDeleteLoading(false);
    }
  };

  const pageLoading = loadingOpen || loadingCustom || loadingBuiltIns;

  const renderListIcon = (item: ConnectorListItem) => {
    if (item.source === 'open') {
      return <ProviderIcon provider={item.provider} size="list" />;
    }
    if (item.source === 'builtin') {
      const iconUrl = integrationLeadingIconUrl(item.item.key);
      return iconUrl ? (
        <img src={iconUrl} alt="" className="h-5 w-5 shrink-0 object-contain" />
      ) : (
        <Server className="h-5 w-5 shrink-0 text-ds-icon-neutral-muted-default" />
      );
    }
    return item.subtype === 'remote' ? (
      <Server className="h-5 w-5 shrink-0 text-ds-icon-neutral-muted-default" />
    ) : (
      <Wrench className="h-5 w-5 shrink-0 text-ds-icon-neutral-muted-default" />
    );
  };

  const isDefaultEnabledSearch = (item: ConnectorListItem) =>
    item.source === 'builtin' &&
    item.item.key === 'Search' &&
    !searchRequiresApiKey;

  const renderDetailHeader = (item: ConnectorListItem) => (
    <div className="mx-6 flex items-center gap-3 border-x-0 border-b border-t-0 border-solid border-ds-border-neutral-default-default py-4">
      {item.source === 'open' ? (
        <ProviderIcon provider={openDetail || item.provider} size="detail" />
      ) : (
        renderListIcon(item)
      )}
      <span className="text-body-base min-w-0 flex-1 truncate font-bold text-ds-text-neutral-default-default">
        {item.name}
      </span>
      {item.source !== 'open' ? (
        <Badge
          size="xs"
          variant="outline"
          className="shrink-0 whitespace-nowrap"
        >
          {sourceLabel(item, t)}
        </Badge>
      ) : null}
      <div className="flex shrink-0 items-center gap-1">
        {item.source === 'custom' ? (
          <Switch
            variant="outline"
            checked={item.active}
            disabled={actionLoading}
            onCheckedChange={(checked) =>
              void handleCustomSwitch(item.item, checked)
            }
            aria-label={
              item.active
                ? t('connectors.disable-connector')
                : t('connectors.enable-connector')
            }
          />
        ) : item.source === 'builtin' && item.item.key === 'Search' ? null : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              openBrowseDialog(
                item.source === 'open'
                  ? { source: 'open', provider: item.provider }
                  : { source: 'builtin', item: item.item }
              )
            }
          >
            <ExternalLink className="h-4 w-4" />
            {t('connectors.open')}
          </Button>
        )}
        {isDefaultEnabledSearch(item) ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                buttonContent="icon-only"
                size="sm"
                disabled={actionLoading}
                aria-label={t('connectors.more-actions')}
              >
                <Ellipsis className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {item.source === 'custom' ? (
                <DropdownMenuItem onClick={() => setShowConfig(item.item)}>
                  <Pencil className="h-4 w-4" />
                  {t('connectors.edit')}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                disabled={actionLoading}
                className="text-ds-text-error-default-default focus:text-ds-text-error-default-default"
                onClick={() => {
                  if (item.source === 'open') {
                    void handleDisconnectOpen(item.provider);
                    return;
                  }
                  if (item.source === 'builtin') {
                    void handleDisconnectBuiltIn(item.item);
                    return;
                  }
                  setDeleteTarget(item.item);
                }}
              >
                <Trash2 className="h-4 w-4" />
                {t('connectors.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );

  const renderOpenDetailBody = (
    item: Extract<ConnectorListItem, { source: 'open' }>
  ) => {
    const provider = openDetail || item.provider;
    if (detailLoading) {
      return (
        <div className="h-32 animate-pulse rounded-xl bg-ds-bg-neutral-strong-default" />
      );
    }
    return (
      <>
        {provider.connection?.profile?.displayName ? (
          <div className="rounded-xl border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default p-4">
            <span className="block text-body-xs font-bold uppercase tracking-wide text-ds-text-neutral-muted-default">
              {t('connectors.connected-account')}
            </span>
            <span className="mt-1 block text-body-sm font-bold text-ds-text-neutral-default-default">
              {provider.connection.profile.displayName}
            </span>
          </div>
        ) : null}

        {provider.actions?.length ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-body-sm font-bold text-ds-text-neutral-default-default">
                {t('connectors.supported-actions')}
              </span>
              <span className="text-body-sm text-ds-text-neutral-muted-default">
                {provider.actions.length || providerActionCount(provider)}
              </span>
            </div>
            <div className="overflow-hidden rounded-xl border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default">
              <div className="relative">
                <div
                  ref={actionsListRef}
                  className={`flex flex-wrap gap-2 p-4 ${
                    actionsExpanded ? '' : 'max-h-[200px] overflow-hidden'
                  }`}
                >
                  {provider.actions.map((action, index) => (
                    <span
                      key={action.id || action.name || index}
                      className="inline-flex items-center rounded-full bg-ds-bg-neutral-subtle-default px-3 py-1 text-label-xs text-ds-text-neutral-default-default"
                    >
                      {actionLabel(action, t)}
                    </span>
                  ))}
                </div>
                {!actionsExpanded && actionsOverflow ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-ds-bg-neutral-default-default to-transparent" />
                ) : null}
              </div>
              {actionsOverflow ? (
                <button
                  type="button"
                  onClick={() => setActionsExpanded((value) => !value)}
                  className="flex w-full items-center justify-center gap-1.5 border-0 bg-transparent px-4 py-2.5 text-label-xs text-ds-text-neutral-muted-default transition-colors hover:bg-ds-bg-neutral-default-hover hover:text-ds-text-neutral-default-default"
                >
                  {actionsExpanded
                    ? t('connectors.show-less')
                    : t('connectors.show-more')}
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${
                      actionsExpanded ? 'rotate-180' : ''
                    }`}
                  />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {provider.homepageUrl ? (
          <a
            href={provider.homepageUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-label-sm text-ds-text-neutral-muted-default underline-offset-2 hover:underline"
          >
            {t('connectors.provider-website')}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </>
    );
  };

  const renderBuiltInDetailBody = (
    item: Extract<ConnectorListItem, { source: 'builtin' }>
  ) => {
    if (item.item.key === 'Search') {
      return (
        <div className="rounded-xl border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default">
          <GoogleSearchPanel onConfigured={() => void refreshBuiltIns()} />
        </div>
      );
    }
    return (
      <div className="rounded-xl border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default p-4">
        <span className="block text-body-sm font-bold text-ds-text-neutral-default-default">
          {t('connectors.built-in-title')}
        </span>
        <span className="mt-1 block text-body-sm leading-6 text-ds-text-neutral-muted-default">
          {t('connectors.built-in-desc')}
        </span>
        {item.item.env_vars.length ? (
          <span className="mt-3 block text-body-xs text-ds-text-neutral-muted-default">
            {t('connectors.configuration', {
              vars: item.item.env_vars.join(', '),
            })}
          </span>
        ) : null}
      </div>
    );
  };

  const renderCustomDetailBody = (
    item: Extract<ConnectorListItem, { source: 'custom' }>
  ) => {
    const mcp = item.item;
    return (
      <div className="rounded-xl border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-body-sm font-bold text-ds-text-neutral-default-default">
            {t('connectors.status')}
          </span>
          <Badge
            size="sm"
            variant="secondary"
            tone={item.active ? 'success' : 'neutral'}
          >
            {item.active ? t('connectors.active') : t('connectors.disabled')}
          </Badge>
        </div>
        {item.subtype === 'remote' ? (
          <div className="mt-4">
            <span className="block text-body-xs font-bold uppercase tracking-wide text-ds-text-neutral-muted-default">
              {t('connectors.server-url')}
            </span>
            <span className="mt-1 block break-all font-mono text-body-sm text-ds-text-neutral-default-default">
              {mcp.server_url || t('connectors.not-configured')}
            </span>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div>
              <span className="block text-body-xs font-bold uppercase tracking-wide text-ds-text-neutral-muted-default">
                {t('connectors.command')}
              </span>
              <span className="mt-1 block font-mono text-body-sm text-ds-text-neutral-default-default">
                {mcp.command || t('connectors.not-configured')}
              </span>
            </div>
            {mcp.args ? (
              <div>
                <span className="block text-body-xs font-bold uppercase tracking-wide text-ds-text-neutral-muted-default">
                  {t('connectors.arguments')}
                </span>
                <span className="mt-1 block break-words font-mono text-body-sm text-ds-text-neutral-default-default">
                  {parseArgsToArray(mcp.args).join(' ')}
                </span>
              </div>
            ) : null}
          </div>
        )}
      </div>
    );
  };

  const renderDetailPanel = (item: ConnectorListItem) => (
    <div className="flex h-full w-full flex-col rounded-2xl bg-ds-bg-neutral-subtle-default">
      {renderDetailHeader(item)}
      <div className="space-y-5 px-6 py-4">
        {item.source === 'open'
          ? renderOpenDetailBody(item)
          : item.source === 'builtin'
            ? renderBuiltInDetailBody(item)
            : renderCustomDetailBody(item)}
      </div>
    </div>
  );

  const renderOverviewPanel = () => {
    const count = connectorItems.length;
    return (
      <div className="flex h-full w-full flex-col rounded-2xl bg-ds-bg-neutral-subtle-default">
        <div className="flex flex-col items-center px-6 pb-2 pt-8 text-center">
          <span className="text-heading-sm font-bold text-ds-text-neutral-default-default">
            {pageLoading && count === 0 ? '—' : count}
          </span>
          <span className="mt-1 text-body-sm text-ds-text-neutral-muted-default">
            {count === 1
              ? t('connectors.count-one')
              : t('connectors.count-other')}
          </span>
        </div>

        <div className="space-y-3 px-6 py-5">
          <span className="block text-center text-body-sm text-ds-text-neutral-muted-default">
            {t('connectors.recommended')}
          </span>
          {recommendedLoading && recommendedProviders.length === 0 ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {Array.from({ length: 8 }).map((_, index) => (
                <div
                  key={index}
                  className="h-20 animate-pulse rounded-2xl bg-ds-bg-neutral-default-default"
                />
              ))}
            </div>
          ) : recommendedProviders.length === 0 ? (
            <div className="flex min-h-24 items-center justify-center text-body-sm text-ds-text-neutral-muted-default">
              {connectorGatewayEnabled
                ? t('connectors.no-recommended')
                : t('connectors.gateway-unavailable')}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {recommendedProviders.map((provider) => {
                const liveProvider =
                  openConnections.find(
                    (item) => item.service === provider.service
                  ) || provider;
                const connected = isConnectedProvider(liveProvider);
                const existing = connectorItems.find(
                  (item) =>
                    item.source === 'open' &&
                    item.provider.service === provider.service
                );
                return (
                  <button
                    key={provider.service}
                    type="button"
                    onClick={() => {
                      if (existing) {
                        setSelectedId(existing.id);
                        return;
                      }
                      openRecommendedConnector(liveProvider);
                    }}
                    className="group flex h-20 items-center gap-3 rounded-2xl border border-solid border-transparent bg-ds-bg-neutral-default-default px-4 py-3 text-left transition-colors hover:border-ds-border-neutral-default-default hover:bg-ds-bg-neutral-default-hover"
                  >
                    <ProviderIcon provider={liveProvider} />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="text-body-base truncate font-bold text-ds-text-neutral-default-default">
                          {providerLabel(liveProvider)}
                        </span>
                        <BadgeCheck
                          className={`h-3.5 w-3.5 shrink-0 ${
                            connected || existing
                              ? 'text-ds-icon-success-default-default'
                              : 'text-ds-icon-neutral-muted-default'
                          }`}
                        />
                      </div>
                      {liveProvider.description?.trim() ? (
                        <span className="mt-1 line-clamp-1 block text-body-xs text-ds-text-neutral-muted-default">
                          {liveProvider.description.trim()}
                        </span>
                      ) : null}
                    </div>
                    {connected || existing ? (
                      <Settings className="h-4 w-4 shrink-0 text-ds-icon-neutral-muted-default" />
                    ) : (
                      <Plus className="h-4 w-4 shrink-0 text-ds-icon-neutral-muted-default" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="m-auto flex h-full w-full flex-1 flex-col pb-12">
      <div className="flex w-full flex-wrap items-center justify-between gap-3 px-6 pb-6 pt-8">
        <h1 className="text-heading-sm font-bold text-ds-text-neutral-default-default">
          {t('connectors.title')}
        </h1>
        <div className="flex items-center gap-2">
          <SearchInput
            variant="icon"
            value={listQuery}
            onChange={(event) => setListQuery(event.target.value)}
            placeholder={t('connectors.search-placeholder')}
          />
          <Button
            variant="primary"
            size="sm"
            onClick={() => openBrowseDialog()}
          >
            {t('connectors.browse')}
          </Button>
          <Button variant="secondary" size="sm" onClick={openCustomDialog}>
            <Plus className="h-4 w-4" />
            {t('connectors.add-custom')}
          </Button>
        </div>
      </div>

      {pageError ? (
        <div className="mx-6 mb-4 flex items-center justify-between gap-3 rounded-xl bg-ds-bg-error-subtle-default px-4 py-3 text-body-sm text-ds-text-error-strong-default">
          <span>{pageError}</span>
          <Button
            variant="ghost"
            size="sm"
            disabled={pageLoading}
            onClick={() => void refreshAll()}
          >
            <RefreshCw className="h-4 w-4" />
            {t('connectors.retry')}
          </Button>
        </div>
      ) : null}

      <div className="mb-12 flex min-h-[54vh] w-full flex-col items-start gap-4 rounded-2xl bg-ds-bg-neutral-default-default px-3 py-2 lg:flex-row">
        <aside className="w-full shrink-0 lg:sticky lg:top-[var(--home-hub-history-tabs-offset,49px)] lg:w-[240px]">
          <div className="scrollbar-always-visible max-h-[calc(100vh-var(--home-hub-history-tabs-offset,49px)-10rem)] space-y-1 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => setSelectedId(OVERVIEW_ID)}
              className={`flex w-full items-center gap-3 rounded-xl border-0 px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-ring-brand-default-focus ${
                selectedId === OVERVIEW_ID
                  ? 'bg-ds-bg-neutral-subtle-default'
                  : 'bg-transparent hover:bg-ds-bg-neutral-default-hover'
              }`}
            >
              <Hammer className="h-5 w-5 shrink-0 text-ds-icon-neutral-muted-default" />
              <span
                className={`min-w-0 flex-1 truncate text-body-sm font-medium ${
                  selectedId === OVERVIEW_ID
                    ? 'text-ds-text-neutral-default-default'
                    : 'text-ds-text-neutral-muted-default'
                }`}
              >
                {t('connectors.your-connectors')}
              </span>
              <Badge size="xs" variant="secondary" className="shrink-0">
                {connectorItems.length}
              </Badge>
            </button>

            {pageLoading && connectorItems.length === 0 ? (
              Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className="mx-1 h-9 animate-pulse rounded-xl bg-ds-bg-neutral-strong-default"
                />
              ))
            ) : visibleItems.length === 0 ? (
              listQuery.trim() ? (
                <div className="px-3 py-6 text-center">
                  <span className="text-body-sm text-ds-text-neutral-muted-default">
                    {t('connectors.no-matching')}
                  </span>
                </div>
              ) : null
            ) : (
              visibleItems.map((item) => {
                const active = selectedId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={`flex w-full items-center gap-3 rounded-xl border-0 px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-ring-brand-default-focus ${
                      active
                        ? 'bg-ds-bg-neutral-subtle-default'
                        : 'bg-transparent hover:bg-ds-bg-neutral-default-hover'
                    }`}
                  >
                    {renderListIcon(item)}
                    <span
                      className={`min-w-0 flex-1 truncate text-body-sm font-medium ${
                        active
                          ? 'text-ds-text-neutral-default-default'
                          : 'text-ds-text-neutral-muted-default'
                      }`}
                    >
                      {item.name}
                    </span>
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        item.active
                          ? 'bg-ds-text-success-default-default'
                          : 'bg-ds-icon-neutral-muted-default'
                      }`}
                    />
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <main className="flex h-full w-full min-w-0 flex-1">
          {selectedId === OVERVIEW_ID || !selected
            ? renderOverviewPanel()
            : renderDetailPanel(selected)}
        </main>
      </div>

      <AddConnectorDialog
        open={browseDialogOpen}
        connectorGatewayEnabled={connectorGatewayEnabled}
        localMode={IS_LOCAL_MODE}
        builtInItems={dialogBuiltInItems}
        builtInInstalled={builtInInstalled}
        configs={configs}
        initialTarget={browseDialogTarget}
        onOpenChange={(next) => {
          setBrowseDialogOpen(next);
          if (!next) setBrowseDialogTarget(null);
        }}
        onInstalled={handleInstalled}
        saveBuiltInValue={saveEnvAndConfig}
        refreshBuiltIns={refreshBuiltIns}
      />

      <AddCustomConnectorDialog
        open={customDialogOpen}
        customMcps={customMcps}
        onOpenChange={setCustomDialogOpen}
        onInstalled={handleInstalled}
      />

      <MCPConfigDialog
        open={Boolean(showConfig)}
        form={configForm}
        mcp={showConfig}
        onChange={setConfigForm as (form: MCPConfigForm) => void}
        onSave={handleConfigSave}
        onClose={() => setShowConfig(null)}
        loading={actionLoading}
        errorMsg={configError}
        onSwitchStatus={() => undefined}
      />
      <MCPDeleteDialog
        open={Boolean(deleteTarget)}
        target={deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        loading={deleteLoading}
      />
    </div>
  );
}
