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
import CollectionToolbar, {
  COLLECTION_RAIL_CLASS,
  COLLECTION_TOOLBAR_SEARCH_CLASS,
} from '@/components/Layout/CollectionToolbar';
import ContentBreadcrumb from '@/components/Layout/ContentBreadcrumb';
import ContentHeader from '@/components/Layout/ContentHeader';
import DocumentContentRail from '@/components/Layout/DocumentContentRail';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  useIntegrationManagement,
  type IntegrationItem,
} from '@/hooks/useIntegrationManagement';
import { capitalizeFirstLetter, getProxyBaseURL } from '@/lib';
import { shouldExposeBuiltInConnector } from '@/lib/builtInConnectorPolicy';
import { integrationLeadingIconUrl } from '@/lib/connectorIcons';
import {
  GOOGLE_API_KEY,
  isSearchConfigured,
  QUERIT_API_KEY,
  QUERIT_ENABLED,
  SEARCH_ENGINE_ID,
} from '@/lib/searchConfig';
import { shellDetailBackState } from '@/lib/shellRoutes';
import { useAuthStore } from '@/store/authStore';
import { useServerCapabilityStore } from '@/store/serverCapabilityStore';
import type { TFunction } from 'i18next';
import {
  ChevronDown,
  Ellipsis,
  ExternalLink,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import SettingsContentShell from '../SettingsContentShell';
import SettingsSectionPage from '../SettingsSectionPage';
import { usePublishConnectorsNavigation } from './ConnectorsNavigationContext';
import ConnectorBrowserPage, {
  actionLabel,
  isConnectedProvider,
  providerActionCount,
  ProviderIcon,
  providerLabel,
  type AddConnectorTarget,
} from './components/ConnectorBrowserPage';
import ConnectorSourceTag, {
  type ConnectorSourceTagKind,
} from './components/ConnectorSourceTag';
import MCPConfigDialog from './components/MCPConfigDialog';
import MCPDeleteDialog from './components/MCPDeleteDialog';
import { SearchSettingsPanel } from './components/SearchSettingsPanel';
import type {
  ConnectorInstallHint,
  MCPConfigForm,
  MCPUserItem,
} from './components/types';
import { arrayToArgsJson, parseArgsToArray } from './components/utils';

const IS_LOCAL_MODE = import.meta.env.VITE_USE_LOCAL_PROXY === 'true';
const OVERVIEW_ID = '__overview__';
type AddConnectorTab = 'browse' | 'local' | 'remote';
const RECOMMENDATIONS_DISMISSED_KEY =
  'eigent.connectors.recommendations-dismissed.v1';
const CONNECTOR_TABLE_ROW_CLASS = [
  'border-0 border-x-0 border-y-0 bg-transparent hover:bg-transparent data-[state=selected]:bg-transparent',
  '[&>td]:border-x-0 [&>td]:border-y [&>td]:border-solid [&>td]:border-transparent',
  '[&>td]:bg-ds-neutral-subtle-default [&>td]:transition-colors [&>td]:duration-150 motion-reduce:[&>td]:transition-none',
  '[&>td:first-child]:rounded-s-ds-field [&>td:first-child]:border-x-0 [&>td:first-child]:border-y [&>td:first-child]:border-s [&>td:first-child]:border-e-0',
  '[&>td:last-child]:rounded-e-ds-field [&>td:last-child]:border-x-0 [&>td:last-child]:border-y [&>td:last-child]:border-s-0 [&>td:last-child]:border-e',
  '[&:hover>td]:border-ds-hairline-subtle-default [&:hover>td]:bg-ds-neutral-default-hover',
].join(' ');
const loadAddCustomConnectorPage = () =>
  import('./components/AddCustomConnectorPage');
const AddCustomConnectorPage = lazy(loadAddCustomConnectorPage);
const preloadAddCustomConnectorPage = () => {
  void loadAddCustomConnectorPage().catch(() => undefined);
};
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
      active: boolean;
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

  const searchItem = items.find((item) => item.key === 'Search');
  if (searchItem) {
    searchItem.name = t('connectors.web-search');
    searchItem.env_vars = [
      QUERIT_ENABLED,
      QUERIT_API_KEY,
      GOOGLE_API_KEY,
      SEARCH_ENGINE_ID,
    ];
    searchItem.desc = t('connectors.web-search-desc');
  } else {
    items.unshift({
      key: 'Search',
      name: t('connectors.web-search'),
      env_vars: [
        QUERIT_ENABLED,
        QUERIT_API_KEY,
        GOOGLE_API_KEY,
        SEARCH_ENGINE_ID,
      ],
      toolkit: undefined,
      desc: t('connectors.web-search-desc'),
      onInstall: createBuiltInInstallAction('Search', t),
    });
  }
  return items;
}

function sourceLabel(item: ConnectorListItem, t: TFunction): string {
  if (item.source === 'open') return t('connectors.source-open');
  if (item.source === 'builtin') return t('connectors.source-built-in');
  return item.subtype === 'remote'
    ? t('connectors.source-remote')
    : t('connectors.source-local');
}

function sourceTagKind(item: ConnectorListItem): ConnectorSourceTagKind {
  if (item.source !== 'custom') return item.source;
  return item.subtype;
}

function addConnectorTargetId(
  target: Exclude<AddConnectorTarget, null>
): string {
  return target.source === 'open'
    ? `open:${target.provider.service}`
    : `builtin:${target.item.key}`;
}

