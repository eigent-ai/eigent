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
  connectProvider,
  createConnectorOAuthAuthorization,
  fetchConnectorProvider,
  fetchConnectorProviders,
  getCachedConnectorProviders,
  isConnectedProvider,
  providerLabel,
  type ConnectorAction,
  type ConnectorAuthDefinition,
  type ConnectorCredentialField,
  type ConnectorProvider,
} from '@/api/connectors';
import { proxyFetchGet } from '@/api/http';
import SearchInput from '@/components/Dashboard/SearchInput';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type { IntegrationItem } from '@/hooks/useIntegrationManagement';
import { AnimatePresence, motion } from 'framer-motion';
import type { TFunction } from 'i18next';
import {
  BadgeCheck,
  ChevronDown,
  ExternalLink,
  KeyRound,
  Loader2,
  PlugZap,
  Plus,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { ConnectorInstallHint } from './types';

export type { ConnectorInstallHint };

/** Large enough to fill the dialog viewport and avoid immediate load-more waterfalls. */
const MARKET_PAGE_SIZE = 60;

export type AddConnectorTarget =
  | { source: 'open'; provider: ConnectorProvider }
  | { source: 'builtin'; item: IntegrationItem }
  | null;

interface StoredConfig {
  id: number;
  config_group?: string;
  config_name?: string;
  config_value?: string;
}

interface AddConnectorDialogProps {
  open: boolean;
  connectorGatewayEnabled: boolean;
  localMode: boolean;
  builtInItems: IntegrationItem[];
  builtInInstalled: Record<string, boolean>;
  configs: StoredConfig[];
  initialTarget?: AddConnectorTarget;
  onOpenChange: (open: boolean) => void;
  onInstalled: (hint: ConnectorInstallHint) => void | Promise<void>;
  saveBuiltInValue: (
    provider: string,
    key: string,
    value: string
  ) => Promise<void>;
  refreshBuiltIns: () => Promise<unknown>;
}

export { isConnectedProvider, providerLabel };

export function providerActionCount(provider: ConnectorProvider): number {
  return typeof provider.action_count === 'number'
    ? provider.action_count
    : Array.isArray(provider.actions)
      ? provider.actions.length
      : 0;
}

export function actionLabel(action: ConnectorAction, t: TFunction): string {
  return action.name || action.id || t('connectors.unnamed-action');
}

function authLabel(authType: string, t: TFunction): string {
  if (authType === 'api_key') return t('connectors.auth-api-key');
  if (authType === 'custom_credential') return t('connectors.auth-credential');
  if (authType === 'oauth2') return t('connectors.auth-oauth');
  if (authType === 'no_auth') return t('connectors.auth-none');
  return authType;
}

function authPriority(authType: string): number {
  if (authType === 'api_key') return 0;
  if (authType === 'custom_credential') return 1;
  if (authType === 'no_auth') return 2;
  if (authType === 'oauth2') return 3;
  return 10;
}

function authDefinitions(
  provider: ConnectorProvider | null
): ConnectorAuthDefinition[] {
  if (!provider) return [];
  if (provider.auth?.length) {
    return [...provider.auth].sort(
      (left, right) => authPriority(left.type) - authPriority(right.type)
    );
  }
  return (provider.authTypes || []).map((type) => ({ type }));
}

function preferredAuthType(provider: ConnectorProvider | null): string | null {
  const definitions = authDefinitions(provider);
  if (!definitions.length) return null;
  const connectedAuth = provider?.connection?.authType;
  if (
    connectedAuth &&
    definitions.some((auth) => auth.type === connectedAuth)
  ) {
    return connectedAuth;
  }
  return definitions[0].type;
}

function credentialFieldsFor(
  auth: ConnectorAuthDefinition | undefined,
  t: TFunction
): ConnectorCredentialField[] {
  if (!auth) return [];
  if (auth.type === 'api_key') {
    return [
      {
        key: 'apiKey',
        label: auth.label || t('connectors.auth-api-key'),
        inputType: 'password',
        required: true,
        secret: true,
        placeholder: auth.placeholder,
        description: auth.description,
      },
      ...(auth.extraFields || []),
    ];
  }
  if (auth.type === 'custom_credential') return auth.fields || [];
  return [];
}

function isBuiltInConfigured(
  item: IntegrationItem,
  configs: StoredConfig[]
): boolean {
  if (item.key === 'Search') {
    const names = new Set(
      configs
        .filter((config) => String(config.config_value || '').trim())
        .map((config) => config.config_name)
    );
    return names.has('GOOGLE_API_KEY') && names.has('SEARCH_ENGINE_ID');
  }
  return configs.some(
    (config) =>
      config.config_group?.toLowerCase() === item.key.toLowerCase() &&
      String(config.config_value || '').trim().length > 0
  );
}

export function ProviderIcon({
  provider,
  size = 'sm',
}: {
  provider: ConnectorProvider | null | undefined;
  size?: 'list' | 'sm' | 'detail' | 'lg';
}) {
  const iconUrl = provider?.iconUrl || '';
  const [iconFailed, setIconFailed] = useState(false);

  useEffect(() => setIconFailed(false), [iconUrl]);

  const shellClass =
    size === 'list'
      ? 'h-5 w-5'
      : size === 'detail'
        ? 'h-7 w-7 rounded-lg border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-subtle-default'
        : size === 'lg'
          ? 'h-12 w-12 rounded-xl border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-subtle-default'
          : 'h-10 w-10 rounded-xl border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-subtle-default';
  const imageClass =
    size === 'list' || size === 'detail'
      ? 'h-5 w-5'
      : size === 'lg'
        ? 'h-7 w-7 rounded-lg'
        : 'h-6 w-6 rounded-lg';

  return (
    <div className={`flex shrink-0 items-center justify-center ${shellClass}`}>
      {iconUrl && !iconFailed ? (
        <img
          src={iconUrl}
          alt=""
          className={`${imageClass} object-contain`}
          loading="lazy"
          decoding="async"
          onError={() => setIconFailed(true)}
        />
      ) : (
        <PlugZap
          className={`${size === 'list' ? 'h-5 w-5' : 'h-4 w-4'} text-ds-icon-neutral-muted-default`}
        />
      )}
    </div>
  );
}

function CatalogCardSkeleton() {
  return (
    <div className="flex h-20 items-center gap-3 rounded-2xl bg-ds-bg-neutral-default-default px-4 py-3">
      <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-48 max-w-full" />
      </div>
      <Skeleton className="h-4 w-4 shrink-0 rounded" />
    </div>
  );
}

function CatalogLoadingGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="grid w-full grid-cols-1 gap-3 md:grid-cols-2">
      {Array.from({ length: count }).map((_, index) => (
        <CatalogCardSkeleton key={index} />
      ))}
    </div>
  );
}

function CatalogLoadingBanner({ label }: { label: string }) {
  return (
    <motion.div
      key="catalog-loading-banner"
      initial={{ opacity: 0, y: -8, height: 0 }}
      animate={{ opacity: 1, y: 0, height: 'auto' }}
      exit={{ opacity: 0, y: -12, height: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="overflow-hidden"
    >
      <div className="flex flex-col items-center justify-center gap-2 py-3 text-ds-text-neutral-muted-default">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-body-xs">{label}</span>
      </div>
    </motion.div>
  );
}

export default function AddConnectorDialog({
  open,
  connectorGatewayEnabled,
  localMode,
  builtInItems,
  builtInInstalled,
  configs,
  initialTarget = null,
  onOpenChange,
  onInstalled,
  saveBuiltInValue,
  refreshBuiltIns,
}: AddConnectorDialogProps) {
  const { t } = useTranslation();
  const [browseSource, setBrowseSource] = useState<'open' | 'builtin'>(
    connectorGatewayEnabled || !localMode ? 'open' : 'builtin'
  );
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [catalog, setCatalog] = useState<ConnectorProvider[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] =
    useState<ConnectorProvider | null>(null);
  const [selectedBuiltIn, setSelectedBuiltIn] =
    useState<IntegrationItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedAuthType, setSelectedAuthType] = useState<string | null>(null);
  const [credentialValues, setCredentialValues] = useState<
    Record<string, string>
  >({});
  const [builtInValues, setBuiltInValues] = useState<Record<string, string>>(
    {}
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [authorizationPending, setAuthorizationPending] = useState(false);
  const [actionsExpanded, setActionsExpanded] = useState(false);
  const [actionsOverflow, setActionsOverflow] = useState(false);
  const browseScrollRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const actionsListRef = useRef<HTMLDivElement | null>(null);
  const savedScrollTopRef = useRef(0);
  const catalogRequestIdRef = useRef(0);
  const oauthPollRef = useRef<number | null>(null);
  const oauthTimeoutRef = useRef<number | null>(null);
  // Poll responses can still be in flight after the interval is cleared, so
  // guard against finishing the install more than once.
  const oauthFinishedRef = useRef(false);

  const stopOAuthPolling = useCallback(() => {
    if (oauthPollRef.current !== null) {
      window.clearInterval(oauthPollRef.current);
      oauthPollRef.current = null;
    }
    if (oauthTimeoutRef.current !== null) {
      window.clearTimeout(oauthTimeoutRef.current);
      oauthTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => stopOAuthPolling, [stopOAuthPolling]);

  useEffect(() => {
    if (!open) return;
    // Built-in is only available in local mode. Hosted / non-local always uses
    // Connector Gateway providers.
    const allowBuiltin = localMode;
    const targetSource =
      allowBuiltin && initialTarget?.source === 'builtin'
        ? 'builtin'
        : connectorGatewayEnabled || !localMode
          ? 'open'
          : 'builtin';
    setBrowseSource(targetSource);
    setSelectedProvider(
      initialTarget?.source === 'open' ? initialTarget.provider : null
    );
    setSelectedBuiltIn(
      allowBuiltin && initialTarget?.source === 'builtin'
        ? initialTarget.item
        : null
    );
    setSelectedAuthType(
      initialTarget?.source === 'open'
        ? preferredAuthType(initialTarget.provider)
        : null
    );
    setCredentialValues({});
    setFormError(null);
    setAuthorizationPending(false);
    setActionsExpanded(false);
  }, [connectorGatewayEnabled, initialTarget, localMode, open]);

  useEffect(() => {
    setActionsExpanded(false);
  }, [selectedProvider?.service]);

  useLayoutEffect(() => {
    const element = actionsListRef.current;
    if (!element || !selectedProvider?.actions?.length) {
      setActionsOverflow(false);
      return;
    }
    setActionsOverflow(element.scrollHeight > 200);
  }, [selectedProvider?.actions, selectedProvider?.service, detailLoading]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const applyCatalogPage = useCallback(
    (
      response: Awaited<ReturnType<typeof fetchConnectorProviders>>,
      pageToLoad: number,
      append: boolean
    ) => {
      setCatalog((current) => {
        if (!append) return response.providers;
        const seen = new Set(current.map((provider) => provider.service));
        return [
          ...current,
          ...response.providers.filter(
            (provider) => !seen.has(provider.service)
          ),
        ];
      });
      setHasMore(pageToLoad < response.total_pages);
      setPage(pageToLoad);
      setCatalogError(null);
    },
    []
  );

  const loadCatalogPage = useCallback(
    async (
      pageToLoad: number,
      append: boolean,
      options: { soft?: boolean; bypassCache?: boolean } = {}
    ) => {
      if (!open || !connectorGatewayEnabled || browseSource !== 'open') return;
      const requestId = ++catalogRequestIdRef.current;
      const soft = options.soft === true;
      if (append) {
        setLoadingMore(true);
      } else if (soft) {
        setCatalogRefreshing(true);
      } else {
        setCatalogLoading(true);
        setCatalogError(null);
      }
      try {
        const response = await fetchConnectorProviders(
          {
            page: pageToLoad,
            pageSize: MARKET_PAGE_SIZE,
            query: debouncedQuery,
          },
          { bypassCache: options.bypassCache === true || soft }
        );
        if (requestId !== catalogRequestIdRef.current) return;
        applyCatalogPage(response, pageToLoad, append);
      } catch (error: any) {
        if (requestId !== catalogRequestIdRef.current) return;
        if (!append && !soft) {
          setCatalog([]);
          setHasMore(false);
          setCatalogError(
            error?.message || t('connectors.load-gateway-failed')
          );
        }
      } finally {
        if (requestId === catalogRequestIdRef.current) {
          setCatalogLoading(false);
          setCatalogRefreshing(false);
          setLoadingMore(false);
        }
      }
    },
    [
      applyCatalogPage,
      browseSource,
      connectorGatewayEnabled,
      debouncedQuery,
      open,
      t,
    ]
  );

  const loadNextCatalogPage = useCallback(() => {
    if (
      browseSource !== 'open' ||
      selectedProvider ||
      selectedBuiltIn ||
      !hasMore ||
      catalogLoading ||
      loadingMore ||
      catalogError ||
      catalog.length === 0
    ) {
      return;
    }
    void loadCatalogPage(page + 1, true);
  }, [
    browseSource,
    catalog.length,
    catalogError,
    catalogLoading,
    hasMore,
    loadCatalogPage,
    loadingMore,
    page,
    selectedBuiltIn,
    selectedProvider,
  ]);

  const handleBrowseScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (browseSource !== 'open') return;
      const element = event.currentTarget;
      const distanceToBottom =
        element.scrollHeight - element.scrollTop - element.clientHeight;
      if (distanceToBottom <= 280) {
        loadNextCatalogPage();
      }
    },
    [browseSource, loadNextCatalogPage]
  );

  // Hydrate from cache before paint to avoid empty-state / skeleton flash on open.
  useLayoutEffect(() => {
    if (!open || !connectorGatewayEnabled || browseSource !== 'open') return;
    const cached = getCachedConnectorProviders({
      page: 1,
      pageSize: MARKET_PAGE_SIZE,
      query: debouncedQuery,
    });
    if (cached) {
      applyCatalogPage(cached, 1, false);
      setCatalogLoading(false);
      return;
    }
    setCatalog([]);
    setHasMore(true);
    setPage(1);
    setCatalogError(null);
    setCatalogLoading(true);
  }, [
    applyCatalogPage,
    browseSource,
    connectorGatewayEnabled,
    debouncedQuery,
    open,
  ]);

  useEffect(() => {
    if (!open || !connectorGatewayEnabled || browseSource !== 'open') return;
    const cached = getCachedConnectorProviders({
      page: 1,
      pageSize: MARKET_PAGE_SIZE,
      query: debouncedQuery,
    });
    if (cached) {
      void loadCatalogPage(1, false, { soft: true });
      return;
    }
    void loadCatalogPage(1, false);
  }, [
    browseSource,
    connectorGatewayEnabled,
    debouncedQuery,
    loadCatalogPage,
    open,
  ]);

  useEffect(() => {
    if (browseSource !== 'open') return;
    const root = browseScrollRef.current;
    const sentinel = loadMoreSentinelRef.current;
    if (!root || !sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        loadNextCatalogPage();
      },
      { root, rootMargin: '160px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [browseSource, loadNextCatalogPage]);

  const selectedProviderService = selectedProvider?.service;

  useEffect(() => {
    if (!selectedProviderService) return;
    let cancelled = false;
    setDetailLoading(true);
    void fetchConnectorProvider(selectedProviderService)
      .then((response) => {
        if (cancelled) return;
        setSelectedProvider(response.provider);
        setSelectedAuthType(preferredAuthType(response.provider));
      })
      .catch((error: any) => {
        if (!cancelled) {
          setFormError(error?.message || t('connectors.detail-load-failed'));
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProviderService, t]);

  useEffect(() => {
    if (!selectedBuiltIn) {
      setBuiltInValues({});
      return;
    }
    const next: Record<string, string> = {};
    selectedBuiltIn.env_vars.forEach((key) => {
      const match = configs.find((config) => config.config_name === key);
      next[key] = String(match?.config_value || '');
    });
    setBuiltInValues(next);
  }, [configs, selectedBuiltIn]);

  const selectedAuth = useMemo(
    () =>
      authDefinitions(selectedProvider).find(
        (auth) => auth.type === selectedAuthType
      ),
    [selectedAuthType, selectedProvider]
  );
  const credentialFields = useMemo(
    () => credentialFieldsFor(selectedAuth, t),
    [selectedAuth, t]
  );
  const canInstallProvider =
    Boolean(selectedProvider && selectedAuth) &&
    (selectedAuth?.type === 'oauth2' ||
      selectedAuth?.type === 'no_auth' ||
      credentialFields.every(
        (field) => !field.required || credentialValues[field.key]?.trim()
      ));

  const filteredBuiltIns = useMemo(() => {
    const normalized = debouncedQuery.toLowerCase();
    if (!normalized) return builtInItems;
    return builtInItems.filter((item) => {
      const description =
        typeof item.desc === 'string' ? item.desc.toLowerCase() : '';
      return (
        item.name.toLowerCase().includes(normalized) ||
        item.key.toLowerCase().includes(normalized) ||
        description.includes(normalized)
      );
    });
  }, [builtInItems, debouncedQuery]);

  const closeDialog = useCallback(() => {
    stopOAuthPolling();
    onOpenChange(false);
  }, [onOpenChange, stopOAuthPolling]);

  const finishInstall = useCallback(
    async (hint: ConnectorInstallHint) => {
      stopOAuthPolling();
      await onInstalled(hint);
      closeDialog();
    },
    [closeDialog, onInstalled, stopOAuthPolling]
  );

  const startOAuthPolling = useCallback(
    (service: string) => {
      stopOAuthPolling();
      oauthFinishedRef.current = false;
      setAuthorizationPending(true);
      oauthPollRef.current = window.setInterval(() => {
        void fetchConnectorProvider(service)
          .then((response) => {
            if (oauthFinishedRef.current) return;
            setSelectedProvider(response.provider);
            if (isConnectedProvider(response.provider)) {
              oauthFinishedRef.current = true;
              toast.success(
                t('connectors.installed-toast', {
                  name: providerLabel(response.provider),
                })
              );
              void finishInstall({ source: 'open', key: service });
            }
          })
          .catch(() => undefined);
      }, 1500);
      oauthTimeoutRef.current = window.setTimeout(
        () => {
          stopOAuthPolling();
          setAuthorizationPending(false);
          setFormError(t('connectors.authorization-pending'));
        },
        5 * 60 * 1000
      );
    },
    [finishInstall, stopOAuthPolling, t]
  );

  const installOpenProvider = useCallback(async () => {
    if (!selectedProvider || !selectedAuth) return;
    setSaving(true);
    setFormError(null);
    try {
      if (selectedAuth.type === 'oauth2') {
        const authorization = await createConnectorOAuthAuthorization(
          selectedProvider.service,
          selectedProvider.connection?.connectionName
        );
        if (!authorization.authorizationUrl) {
          throw new Error(t('connectors.no-authorization-url'));
        }
        window.open(
          authorization.authorizationUrl,
          'eigent_connector_oauth',
          'popup=yes,width=720,height=760,menubar=no,toolbar=no,location=yes,status=no'
        );
        startOAuthPolling(selectedProvider.service);
        toast.success(t('connectors.authorization-started'));
        return;
      }

      await connectProvider(selectedProvider.service, {
        auth_type: selectedAuth.type,
        values:
          selectedAuth.type === 'no_auth'
            ? {}
            : credentialFields.reduce<Record<string, string>>((acc, field) => {
                acc[field.key] = credentialValues[field.key] || '';
                return acc;
              }, {}),
      });
      toast.success(
        t('connectors.installed-toast', {
          name: providerLabel(selectedProvider),
        })
      );
      await finishInstall({
        source: 'open',
        key: selectedProvider.service,
      });
    } catch (error: any) {
      setFormError(error?.message || t('connectors.install-failed'));
    } finally {
      setSaving(false);
    }
  }, [
    credentialFields,
    credentialValues,
    finishInstall,
    selectedAuth,
    selectedProvider,
    startOAuthPolling,
    t,
  ]);

  const verifyBuiltInAuthorization = useCallback(async () => {
    if (!selectedBuiltIn) return;
    setSaving(true);
    setFormError(null);
    try {
      const response = await proxyFetchGet('/api/v1/configs');
      const nextConfigs = Array.isArray(response) ? response : [];
      await refreshBuiltIns();
      if (!isBuiltInConfigured(selectedBuiltIn, nextConfigs)) {
        throw new Error(t('connectors.authorization-incomplete'));
      }
      await finishInstall({ source: 'builtin', key: selectedBuiltIn.key });
    } catch (error: any) {
      setFormError(error?.message || t('connectors.refresh-status-failed'));
    } finally {
      setSaving(false);
    }
  }, [finishInstall, refreshBuiltIns, selectedBuiltIn, t]);

  const installBuiltIn = useCallback(async () => {
    if (!selectedBuiltIn) return;
    setSaving(true);
    setFormError(null);
    try {
      if (selectedBuiltIn.env_vars.length > 0) {
        for (const key of selectedBuiltIn.env_vars) {
          const value = builtInValues[key]?.trim();
          if (!value) {
            throw new Error(t('connectors.field-required', { field: key }));
          }
          await saveBuiltInValue(selectedBuiltIn.key, key, value);
        }
      }

      if (
        selectedBuiltIn.key === 'Google Calendar' ||
        selectedBuiltIn.env_vars.length === 0
      ) {
        await selectedBuiltIn.onInstall();
      }

      await refreshBuiltIns();
      if (
        selectedBuiltIn.key === 'Google Calendar' ||
        (selectedBuiltIn.env_vars.length === 0 &&
          selectedBuiltIn.key !== 'Notion')
      ) {
        setAuthorizationPending(true);
        toast.success(t('connectors.authorization-started'));
        return;
      }

      toast.success(
        t('connectors.installed-toast', { name: selectedBuiltIn.name })
      );
      await finishInstall({ source: 'builtin', key: selectedBuiltIn.key });
    } catch (error: any) {
      setFormError(error?.message || t('connectors.install-failed'));
    } finally {
      setSaving(false);
    }
  }, [
    builtInValues,
    finishInstall,
    refreshBuiltIns,
    saveBuiltInValue,
    selectedBuiltIn,
    t,
  ]);

  const openProvider = (provider: ConnectorProvider) => {
    savedScrollTopRef.current = browseScrollRef.current?.scrollTop || 0;
    setSelectedProvider(provider);
    setSelectedAuthType(preferredAuthType(provider));
    setCredentialValues({});
    setFormError(null);
  };

  const goBackToBrowse = () => {
    stopOAuthPolling();
    setSelectedProvider(null);
    setSelectedBuiltIn(null);
    setSelectedAuthType(null);
    setCredentialValues({});
    setBuiltInValues({});
    setFormError(null);
    setAuthorizationPending(false);
    window.setTimeout(() => {
      if (browseScrollRef.current) {
        browseScrollRef.current.scrollTop = savedScrollTopRef.current;
      }
    }, 0);
  };

  const showingDetail = Boolean(selectedProvider || selectedBuiltIn);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeDialog();
      }}
    >
      <DialogContent
        size="lg"
        showCloseButton
        onClose={closeDialog}
        overlayVariant="dimmed"
        className="h-[min(760px,90vh)] !max-w-[960px]"
      >
        <DialogHeader
          title={
            selectedProvider
              ? providerLabel(selectedProvider)
              : selectedBuiltIn
                ? selectedBuiltIn.name
                : t('connectors.browse')
          }
          showBackButton={showingDetail}
          onBackClick={goBackToBrowse}
          className="pr-12"
        />

        {!showingDetail ? (
          <DialogContentSection className="flex min-h-0 flex-col overflow-hidden p-0">
            <div className="px-4 py-3">
              <SearchInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('connectors.search-connectors')}
              />
            </div>

            {localMode ? (
              <div className="flex items-center gap-2 px-4 pt-3">
                {connectorGatewayEnabled ? (
                  <Button
                    type="button"
                    variant={browseSource === 'open' ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setBrowseSource('open')}
                  >
                    <PlugZap className="h-4 w-4" />
                    {t('connectors.gateway-connectors')}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant={browseSource === 'builtin' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setBrowseSource('builtin')}
                >
                  <Server className="h-4 w-4" />
                  {t('connectors.source-built-in')}
                </Button>
              </div>
            ) : null}

            <div
              ref={browseScrollRef}
              onScroll={handleBrowseScroll}
              className="scrollbar-always-visible min-h-0 flex-1 overflow-y-auto py-4 pl-4 pr-2"
            >
              {browseSource === 'open' ? (
                !connectorGatewayEnabled ? (
                  <div className="flex min-h-48 flex-col items-center justify-center gap-1 px-6 text-center">
                    <span className="text-body-sm font-bold text-ds-text-neutral-default-default">
                      {t('connectors.gateway-unavailable')}
                    </span>
                    <span className="text-body-sm text-ds-text-neutral-muted-default">
                      {t('connectors.gateway-unavailable-desc')}
                    </span>
                  </div>
                ) : catalogError && catalog.length === 0 && !catalogLoading ? (
                  <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
                    <span className="block text-body-sm text-ds-text-error-default-default">
                      {catalogError}
                    </span>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        void loadCatalogPage(1, false, { bypassCache: true })
                      }
                    >
                      <RefreshCw className="h-4 w-4" />
                      {t('connectors.try-again')}
                    </Button>
                  </div>
                ) : !catalogLoading &&
                  !catalogRefreshing &&
                  catalog.length === 0 ? (
                  <div className="flex min-h-48 items-center justify-center text-body-sm text-ds-text-neutral-muted-default">
                    {t('connectors.no-gateway-found')}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <AnimatePresence initial={false}>
                      {catalogLoading || catalogRefreshing ? (
                        <CatalogLoadingBanner
                          label={
                            catalogRefreshing
                              ? t('connectors.updating')
                              : t('connectors.loading')
                          }
                        />
                      ) : null}
                    </AnimatePresence>
                    {catalogLoading && catalog.length === 0 ? (
                      <CatalogLoadingGrid />
                    ) : (
                      <>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          {catalog.map((provider) => {
                            const installed = isConnectedProvider(provider);
                            return (
                              <button
                                key={provider.service}
                                type="button"
                                onClick={() => openProvider(provider)}
                                className="group flex h-20 items-center gap-3 rounded-2xl border border-solid border-transparent bg-ds-bg-neutral-default-default px-4 py-3 text-left transition-colors hover:border-ds-border-neutral-default-default hover:bg-ds-bg-neutral-default-hover"
                              >
                                <ProviderIcon provider={provider} />
                                <div className="min-w-0 flex-1">
                                  <div className="flex min-w-0 items-center gap-1.5">
                                    <span className="text-body-base truncate font-bold text-ds-text-neutral-default-default">
                                      {providerLabel(provider)}
                                    </span>
                                    <BadgeCheck
                                      className={`h-3.5 w-3.5 shrink-0 ${
                                        installed
                                          ? 'text-ds-icon-success-default-default'
                                          : 'text-ds-icon-neutral-muted-default'
                                      }`}
                                    />
                                    {provider.recommended ? (
                                      <span className="shrink-0 text-label-xs font-bold text-ds-text-warning-strong-default">
                                        {t('connectors.new')}
                                      </span>
                                    ) : null}
                                  </div>
                                  {provider.description?.trim() ? (
                                    <span className="mt-1 line-clamp-1 block text-body-xs text-ds-text-neutral-muted-default">
                                      {provider.description.trim()}
                                    </span>
                                  ) : null}
                                </div>
                                {installed ? (
                                  <Settings className="h-4 w-4 shrink-0 text-ds-icon-neutral-muted-default" />
                                ) : (
                                  <Plus className="h-4 w-4 shrink-0 text-ds-icon-neutral-muted-default" />
                                )}
                              </button>
                            );
                          })}
                        </div>
                        {hasMore ? (
                          <div
                            ref={loadMoreSentinelRef}
                            className="flex w-full flex-col gap-3 py-4"
                          >
                            {loadingMore ? (
                              <>
                                <div className="flex flex-col items-center gap-2 text-body-xs text-ds-text-neutral-muted-default">
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  {t('connectors.loading-more')}
                                </div>
                                <CatalogLoadingGrid count={2} />
                              </>
                            ) : (
                              <div className="h-4 w-full" aria-hidden />
                            )}
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                )
              ) : filteredBuiltIns.length === 0 ? (
                <div className="flex min-h-48 items-center justify-center text-body-sm text-ds-text-neutral-muted-default">
                  {t('connectors.no-built-in-found')}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {filteredBuiltIns.map((item) => {
                    const installed = Boolean(builtInInstalled[item.key]);
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          savedScrollTopRef.current =
                            browseScrollRef.current?.scrollTop || 0;
                          setSelectedBuiltIn(item);
                          setFormError(null);
                        }}
                        className="group flex h-20 items-center gap-3 rounded-2xl border border-solid border-transparent bg-ds-bg-neutral-default-default px-4 py-3 text-left transition-colors hover:border-ds-border-neutral-default-default hover:bg-ds-bg-neutral-subtle-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-ring-brand-default-focus"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-subtle-default">
                          <Server className="h-5 w-5 text-ds-icon-neutral-muted-default" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className="truncate text-body-sm font-bold text-ds-text-neutral-default-default">
                              {item.name}
                            </span>
                            <Badge size="xs" variant="outline">
                              {t('connectors.source-built-in')}
                            </Badge>
                          </div>
                          <span className="mt-1 line-clamp-1 block text-body-xs text-ds-text-neutral-muted-default">
                            {typeof item.desc === 'string'
                              ? item.desc
                              : t('connectors.local-integration')}
                          </span>
                        </div>
                        {installed ? (
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
          </DialogContentSection>
        ) : selectedProvider ? (
          <>
            <DialogContentSection className="scrollbar-always-visible overflow-y-auto p-6">
              {detailLoading ? (
                <div className="space-y-3">
                  <div className="h-24 animate-pulse rounded-xl bg-ds-bg-neutral-strong-default" />
                  <div className="h-44 animate-pulse rounded-xl bg-ds-bg-neutral-strong-default" />
                </div>
              ) : (
                <div className="mx-auto flex max-w-3xl flex-col gap-5">
                  <div className="flex items-center gap-3">
                    <ProviderIcon provider={selectedProvider} size="lg" />
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-heading-xs truncate font-bold text-ds-text-neutral-default-default">
                        {providerLabel(selectedProvider)}
                      </span>
                      <span className="shrink-0 text-body-sm text-ds-text-neutral-muted-default">
                        {t('connectors.supported-actions-count', {
                          num: providerActionCount(selectedProvider),
                        })}
                      </span>
                    </div>
                    {selectedProvider.homepageUrl ? (
                      <a
                        href={selectedProvider.homepageUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 text-label-sm text-ds-text-neutral-muted-default underline-offset-2 hover:underline"
                      >
                        {t('connectors.provider-website')}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </div>

                  {selectedProvider.actions?.length ? (
                    <div className="overflow-hidden rounded-xl border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default">
                      <div className="relative">
                        <div
                          ref={actionsListRef}
                          className={`flex flex-wrap gap-2 p-4 ${
                            actionsExpanded
                              ? ''
                              : 'max-h-[200px] overflow-hidden'
                          }`}
                        >
                          {selectedProvider.actions.map((action, index) => (
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
                  ) : null}

                  {authDefinitions(selectedProvider).length > 1 ? (
                    <div className="space-y-2">
                      <div className="text-body-sm font-bold text-ds-text-neutral-default-default">
                        {t('connectors.authentication')}
                      </div>
                      <Tabs
                        value={selectedAuthType || undefined}
                        onValueChange={(value) => {
                          setSelectedAuthType(value);
                          setCredentialValues({});
                          setFormError(null);
                        }}
                      >
                        <TabsList appearance="default">
                          {authDefinitions(selectedProvider).map((auth) => (
                            <TabsTrigger
                              key={auth.type}
                              value={auth.type}
                              className="!text-label-sm"
                            >
                              {authLabel(auth.type, t)}
                            </TabsTrigger>
                          ))}
                        </TabsList>
                      </Tabs>
                    </div>
                  ) : null}

                  {selectedAuth?.type === 'oauth2' ? (
                    <div className="rounded-xl border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default p-4 text-body-sm text-ds-text-neutral-muted-default">
                      <div className="mb-2 font-bold text-ds-text-neutral-default-default">
                        {t('connectors.oauth-title')}
                      </div>
                      {t('connectors.oauth-desc')}
                      {selectedAuth.scopes?.length ? (
                        <span className="mt-3 block text-body-xs">
                          {t('connectors.oauth-scopes', {
                            scopes: selectedAuth.scopes.join(', '),
                          })}
                        </span>
                      ) : null}
                    </div>
                  ) : selectedAuth?.type === 'no_auth' ? (
                    <div className="flex items-start gap-3 rounded-xl border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default p-4 text-body-sm text-ds-text-neutral-muted-default">
                      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                      {t('connectors.no-auth-desc')}
                    </div>
                  ) : credentialFields.length ? (
                    <div className="space-y-3">
                      {credentialFields.map((field) =>
                        field.inputType === 'textarea' ||
                        field.inputType === 'json' ? (
                          <Textarea
                            key={field.key}
                            variant="enhanced"
                            title={field.label}
                            required={field.required}
                            placeholder={field.placeholder || undefined}
                            note={field.description || undefined}
                            value={credentialValues[field.key] || ''}
                            onChange={(event) =>
                              setCredentialValues((current) => ({
                                ...current,
                                [field.key]: event.target.value,
                              }))
                            }
                          />
                        ) : (
                          <Input
                            key={field.key}
                            title={field.label}
                            required={field.required}
                            type={field.secret ? 'password' : 'text'}
                            placeholder={field.placeholder || undefined}
                            note={field.description || undefined}
                            leadingIcon={<KeyRound className="h-4 w-4" />}
                            value={credentialValues[field.key] || ''}
                            onChange={(event) =>
                              setCredentialValues((current) => ({
                                ...current,
                                [field.key]: event.target.value,
                              }))
                            }
                          />
                        )
                      )}
                    </div>
                  ) : null}

                  {authorizationPending ? (
                    <div className="flex items-center gap-2 rounded-xl bg-ds-bg-information-subtle-default p-3 text-body-sm text-ds-text-information-strong-default">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('connectors.waiting-authorization')}
                    </div>
                  ) : null}
                  {formError ? (
                    <div className="rounded-xl bg-ds-bg-error-subtle-default p-3 text-body-sm text-ds-text-error-strong-default">
                      {formError}
                    </div>
                  ) : null}
                </div>
              )}
            </DialogContentSection>
            <DialogFooter
              showCancelButton
              cancelButtonText={t('connectors.cancel')}
              cancelButtonVariant="ghost"
              onCancel={closeDialog}
              showConfirmButton
              confirmButtonText={
                saving
                  ? t('connectors.installing')
                  : isConnectedProvider(selectedProvider)
                    ? t('connectors.save')
                    : t('connectors.install')
              }
              onConfirm={() => void installOpenProvider()}
              confirmButtonDisabled={
                !canInstallProvider || saving || authorizationPending
              }
            />
          </>
        ) : selectedBuiltIn ? (
          <>
            <DialogContentSection className="scrollbar-always-visible overflow-y-auto p-6">
              <div className="mx-auto flex max-w-2xl flex-col gap-5">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default">
                    <Server className="h-6 w-6 text-ds-icon-neutral-muted-default" />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-heading-xs text-ds-text-neutral-default-default">
                        {selectedBuiltIn.name}
                      </span>
                      <Badge size="sm" variant="outline">
                        {t('connectors.source-built-in')}
                      </Badge>
                      {builtInInstalled[selectedBuiltIn.key] ? (
                        <Badge size="sm" variant="secondary" tone="success">
                          {t('connectors.installed')}
                        </Badge>
                      ) : null}
                    </div>
                    <span className="mt-2 block text-body-sm text-ds-text-neutral-muted-default">
                      {typeof selectedBuiltIn.desc === 'string'
                        ? selectedBuiltIn.desc
                        : t('connectors.built-in-generic-desc')}
                    </span>
                  </div>
                </div>

                {selectedBuiltIn.env_vars.length ? (
                  <div className="space-y-3">
                    {selectedBuiltIn.env_vars.map((key) => (
                      <Input
                        key={key}
                        title={key}
                        required
                        type="password"
                        leadingIcon={<KeyRound className="h-4 w-4" />}
                        value={builtInValues[key] || ''}
                        onChange={(event) =>
                          setBuiltInValues((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                        placeholder={t('connectors.enter-value', {
                          field: key,
                        })}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default p-4 text-body-sm text-ds-text-neutral-muted-default">
                    {t('connectors.built-in-auth-desc')}
                  </div>
                )}

                {authorizationPending ? (
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-ds-bg-information-subtle-default p-3 text-body-sm text-ds-text-information-strong-default">
                    <span>{t('connectors.complete-authorization')}</span>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={saving}
                      onClick={() => void verifyBuiltInAuthorization()}
                    >
                      <RefreshCw className="h-4 w-4" />
                      {t('connectors.refresh-status')}
                    </Button>
                  </div>
                ) : null}
                {formError ? (
                  <div className="rounded-xl bg-ds-bg-error-subtle-default p-3 text-body-sm text-ds-text-error-strong-default">
                    {formError}
                  </div>
                ) : null}
              </div>
            </DialogContentSection>
            <DialogFooter
              showCancelButton
              cancelButtonText={t('connectors.cancel')}
              cancelButtonVariant="ghost"
              onCancel={closeDialog}
              showConfirmButton
              confirmButtonText={
                saving ? t('connectors.installing') : t('connectors.install')
              }
              onConfirm={() => void installBuiltIn()}
              confirmButtonDisabled={saving || authorizationPending}
            />
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