function addConnectorTargetName(
  target: Exclude<AddConnectorTarget, null>
): string {
  return target.source === 'open'
    ? providerLabel(target.provider)
    : target.item.name;
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
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const publishItems = usePublishConnectorsNavigation();
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
  const [openConnectionsLoaded, setOpenConnectionsLoaded] =
    useState(IS_LOCAL_MODE);
  const [recommendedProviders, setRecommendedProviders] = useState<
    ConnectorProvider[]
  >([]);
  const [recommendedLoading, setRecommendedLoading] = useState(!IS_LOCAL_MODE);
  const [openDetail, setOpenDetail] = useState<ConnectorProvider | null>(null);
  const [listQuery, setListQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loadingOpen, setLoadingOpen] = useState(false);
  const [loadingCustom, setLoadingCustom] = useState(true);
  const [loadingBuiltIns, setLoadingBuiltIns] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [browseTarget, setBrowseTarget] = useState<AddConnectorTarget>(null);
  const [browseQuery, setBrowseQuery] = useState('');
  const [recommendationsDismissed, setRecommendationsDismissed] = useState(
    () => {
      try {
        return (
          window.localStorage.getItem(RECOMMENDATIONS_DISMISSED_KEY) === 'true'
        );
      } catch {
        return false;
      }
    }
  );
  const [showConfig, setShowConfig] = useState<MCPUserItem | null>(null);
  const [configForm, setConfigForm] = useState<MCPConfigForm | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MCPUserItem | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [actionsExpanded, setActionsExpanded] = useState(false);
  const [actionsOverflow, setActionsOverflow] = useState(false);
  const preferredSelectionRef = useRef<ConnectorInstallHint | null>(null);
  const actionsListRef = useRef<HTMLDivElement | null>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const translationRef = useRef(t);
  const locale = i18n.resolvedLanguage || i18n.language;
  const selectedId = searchParams.get('connectorId') || OVERVIEW_ID;
  const connectorView = searchParams.get('connectorView');
  const connectorTargetId =
    connectorView === 'add' ? searchParams.get('connectorTarget') : null;
  const addTabValue = searchParams.get('connectorAdd');
  const addTab: AddConnectorTab =
    addTabValue === 'local' || addTabValue === 'remote'
      ? addTabValue
      : 'browse';

  const updateConnectorLocation = useCallback(
    ({
      connectorId,
      view,
      tab,
      targetId,
      replace,
    }: {
      connectorId?: string | null;
      view?: 'add' | null;
      tab?: AddConnectorTab;
      targetId?: string | null;
      replace?: boolean;
    }) => {
      const next = new URLSearchParams(searchParams);
      next.set('section', 'settings');
      next.set('tab', 'connectors');
      if (connectorId) next.set('connectorId', connectorId);
      else next.delete('connectorId');
      if (view === 'add') {
        next.set('connectorView', 'add');
        next.set('connectorAdd', tab || 'browse');
        if (targetId) next.set('connectorTarget', targetId);
        else next.delete('connectorTarget');
      } else {
        next.delete('connectorView');
        next.delete('connectorAdd');
        next.delete('connectorTarget');
      }
      const isCurrentSubpage =
        selectedId !== OVERVIEW_ID || connectorView === 'add';
      const opensSubpage = Boolean(connectorId || view === 'add');
      const state =
        !isCurrentSubpage && opensSubpage
          ? shellDetailBackState(
              location.state as Record<string, unknown> | null,
              `${location.pathname}${location.search}`
            )
          : location.state;
      setSearchParams(next, {
        replace: replace ?? isCurrentSubpage,
        state,
      });
    },
    [
      connectorView,
      location.pathname,
      location.search,
      location.state,
      searchParams,
      selectedId,
      setSearchParams,
    ]
  );

  useEffect(() => {
    translationRef.current = t;
  }, [t]);

  const {
    installed: rawBuiltInInstalled,
    configs,
    configsLoading,
    fetchInstalled: refreshBuiltIns,
    saveEnvAndConfig,
    handleUninstall,
  } = useIntegrationManagement(builtInItems);

  // Managed models retain the existing cloud Google fallback. Custom models
  // are connected when Querit is enabled or both Google values are present.
  const searchRequiresApiKey = modelType === 'custom';
  const builtInInstalled = useMemo(() => {
    const next = { ...rawBuiltInInstalled };
    next.Search = searchRequiresApiKey ? isSearchConfigured(configs) : true;
    return next;
  }, [configs, rawBuiltInInstalled, searchRequiresApiKey]);

  const exposedBuiltInItems = useMemo(
    () =>
      builtInItems.filter((item) =>
        shouldExposeBuiltInConnector(item.key, connectorGatewayEnabled)
      ),
    [builtInItems, connectorGatewayEnabled]
  );

  // When Google Search is enabled by default there is nothing to install, so
  // keep it out of the Add-connector dialog; it still shows in the sidebar.
  const dialogBuiltInItems = useMemo(
    () =>
      searchRequiresApiKey
        ? exposedBuiltInItems
        : exposedBuiltInItems.filter((item) => item.key !== 'Search'),
    [exposedBuiltInItems, searchRequiresApiKey]
  );

  useEffect(() => {
    if (connectorView !== 'add' || !connectorTargetId) {
      setBrowseTarget(null);
      return;
    }
    setBrowseTarget(null);

    if (connectorTargetId.startsWith('builtin:')) {
      const key = connectorTargetId.slice('builtin:'.length);
      const item = dialogBuiltInItems.find(
        (candidate) => candidate.key === key
      );
      if (item) {
        setBrowseTarget((current) =>
          current?.source === 'builtin' && current.item.key === item.key
            ? current
            : { source: 'builtin', item }
        );
      } else if (!loadingBuiltIns) {
        updateConnectorLocation({
          view: 'add',
          tab: 'browse',
          targetId: null,
        });
      }
      return;
    }

    if (!connectorTargetId.startsWith('open:')) {
      updateConnectorLocation({
        view: 'add',
        tab: 'browse',
        targetId: null,
      });
      return;
    }
    const service = connectorTargetId.slice('open:'.length);
    const knownProvider = [...openConnections, ...recommendedProviders].find(
      (provider) => provider.service === service
    );
    if (knownProvider) {
      setBrowseTarget((current) =>
        current?.source === 'open' &&
        current.provider.service === knownProvider.service
          ? current
          : { source: 'open', provider: knownProvider }
      );
      return;
    }

    let cancelled = false;
    void fetchConnectorProvider(service)
      .then((response) => {
        if (!cancelled) {
          setBrowseTarget({ source: 'open', provider: response.provider });
        }
      })
      .catch(async () => {
        const provider = await resolveOpenProviderByName(service);
        if (!cancelled) {
          if (provider) {
            setBrowseTarget({ source: 'open', provider });
          } else {
            updateConnectorLocation({
              view: 'add',
              tab: 'browse',
              targetId: null,
            });
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    connectorTargetId,
    connectorView,
    dialogBuiltInItems,
    loadingBuiltIns,
    openConnections,
    recommendedProviders,
    updateConnectorLocation,
  ]);

  const loadBuiltInCatalog = useCallback(async () => {
    // Rebuild translated built-in names and descriptions after a locale switch.
    void locale;
    setLoadingBuiltIns(true);
    try {
      const response = await proxyFetchGet('/api/v1/config/info');
      setBuiltInItems(buildBuiltInItems(response, translationRef.current));
    } catch (error: any) {
      setPageError(
        error?.message ||
          translationRef.current('connectors.load-built-in-failed')
      );
      setBuiltInItems(buildBuiltInItems({}, translationRef.current));
    } finally {
      setLoadingBuiltIns(false);
    }
  }, [locale]);

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
      setPageError(
        error?.message ||
          translationRef.current('connectors.load-custom-failed')
      );
      setCustomMcps([]);
    } finally {
      setLoadingCustom(false);
    }
  }, []);

  const loadOpenConnections = useCallback(async () => {
    if (!connectorGatewayEnabled) {
      setOpenConnections([]);
      setOpenConnectionsLoaded(true);
      return;
    }
    setLoadingOpen(true);
    setOpenConnectionsLoaded(false);
    try {
      setOpenConnections(await fetchConnectedProviders());
    } catch (error: any) {
      setPageError(
        error?.message ||
          translationRef.current('connectors.load-gateway-failed')
      );
      setOpenConnections([]);
    } finally {
      setLoadingOpen(false);
      setOpenConnectionsLoaded(true);
    }
  }, [connectorGatewayEnabled]);

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
    if (capabilityStatus === 'idle' || capabilityStatus === 'loading') {
      setRecommendedLoading(true);
      return;
    }
    if (!connectorGatewayEnabled) {
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
    // Web search owns its configuration panel on this surface, so keep the
    // disconnected row visible instead of removing the user's only setup path.
    const builtIns: ConnectorListItem[] = exposedBuiltInItems
      .filter((item) => item.key === 'Search' || builtInInstalled[item.key])
      .map((item) => ({
        id: `builtin:${item.key}`,
        source: 'builtin',
        name: item.name,
        active: Boolean(builtInInstalled[item.key]),
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
  }, [builtInInstalled, customMcps, exposedBuiltInItems, openConnections]);

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
        updateConnectorLocation({ connectorId: match.id });
        preferredSelectionRef.current = null;
        return;
      }
    }
  }, [connectorItems, updateConnectorLocation]);

  const selected = useMemo(
    () => connectorItems.find((item) => item.id === selectedId) || null,
    [connectorItems, selectedId]
  );

  useEffect(() => {
    if (selected) {
      detailHeadingRef.current?.focus({ preventScroll: true });
    }
  }, [selected]);

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
    const next = new URLSearchParams(searchParams);
    next.delete('connectorAction');
    next.delete('connectorSection');
    next.delete('connectorId');
    next.set('connectorView', 'add');
    next.set('connectorAdd', section === 'your-mcp' ? 'local' : 'browse');
    setSearchParams(next, { replace: true, state: location.state });
  }, [location.state, searchParams, setSearchParams]);

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
    return connectorItems.filter((item) => {
      const matchesQuery =
        !query ||
        item.name.toLowerCase().includes(query) ||
        sourceLabel(item, t).toLowerCase().includes(query);
      const itemType = item.source === 'custom' ? item.subtype : item.source;
      const matchesType = typeFilter === 'all' || itemType === typeFilter;
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' ? item.active : !item.active);
      return matchesQuery && matchesType && matchesStatus;
    });
  }, [connectorItems, listQuery, statusFilter, t, typeFilter]);

  const openBrowsePage = useCallback(
    (target: AddConnectorTarget = null) => {
      // Non-local hosts always use Connector Gateway providers — never Built-in.
      // Open the dialog immediately and resolve the matching hosted provider in the
      // background so the button never feels dead.
      if (!IS_LOCAL_MODE && target?.source === 'builtin') {
        setBrowseTarget(null);
        updateConnectorLocation({
          view: 'add',
          tab: 'browse',
          targetId: null,
        });
        if (connectorGatewayEnabled) {
          const builtInKey = target.item.key;
          void resolveOpenProviderByName(builtInKey).then((provider) => {
            if (provider) {
              setBrowseTarget({ source: 'open', provider });
              updateConnectorLocation({
                view: 'add',
                tab: 'browse',
                targetId: `open:${provider.service}`,
                replace: true,
              });
            }
          });
        }
        return;
      }
      setBrowseTarget(target);
      updateConnectorLocation({
        view: 'add',
        tab: 'browse',
        targetId: target ? addConnectorTargetId(target) : null,
      });
    },
    [connectorGatewayEnabled, updateConnectorLocation]
  );

  const closeConnectorSubpage = useCallback(() => {
    setBrowseTarget(null);
    updateConnectorLocation({ connectorId: null });
  }, [updateConnectorLocation]);
  const backToAddConnector = useCallback(() => {
    setBrowseTarget(null);
    updateConnectorLocation({ view: 'add', tab: 'browse', targetId: null });
  }, [updateConnectorLocation]);
  const navigateHome = useCallback(() => {
    navigate('/home?section=spaces');
  }, [navigate]);

  const openRecommendedConnector = (provider: ConnectorProvider) => {
    const existing = connectorItems.find(
      (item) =>
        item.source === 'open' && item.provider.service === provider.service
    );
    if (existing) {
      updateConnectorLocation({ connectorId: existing.id });
      return;
    }
    openBrowsePage({ source: 'open', provider });
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

  const pageLoading =
    capabilityStatus === 'idle' ||
    capabilityStatus === 'loading' ||
    (connectorGatewayEnabled && !openConnectionsLoaded) ||
    configsLoading ||
    loadingOpen ||
    loadingCustom ||
    loadingBuiltIns;

  useEffect(() => {
    const navigationItems = connectorItems.map((item) => ({
      id: item.id,
      name: item.name,
      source: item.source,
      subtype: item.source === 'custom' ? item.subtype : undefined,
      active: item.active,
      iconUrl:
        item.source === 'open' ? item.provider.iconUrl || undefined : undefined,
      builtInKey: item.source === 'builtin' ? item.item.key : undefined,
    }));
    if (browseTarget) {
      const targetId = addConnectorTargetId(browseTarget);
      if (!navigationItems.some((item) => item.id === targetId)) {
        navigationItems.unshift({
          id: targetId,
          name: addConnectorTargetName(browseTarget),
          source: browseTarget.source,
          subtype: undefined,
          active:
            browseTarget.source === 'open'
              ? isConnectedProvider(browseTarget.provider)
              : Boolean(builtInInstalled[browseTarget.item.key]),
          iconUrl:
            browseTarget.source === 'open'
              ? browseTarget.provider.iconUrl || undefined
              : undefined,
          builtInKey:
            browseTarget.source === 'builtin'
              ? browseTarget.item.key
              : undefined,
        });
      }
    }
    publishItems(navigationItems, pageLoading);
  }, [
    browseTarget,
    builtInInstalled,
    connectorItems,
    pageLoading,
    publishItems,
  ]);

  useEffect(() => {
    if (
      selectedId === OVERVIEW_ID ||
      selected ||
      pageLoading ||
      connectorView === 'add'
    ) {
      return;
    }
    updateConnectorLocation({ connectorId: null });
  }, [
    connectorView,
    pageLoading,
    selected,
    selectedId,
    updateConnectorLocation,
  ]);

  const renderListIcon = (item: ConnectorListItem) => {
    if (item.source === 'open') {
      return <ProviderIcon provider={item.provider} size="list" />;
    }
    if (item.source === 'builtin') {
      const iconUrl = integrationLeadingIconUrl(item.item.key);
      return iconUrl ? (
        <img src={iconUrl} alt="" className="h-5 w-5 shrink-0 object-contain" />
      ) : (
        <Server className="h-5 w-5 shrink-0 text-ds-ink-muted-default" />
      );
    }
    return item.subtype === 'remote' ? (
      <Server className="h-5 w-5 shrink-0 text-ds-ink-muted-default" />
    ) : (
      <Wrench className="h-5 w-5 shrink-0 text-ds-ink-muted-default" />
    );
  };

  const isDefaultEnabledSearch = (item: ConnectorListItem) =>
    item.source === 'builtin' &&
    item.item.key === 'Search' &&
    !searchRequiresApiKey;

  const renderDetailActions = (item: ConnectorListItem) => (
    <>
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
            openBrowsePage(
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
              {item.source === 'custom'
                ? t('connectors.delete')
                : t('connectors.disconnect')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );

  const renderDetailIdentity = (item: ConnectorListItem) => (
    <div className="flex min-w-0 items-center gap-ds-12">
      {item.source === 'open' ? (
        <ProviderIcon provider={openDetail || item.provider} size="lg" />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-ds-card bg-ds-neutral-subtle-default">
          {renderListIcon(item)}
        </div>
      )}
      <div className="min-w-0">
        <span className="block truncate text-ds-text-section font-semibold text-ds-ink-default-default">
          {item.name}
        </span>
        <ConnectorSourceTag kind={sourceTagKind(item)} className="mt-ds-4">
          {sourceLabel(item, t)}
        </ConnectorSourceTag>
      </div>
    </div>
  );

  const renderOpenDetailBody = (
    item: Extract<ConnectorListItem, { source: 'open' }>
  ) => {
    const provider = openDetail || item.provider;
    if (detailLoading) {
      return (
        <div className="h-32 animate-pulse rounded-xl bg-ds-neutral-strong-default" />
      );
    }
    return (
      <>
        {provider.connection?.profile?.displayName ? (
          <div className="rounded-xl border border-x border-y border-solid border-ds-hairline-default-default bg-ds-neutral-default-default p-4">
            <span className="block text-ds-text-meta font-bold tracking-wide text-ds-ink-muted-default uppercase">
              {t('connectors.connected-account')}
            </span>
            <span className="mt-1 block text-ds-text-base font-bold text-ds-ink-default-default">
              {provider.connection.profile.displayName}
            </span>
          </div>
        ) : null}

        {provider.actions?.length ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-ds-text-base font-bold text-ds-ink-default-default">
                {t('connectors.supported-actions')}
              </span>
              <span className="text-ds-text-base text-ds-ink-muted-default">
                {provider.actions.length || providerActionCount(provider)}
              </span>
            </div>
            <div className="overflow-hidden rounded-xl border border-x border-y border-solid border-ds-hairline-default-default bg-ds-neutral-default-default">
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
                      className="inline-flex items-center rounded-full bg-ds-neutral-subtle-default px-3 py-1 text-ds-text-meta text-ds-ink-default-default"
                    >
                      {actionLabel(action, t)}
                    </span>
                  ))}
                </div>
                {!actionsExpanded && actionsOverflow ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-ds-neutral-default-default to-transparent" />
                ) : null}
              </div>
              {actionsOverflow ? (
                <button
                  type="button"
                  onClick={() => setActionsExpanded((value) => !value)}
                  className="flex w-full items-center justify-center gap-1.5 border-0 border-x-0 border-y-0 bg-transparent px-4 py-2.5 text-ds-text-meta text-ds-ink-muted-default transition-colors hover:bg-ds-neutral-default-hover hover:text-ds-ink-default-default"
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
            className="inline-flex items-center gap-1 text-ds-text-base text-ds-ink-muted-default underline-offset-2 hover:underline"
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
        <div className="rounded-xl border border-x border-y border-solid border-ds-hairline-default-default bg-ds-neutral-default-default">
          <SearchSettingsPanel onConfigured={() => void refreshBuiltIns()} />
        </div>
      );
    }
    return (
      <div className="rounded-xl border border-x border-y border-solid border-ds-hairline-default-default bg-ds-neutral-default-default p-4">
        <span className="block text-ds-text-base font-bold text-ds-ink-default-default">
          {t('connectors.built-in-title')}
        </span>
        <span className="mt-1 block text-ds-text-base leading-6 text-ds-ink-muted-default">
          {t('connectors.built-in-desc')}
        </span>
        {item.item.env_vars.length ? (
          <span className="mt-3 block text-ds-text-meta text-ds-ink-muted-default">
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
      <div className="rounded-xl border border-x border-y border-solid border-ds-hairline-default-default bg-ds-neutral-default-default p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-ds-text-base font-bold text-ds-ink-default-default">
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
            <span className="block text-ds-text-meta font-bold tracking-wide text-ds-ink-muted-default uppercase">
              {t('connectors.server-url')}
            </span>
            <span className="mt-1 block font-mono text-ds-text-base break-all text-ds-ink-default-default">
              {mcp.server_url || t('connectors.not-configured')}
            </span>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div>
              <span className="block text-ds-text-meta font-bold tracking-wide text-ds-ink-muted-default uppercase">
                {t('connectors.command')}
              </span>
              <span className="mt-1 block font-mono text-ds-text-base text-ds-ink-default-default">
                {mcp.command || t('connectors.not-configured')}
              </span>
            </div>
            {mcp.args ? (
              <div>
                <span className="block text-ds-text-meta font-bold tracking-wide text-ds-ink-muted-default uppercase">
                  {t('connectors.arguments')}
                </span>
                <span className="mt-1 block font-mono text-ds-text-base break-words text-ds-ink-default-default">
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
    <div className="flex min-h-full min-w-0 flex-col" data-connector-detail>
      <ContentHeader
        className="gap-ds-12 px-ds-16"
        titleAsChild
        title={
          <ContentBreadcrumb
            headingRef={detailHeadingRef}
            ariaLabel={t('layout.breadcrumb', { defaultValue: 'Breadcrumb' })}
            segments={[
              {
                label: t('layout.home', { defaultValue: 'Home' }),
                onClick: navigateHome,
              },
              {
                label: t('connectors.connector'),
                onClick: closeConnectorSubpage,
              },
              { label: item.name },
            ]}
          />
        }
        actions={renderDetailActions(item)}
      />
      <div className="px-ds-24 py-ds-24">
        <DocumentContentRail className="flex flex-col gap-ds-24">
          {renderDetailIdentity(item)}
          <div className="flex flex-col gap-ds-16">
            {item.source === 'open'
              ? renderOpenDetailBody(item)
              : item.source === 'builtin'
                ? renderBuiltInDetailBody(item)
                : renderCustomDetailBody(item)}
          </div>
        </DocumentContentRail>
      </div>
    </div>
  );

  const renderRecommendedConnectors = () => {
    if (recommendedLoading && recommendedProviders.length === 0) {
      return (
        <div className="flex w-full flex-wrap gap-ds-8">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="rounded-ds-control h-ds-control-sm w-28 animate-pulse bg-ds-neutral-strong-default motion-reduce:animate-none"
            />
          ))}
        </div>
      );
    }

    if (recommendedProviders.length === 0) {
      return (
        <div className="flex min-h-20 w-full items-center justify-center text-ds-text-base text-ds-ink-muted-default">
          {connectorGatewayEnabled
            ? t('connectors.no-recommended')
            : t('connectors.gateway-unavailable')}
        </div>
      );
    }

    return (
      <div className="flex w-full flex-wrap gap-ds-8">
        {recommendedProviders.slice(0, 6).map((provider) => {
          const liveProvider =
            openConnections.find((item) => item.service === provider.service) ||
            provider;
          return (
            <Button
              key={provider.service}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openRecommendedConnector(liveProvider)}
              className="min-w-0"
            >
              <ProviderIcon provider={liveProvider} size="list" />
              <span className="max-w-32 truncate">
                {providerLabel(liveProvider)}
              </span>
              <Plus aria-hidden />
            </Button>
          );
        })}
      </div>
    );
  };

  const renderConnectorTable = () => {
    if (pageLoading && connectorItems.length === 0) {
      return (
        <div className="flex w-full flex-col gap-ds-4" role="status">
          <span className="sr-only">{t('connectors.loading')}</span>
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              aria-hidden
              className="h-14 animate-pulse rounded-ds-field bg-ds-neutral-subtle-default motion-reduce:animate-none"
            />
          ))}
        </div>
      );
    }

    if (visibleItems.length === 0) {
      return (
        <div className="flex min-h-40 w-full flex-col items-center justify-center gap-ds-12 rounded-ds-card bg-ds-neutral-subtle-default px-ds-24 text-center">
          <span className="text-ds-text-base text-ds-ink-muted-default">
            {connectorItems.length === 0
              ? t('connectors.no-connectors')
              : t('connectors.no-matching')}
          </span>
          {connectorItems.length === 0 ? (
            <Button
              variant="secondary"
              size="sm"
              buttonRadius="full"
              onClick={() => openBrowsePage()}
            >
              {t('connectors.add-connector')}
            </Button>
          ) : null}
        </div>
      );
    }

    return (
      <div className="-m-ds-4 [&>div]:p-ds-4">
        <Table
          aria-label={t('connectors.connector-table')}
          containerClassName="scrollbar-always-visible"
          className="min-w-[640px] border-separate border-spacing-x-0 border-spacing-y-ds-4 text-start text-ds-text-base"
        >
          <TableHeader>
            <TableRow className="border-ds-hairline-subtle-default hover:bg-transparent [&>th]:whitespace-nowrap">
              <TableHead className="w-full text-start">
                {t('connectors.connector')}
              </TableHead>
              <TableHead className="w-px text-start">
                {t('connectors.type')}
              </TableHead>
              <TableHead className="text-start">
                {t('connectors.status')}
              </TableHead>
              <TableHead className="text-start">
                <span className="sr-only">{t('connectors.more-actions')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleItems.map((item) => {
              const statusLabel = item.active
                ? t('connectors.connected')
                : t('connectors.not-connected');
              return (
                <TableRow key={item.id} className={CONNECTOR_TABLE_ROW_CLASS}>
                  <TableCell className="w-full max-w-0">
                    <Button
                      type="button"
                      variant="text"
                      size="sm"
                      textWeight="medium"
                      className="w-full min-w-0 justify-start !text-ds-ink-default-default no-underline hover:!text-ds-ink-default-default hover:underline"
                      title={item.name}
                      onClick={() =>
                        updateConnectorLocation({ connectorId: item.id })
                      }
                    >
                      {renderListIcon(item)}
                      <span className="min-w-0 truncate">{item.name}</span>
                    </Button>
                  </TableCell>
                  <TableCell className="w-px whitespace-nowrap">
                    <ConnectorSourceTag kind={sourceTagKind(item)}>
                      {sourceLabel(item, t)}
                    </ConnectorSourceTag>
                  </TableCell>
                  <TableCell>
                    <div className="flex min-h-ds-control-sm items-center gap-ds-8">
                      {item.source === 'custom' ? (
                        <Switch
                          size="sm"
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
                      ) : null}
                      <span className="text-ds-text-base whitespace-nowrap text-ds-ink-muted-default">
                        {statusLabel}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {isDefaultEnabledSearch(item) ? null : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            buttonContent="icon-only"
                            disabled={actionLoading}
                            aria-label={t('connectors.connector-actions', {
                              name: item.name,
                            })}
                          >
                            <Ellipsis />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() =>
                              updateConnectorLocation({ connectorId: item.id })
                            }
                          >
                            <ExternalLink />
                            {t('connectors.open')}
                          </DropdownMenuItem>
                          {item.source === 'custom' ? (
                            <DropdownMenuItem
                              onClick={() => setShowConfig(item.item)}
                            >
                              <Pencil />
                              {t('connectors.edit')}
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem
                            disabled={actionLoading}
                            className="text-ds-text-error-default-default focus:text-ds-text-error-default-default"
                            onClick={() => {
                              if (item.source === 'open') {
                                void handleDisconnectOpen(item.provider);
                              } else if (item.source === 'builtin') {
                                void handleDisconnectBuiltIn(item.item);
                              } else {
                                setDeleteTarget(item.item);
                              }
                            }}
                          >
                            <Trash2 />
                            {item.source === 'custom'
                              ? t('connectors.delete')
                              : t('connectors.disconnect')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  };

  const dialogs = (
    <>
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
    </>
  );

  if (connectorView === 'add') {
    if (connectorTargetId) {
      const targetName = browseTarget
        ? addConnectorTargetName(browseTarget)
        : capitalizeFirstLetter(
            connectorTargetId
              .slice(connectorTargetId.indexOf(':') + 1)
              .replace(/[-_]+/g, ' ')
          );
      return (
        <div
          className="flex min-h-full min-w-0 flex-col"
          data-add-connector
          data-connector-browser-detail
        >
          <ContentHeader
            className="gap-ds-12 px-ds-16"
            titleAsChild
            title={
              <ContentBreadcrumb
                currentAsHeading={false}
                ariaLabel={t('layout.breadcrumb', {
                  defaultValue: 'Breadcrumb',
                })}
                segments={[
                  {
                    label: t('layout.home', { defaultValue: 'Home' }),
                    onClick: navigateHome,
                  },
                  {
                    label: t('connectors.connector'),
                    onClick: closeConnectorSubpage,
                  },
                  {
                    label: t('connectors.add-connector'),
                    onClick: backToAddConnector,
                  },
                  { label: targetName },
                ]}
              />
            }
          />
          <div className="mx-auto flex w-full max-w-[964px] flex-col px-8">
            {browseTarget ? (
              <ConnectorBrowserPage
                embedded
                connectorGatewayEnabled={connectorGatewayEnabled}
                localMode={IS_LOCAL_MODE}
                builtInItems={dialogBuiltInItems}
                builtInInstalled={builtInInstalled}
                configs={configs}
                initialTarget={browseTarget}
                onBack={backToAddConnector}
                onInstalled={handleInstalled}
                saveBuiltInValue={saveEnvAndConfig}
                refreshBuiltIns={refreshBuiltIns}
              />
            ) : (
              <div
                role="status"
                aria-live="polite"
                className="flex min-h-[420px] w-full flex-col gap-ds-16"
              >
                <span className="sr-only">{t('connectors.loading')}</span>
                <div
                  aria-hidden
                  className="h-20 animate-pulse rounded-ds-card bg-ds-neutral-subtle-default motion-reduce:animate-none"
                />
                <div
                  aria-hidden
                  className="h-80 animate-pulse rounded-ds-card bg-ds-neutral-subtle-default motion-reduce:animate-none"
                />
              </div>
            )}
          </div>
          {dialogs}
        </div>
      );
    }

    return (
      <div className="flex min-h-full min-w-0 flex-col" data-add-connector>
        <ContentHeader
          className="gap-ds-12 px-ds-16"
          titleAsChild
          title={
            <ContentBreadcrumb
              ariaLabel={t('layout.breadcrumb', { defaultValue: 'Breadcrumb' })}
              segments={[
                {
                  label: t('layout.home', { defaultValue: 'Home' }),
                  onClick: navigateHome,
                },
                {
                  label: t('connectors.connector'),
                  onClick: closeConnectorSubpage,
                },
                { label: t('connectors.add-connector') },
              ]}
            />
          }
        />
        <div className="mx-auto flex w-full max-w-[964px] flex-col gap-ds-16 px-8 py-ds-24">
          <Tabs
            className="flex flex-col gap-ds-16"
            value={addTab}
            onValueChange={(value) => {
              setBrowseTarget(null);
              updateConnectorLocation({
                view: 'add',
                tab: value as AddConnectorTab,
              });
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-ds-12">
              <TabsList appearance="default" className="w-[420px] max-w-full">
                <TabsTrigger
                  value="browse"
                  className="flex-1 !text-ds-text-base"
                >
                  {t('connectors.browse')}
                </TabsTrigger>
                <TabsTrigger
                  value="local"
                  className="flex-1 !text-ds-text-base"
                  onFocus={preloadAddCustomConnectorPage}
                  onPointerEnter={preloadAddCustomConnectorPage}
                >
                  {t('connectors.source-local')}
                </TabsTrigger>
                <TabsTrigger
                  value="remote"
                  className="flex-1 !text-ds-text-base"
                  onFocus={preloadAddCustomConnectorPage}
                  onPointerEnter={preloadAddCustomConnectorPage}
                >
                  {t('connectors.source-remote')}
                </TabsTrigger>
              </TabsList>
              {addTab === 'browse' ? (
                <div className="w-56 max-w-full">
                  <SearchInput
                    value={browseQuery}
                    onChange={(event) => setBrowseQuery(event.target.value)}
                    ariaLabel={t('connectors.search-connectors')}
                    placeholder={t('connectors.search-connectors')}
                    clearOnEscape
                  />
                </div>
              ) : null}
            </div>
            <TabsContent value="browse" className="mt-0">
              <ConnectorBrowserPage
                embedded
                hideSearch
                searchValue={browseQuery}
                onSearchValueChange={setBrowseQuery}
                onSelectTarget={openBrowsePage}
                connectorGatewayEnabled={connectorGatewayEnabled}
                localMode={IS_LOCAL_MODE}
                builtInItems={dialogBuiltInItems}
                builtInInstalled={builtInInstalled}
                configs={configs}
                onBack={closeConnectorSubpage}
                onInstalled={handleInstalled}
                saveBuiltInValue={saveEnvAndConfig}
                refreshBuiltIns={refreshBuiltIns}
              />
            </TabsContent>
            {(['local', 'remote'] as const).map((customType) => (
              <TabsContent key={customType} value={customType} className="mt-0">
                <Suspense
                  fallback={
                    <div
                      role="status"
                      aria-live="polite"
                      className="flex min-h-[420px] w-full flex-col gap-ds-16 py-ds-16"
                    >
                      <span className="sr-only">{t('connectors.loading')}</span>
                      <div
                        aria-hidden
                        className="h-12 animate-pulse rounded-ds-card bg-ds-neutral-subtle-default motion-reduce:animate-none"
                      />
                      <div
                        aria-hidden
                        className="h-80 animate-pulse rounded-ds-card bg-ds-neutral-subtle-default motion-reduce:animate-none"
                      />
                    </div>
                  }
                >
                  <AddCustomConnectorPage
                    embedded
                    customType={customType}
                    customMcps={customMcps}
                    onBack={closeConnectorSubpage}
                    onInstalled={handleInstalled}
                  />
                </Suspense>
              </TabsContent>
            ))}
          </Tabs>
        </div>
        {dialogs}
      </div>
    );
  }

  if (selected) {
    return (
      <>
        {renderDetailPanel(selected)}
        {dialogs}
      </>
    );
  }

  if (selectedId !== OVERVIEW_ID) {
    return (
      <div className="flex min-h-full flex-col" role="status">
        <ContentHeader className="px-ds-16" title={t('connectors.loading')} />
        <DocumentContentRail className="flex flex-col gap-ds-8 px-ds-24 py-ds-24">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              aria-hidden
              className="h-16 animate-pulse rounded-ds-card bg-ds-neutral-subtle-default motion-reduce:animate-none"
            />
          ))}
        </DocumentContentRail>
      </div>
    );
  }

  return (
    <>
      <CollectionToolbar
        title={t('connectors.title')}
        headingLevel={1}
        width="wide"
        aria-label={t('connectors.connector-toolbar')}
        count={
          <Badge variant="secondary" size="xs">
            {visibleItems.length}
          </Badge>
        }
      >
        <div className={COLLECTION_TOOLBAR_SEARCH_CLASS}>
          <SearchInput
            value={listQuery}
            onChange={(event) => setListQuery(event.target.value)}
            ariaLabel={t('connectors.search-placeholder')}
            placeholder={t('connectors.search-placeholder')}
            clearOnEscape
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger size="xs" aria-label={t('connectors.type-filter')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('connectors.all-types')}</SelectItem>
            <SelectItem value="open">{t('connectors.source-open')}</SelectItem>
            <SelectItem value="builtin">
              {t('connectors.source-built-in')}
            </SelectItem>
            <SelectItem value="local">
              {t('connectors.source-local')}
            </SelectItem>
            <SelectItem value="remote">
              {t('connectors.source-remote')}
            </SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger size="xs" aria-label={t('connectors.status-filter')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('connectors.all-statuses')}</SelectItem>
            <SelectItem value="active">{t('connectors.active')}</SelectItem>
            <SelectItem value="inactive">{t('connectors.disabled')}</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          buttonRadius="full"
          buttonContent="icon-only"
          disabled={pageLoading}
          onClick={() => void refreshAll()}
          aria-label={t('connectors.refresh')}
        >
          <RefreshCw aria-hidden />
        </Button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          buttonRadius="full"
          onClick={() => openBrowsePage()}
        >
          {t('connectors.add-connector')}
        </Button>
      </CollectionToolbar>
      <SettingsContentShell contentClassName={COLLECTION_RAIL_CLASS.wide}>
        <SettingsSectionPage className="gap-ds-16 py-ds-24">
          {pageError ? (
            <div className="flex items-center justify-between gap-ds-12 rounded-ds-card bg-ds-bg-error-subtle-default p-ds-12 text-ds-text-base text-ds-text-error-strong-default">
              <span>{pageError}</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={pageLoading}
                onClick={() => void refreshAll()}
              >
                <RefreshCw aria-hidden />
                {t('connectors.retry')}
              </Button>
            </div>
          ) : null}
          {!recommendationsDismissed ? (
            <section
              aria-label={t('connectors.recommended')}
              className="flex flex-col gap-ds-12 rounded-ds-card bg-ds-bg-information-subtle-default p-ds-12"
            >
              <div className="flex items-start gap-ds-12">
                <div className="min-w-0 flex-1">
                  <h2 className="m-0 text-ds-text-base font-semibold text-ds-text-information-strong-default">
                    {t('connectors.recommended')}
                  </h2>
                  <span className="mt-ds-4 block text-ds-text-base text-ds-text-information-strong-default">
                    {t('connectors.recommendations-description')}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  tone="information"
                  size="sm"
                  buttonContent="icon-only"
                  onClick={() => {
                    setRecommendationsDismissed(true);
                    try {
                      window.localStorage.setItem(
                        RECOMMENDATIONS_DISMISSED_KEY,
                        'true'
                      );
                    } catch {
                      // Dismissal still applies for the current session.
                    }
                  }}
                  aria-label={t('connectors.dismiss-recommendations')}
                >
                  <X aria-hidden />
                </Button>
              </div>
              {renderRecommendedConnectors()}
            </section>
          ) : null}
          {renderConnectorTable()}
          {dialogs}
        </SettingsSectionPage>
      </SettingsContentShell>
    </>
  );
}
