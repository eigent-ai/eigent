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
  disconnectProvider,
  fetchConnectorProvider,
  fetchConnectorProviders,
  type ConnectorAction,
  type ConnectorAuthDefinition,
  type ConnectorCredentialField,
  type ConnectorProvider,
} from '@/api/connectors';
import SearchInput from '@/components/Dashboard/SearchInput';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useServerCapabilityStore } from '@/store/serverCapabilityStore';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  KeyRound,
  ListChecks,
  Loader2,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

const CONNECTOR_PAGE_SIZE = 24;

function providerLabel(provider: ConnectorProvider): string {
  return provider.displayName || provider.service;
}

function providerActionCount(provider: ConnectorProvider): number {
  return typeof provider.action_count === 'number'
    ? provider.action_count
    : Array.isArray(provider.actions)
      ? provider.actions.length
      : 0;
}

function providerActionCountOrZero(
  provider: ConnectorProvider | null | undefined
): number {
  return provider ? providerActionCount(provider) : 0;
}

function actionLabel(action: ConnectorAction): string {
  return action.name || action.id || 'Unnamed action';
}

function isConnected(provider: ConnectorProvider | null | undefined): boolean {
  const connection = provider?.connection;
  return (
    connection?.configured === true &&
    connection.virtual !== true &&
    connection.authType !== 'no_auth'
  );
}

function authLabel(authType: string): string {
  if (authType === 'api_key') return 'API key';
  if (authType === 'custom_credential') return 'Credential';
  if (authType === 'oauth2') return 'OAuth';
  if (authType === 'no_auth') return 'No auth';
  return authType;
}

function authPriority(authType: string): number {
  if (authType === 'api_key') return 0;
  if (authType === 'custom_credential') return 1;
  if (authType === 'no_auth') return 2;
  if (authType === 'oauth2') return 3;
  return 10;
}

function credentialFieldsFor(
  auth: ConnectorAuthDefinition | undefined
): ConnectorCredentialField[] {
  if (!auth) return [];
  if (auth.type === 'api_key') {
    return [
      {
        key: 'apiKey',
        label: auth.label || 'API key',
        inputType: 'password',
        required: true,
        secret: true,
        placeholder: auth.placeholder,
        description: auth.description,
      },
      ...(auth.extraFields || []),
    ];
  }
  if (auth.type === 'custom_credential') {
    return auth.fields || [];
  }
  return [];
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

function updateProviderInList(
  providers: ConnectorProvider[],
  updated: ConnectorProvider
): ConnectorProvider[] {
  return providers.map((provider) =>
    provider.service === updated.service
      ? { ...provider, ...updated }
      : provider
  );
}

function ProviderIcon({
  provider,
  size = 'sm',
}: {
  provider: ConnectorProvider | null | undefined;
  size?: 'sm' | 'lg';
}) {
  const iconUrl = provider?.iconUrl || '';
  const [iconFailed, setIconFailed] = useState(false);

  useEffect(() => {
    setIconFailed(false);
  }, [iconUrl]);

  const shellClass =
    size === 'lg' ? 'h-12 w-12 rounded-xl' : 'h-11 w-11 rounded-xl';
  const imageClass = size === 'lg' ? 'h-7 w-7' : 'h-7 w-7';
  const fallbackClass = size === 'lg' ? 'h-6 w-6' : 'h-5 w-5';

  return (
    <div
      className={`flex shrink-0 items-center justify-center border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default ${shellClass}`}
    >
      {iconUrl && !iconFailed ? (
        <img
          src={iconUrl}
          alt=""
          className={`${imageClass} object-contain`}
          onError={() => setIconFailed(true)}
        />
      ) : (
        <PlugZap
          className={`${fallbackClass} text-ds-icon-neutral-muted-default`}
        />
      )}
    </div>
  );
}

export default function ConnectorGateway() {
  const { t } = useTranslation();
  const capabilities = useServerCapabilityStore((state) => state.capabilities);
  const capabilityStatus = useServerCapabilityStore((state) => state.status);
  const fetchCapabilities = useServerCapabilityStore(
    (state) => state.fetchCapabilities
  );
  const [providers, setProviders] = useState<ConnectorProvider[]>([]);
  const [providerCount, setProviderCount] = useState(0);
  const [filteredCount, setFilteredCount] = useState(0);
  const [connectedCount, setConnectedCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(CONNECTOR_PAGE_SIZE);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedProvider, setSelectedProvider] =
    useState<ConnectorProvider | null>(null);
  const [selectedDetail, setSelectedDetail] =
    useState<ConnectorProvider | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [selectedAuthType, setSelectedAuthType] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const connectorGatewayEnabled =
    capabilities.features.connector_gateway.enabled === true;

  useEffect(() => {
    void fetchCapabilities();
  }, [fetchCapabilities]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const refreshProviders = useCallback(
    async (targetPage: number = page) => {
      if (!connectorGatewayEnabled) return;
      setLoadingProviders(true);
      setProviderError(null);
      try {
        const response = await fetchConnectorProviders({
          page: targetPage,
          pageSize,
          query: debouncedQuery,
        });
        setProviders(response.providers);
        setProviderCount(response.provider_count);
        setFilteredCount(response.filtered_count);
        setConnectedCount(response.connected_count);
        setPageSize(response.page_size);
        setTotalPages(response.total_pages);
        if (response.page !== targetPage) {
          setPage(response.page);
        }
      } catch (error: any) {
        setProviderError(
          error?.message ||
            t('setting.connector-gateway-load-failed', {
              defaultValue: 'Failed to load Connector Gateway providers',
            })
        );
        setProviders([]);
        setProviderCount(0);
        setFilteredCount(0);
        setConnectedCount(0);
        setTotalPages(1);
      } finally {
        setLoadingProviders(false);
      }
    },
    [connectorGatewayEnabled, debouncedQuery, page, pageSize, t]
  );

  useEffect(() => {
    if (connectorGatewayEnabled) {
      void refreshProviders(page);
    }
  }, [connectorGatewayEnabled, debouncedQuery, page, refreshProviders]);

  const selected = selectedDetail || selectedProvider;
  const selectedAuth = useMemo(
    () =>
      authDefinitions(selected).find((auth) => auth.type === selectedAuthType),
    [selected, selectedAuthType]
  );
  const selectedFields = useMemo(
    () => credentialFieldsFor(selectedAuth),
    [selectedAuth]
  );
  const selectedConnected = isConnected(selected);
  const authOptions = authDefinitions(selected);
  const selectedActions = selected?.actions || [];
  const canSave =
    Boolean(selected && selectedAuth) &&
    (selectedAuth?.type === 'oauth2' ||
      selectedAuth?.type === 'no_auth' ||
      selectedFields.every((field) => !field.required || values[field.key]));
  const pageStart = filteredCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const pageEnd = Math.min(page * pageSize, filteredCount);
  const showPagination = filteredCount > pageSize;
  const canGoPrevious = page > 1 && !loadingProviders;
  const canGoNext = page < totalPages && !loadingProviders;
  const initialProvidersLoading =
    (capabilityStatus === 'loading' || loadingProviders) &&
    providers.length === 0;
  const listRefreshing = loadingProviders && providers.length > 0;
  const pagedGridMinHeightClass = showPagination
    ? 'min-h-[1872px] md:min-h-[936px] xl:min-h-[624px]'
    : '';
  const skeletonItems = Array.from({ length: pageSize || CONNECTOR_PAGE_SIZE });

  const openProvider = useCallback((provider: ConnectorProvider) => {
    setSelectedProvider(provider);
    setSelectedDetail(null);
    setSelectedAuthType(preferredAuthType(provider));
    setValues({});
    setFormError(null);
  }, []);

  const closeProvider = useCallback(() => {
    setSelectedProvider(null);
    setSelectedDetail(null);
    setSelectedAuthType(null);
    setValues({});
    setFormError(null);
  }, []);

  useEffect(() => {
    if (!selectedProvider) return;
    let cancelled = false;
    setLoadingDetail(true);
    void fetchConnectorProvider(selectedProvider.service)
      .then((response) => {
        if (cancelled) return;
        setSelectedDetail(response.provider);
        setSelectedAuthType(preferredAuthType(response.provider));
        setProviders((current) =>
          updateProviderInList(current, response.provider)
        );
      })
      .catch((error: any) => {
        if (cancelled) return;
        setFormError(error?.message || 'Failed to load connector details');
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProvider]);

  const refreshSelectedProvider = useCallback(async () => {
    if (!selected) return;
    const response = await fetchConnectorProvider(selected.service);
    setSelectedDetail(response.provider);
    setProviders((current) => updateProviderInList(current, response.provider));
  }, [selected]);

  const saveConnection = useCallback(async () => {
    if (!selected || !selectedAuth) return;
    if (selectedAuth.type === 'oauth2') {
      setSaving(true);
      setFormError(null);
      try {
        const authorization = await createConnectorOAuthAuthorization(
          selected.service,
          selected.connection?.connectionName
        );
        if (!authorization.authorizationUrl) {
          throw new Error(
            'Connector Gateway did not return an authorization URL'
          );
        }
        window.open(
          authorization.authorizationUrl,
          'eigent_connector_oauth',
          'popup=yes,width=720,height=760,menubar=no,toolbar=no,location=yes,status=no'
        );
        toast.success(
          t('setting.connector-gateway-oauth-started', {
            defaultValue: 'OAuth authorization started',
          })
        );
      } catch (error: any) {
        setFormError(error?.message || 'Failed to start OAuth authorization');
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      await connectProvider(selected.service, {
        auth_type: selectedAuth.type,
        values:
          selectedAuth.type === 'no_auth'
            ? {}
            : selectedFields.reduce<Record<string, string>>((acc, field) => {
                acc[field.key] = values[field.key] || '';
                return acc;
              }, {}),
      });
      await refreshSelectedProvider();
      setPage(1);
      await refreshProviders(1);
      toast.success(
        t('setting.connector-gateway-saved', {
          defaultValue: 'Connector saved',
        })
      );
    } catch (error: any) {
      setFormError(error?.message || 'Failed to save connector');
    } finally {
      setSaving(false);
    }
  }, [
    refreshProviders,
    refreshSelectedProvider,
    selected,
    selectedAuth,
    selectedFields,
    t,
    values,
  ]);

  const removeConnection = useCallback(async () => {
    if (!selected?.connection) return;
    setSaving(true);
    setFormError(null);
    try {
      await disconnectProvider(
        selected.service,
        selected.connection.connectionName
      );
      await refreshSelectedProvider();
      setPage(1);
      await refreshProviders(1);
      toast.success(
        t('setting.connector-gateway-disconnected', {
          defaultValue: 'Connector disconnected',
        })
      );
    } catch (error: any) {
      setFormError(error?.message || 'Failed to disconnect connector');
    } finally {
      setSaving(false);
    }
  }, [refreshProviders, refreshSelectedProvider, selected, t]);

  if (!connectorGatewayEnabled) {
    return null;
  }

  return (
    <>
      <div className="mx-auto flex w-full flex-col px-6 pt-6">
        <div className="rounded-2xl bg-ds-bg-neutral-default-default px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-3 border-x-0 border-b-[0.5px] border-t-0 border-solid border-ds-border-neutral-default-default px-3 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ds-bg-neutral-subtle-default">
                <PlugZap className="h-5 w-5 text-ds-icon-neutral-default-default" />
              </div>
              <div className="min-w-0">
                <div className="text-body-base truncate font-bold text-ds-text-neutral-default-default">
                  Connector Gateway
                </div>
                <div className="text-body-xs text-ds-text-neutral-muted-default">
                  {providerCount || providers.length} connectors
                  {connectedCount > 0 ? ` | ${connectedCount} connected` : ''}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <SearchInput
                variant="icon"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder={t('setting.search-mcp')}
              />
              <TooltipSimple content={t('setting.refresh')}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  buttonContent="icon-only"
                  disabled={loadingProviders}
                  aria-label={t('setting.refresh')}
                  onClick={() => void refreshProviders(page)}
                >
                  {loadingProviders ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </TooltipSimple>
            </div>
          </div>

          {initialProvidersLoading ? (
            <div className="mx-3 my-4 grid grid-cols-1 overflow-hidden rounded-xl border border-solid border-ds-border-neutral-default-default md:grid-cols-2 xl:grid-cols-3">
              {skeletonItems.map((_, index) => (
                <div
                  key={index}
                  className="flex min-h-[78px] items-center gap-3 border-x-0 border-b border-r border-t-0 border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-subtle-default px-4 py-3"
                >
                  <div className="h-11 w-11 shrink-0 rounded-xl bg-ds-bg-neutral-strong-default" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-3.5 w-32 rounded bg-ds-bg-neutral-strong-default" />
                    <div className="h-2.5 w-20 rounded bg-ds-bg-neutral-strong-default" />
                  </div>
                  <div className="h-3 w-14 rounded bg-ds-bg-neutral-strong-default" />
                </div>
              ))}
            </div>
          ) : providerError ? (
            <div className="px-3 py-4 text-body-sm text-ds-text-error-default-default">
              {providerError}
            </div>
          ) : providers.length === 0 ? (
            <div className="px-3 py-4 text-body-sm text-ds-text-neutral-muted-default">
              {t('setting.no-connectors-found', {
                defaultValue: 'No connectors found',
              })}
            </div>
          ) : (
            <>
              <div className="relative mx-3 my-4">
                <div
                  className={`grid grid-cols-1 overflow-hidden rounded-xl border border-solid border-ds-border-neutral-default-default transition-opacity md:grid-cols-2 xl:grid-cols-3 ${
                    listRefreshing ? 'opacity-60' : 'opacity-100'
                  } ${pagedGridMinHeightClass}`}
                >
                  {providers.map((provider) => {
                    const connected = isConnected(provider);
                    return (
                      <button
                        key={provider.service}
                        type="button"
                        onClick={() => openProvider(provider)}
                        disabled={loadingProviders}
                        className="group flex min-h-[78px] w-full items-center gap-3 border-x-0 border-b border-r border-t-0 border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-subtle-default px-4 py-3 text-left transition-colors hover:bg-ds-bg-neutral-default-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-ring-brand-default-focus"
                      >
                        <ProviderIcon provider={provider} />
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-body-sm font-bold text-ds-text-neutral-default-default">
                              {providerLabel(provider)}
                            </span>
                            {connected ? (
                              <span className="h-2 w-2 shrink-0 rounded-full bg-ds-text-success-default-default" />
                            ) : provider.recommended ? (
                              <Sparkles className="h-3.5 w-3.5 shrink-0 text-ds-icon-brand-default-default" />
                            ) : null}
                          </div>
                        </div>
                        <span className="shrink-0 text-label-sm font-bold text-ds-text-neutral-muted-default">
                          {connected
                            ? t('setting.connected', {
                                defaultValue: 'Connected',
                              })
                            : t('setting.connect', {
                                defaultValue: 'Connect',
                              })}
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-ds-icon-neutral-muted-default transition-transform group-hover:translate-x-0.5" />
                      </button>
                    );
                  })}
                </div>
                {listRefreshing ? (
                  <div className="pointer-events-none absolute inset-0 flex items-start justify-end p-3">
                    <div className="flex items-center gap-2 rounded-lg border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default px-3 py-2 text-body-xs font-bold text-ds-text-neutral-muted-default shadow-sm">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      {t('setting.loading')}
                    </div>
                  </div>
                ) : null}
              </div>
              {showPagination ? (
                <div className="flex flex-wrap items-center justify-between gap-3 border-x-0 border-b-0 border-t-[0.5px] border-solid border-ds-border-neutral-default-default px-3 py-3">
                  <div className="text-body-xs text-ds-text-neutral-muted-default">
                    Showing {pageStart}-{pageEnd} of {filteredCount}
                    {debouncedQuery ? ' results' : ' connectors'}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={!canGoPrevious}
                      onClick={() =>
                        setPage((current) => Math.max(1, current - 1))
                      }
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Previous
                    </Button>
                    <div className="min-w-[88px] text-center text-body-xs text-ds-text-neutral-muted-default">
                      {page} / {totalPages}
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={!canGoNext}
                      onClick={() =>
                        setPage((current) => Math.min(totalPages, current + 1))
                      }
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <Sheet
        open={Boolean(selectedProvider)}
        onOpenChange={(open) => {
          if (!open) closeProvider();
        }}
      >
        <SheetContent className="flex !w-[520px] !max-w-[calc(100vw-24px)] flex-col gap-0 p-0 sm:!max-w-[520px]">
          <SheetHeader className="border-x-0 border-b border-t-0 border-solid border-ds-border-neutral-default-default p-6 pr-12 text-left">
            <div className="flex items-start gap-3">
              <ProviderIcon provider={selected} size="lg" />
              <div className="min-w-0 flex-1">
                <SheetTitle className="text-heading-xs truncate">
                  {selected ? providerLabel(selected) : 'Connector'}
                </SheetTitle>
                <SheetDescription className="mt-1 line-clamp-2">
                  {selected?.description ||
                    `${providerActionCountOrZero(selected)} actions`}
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="flex-1 space-y-5 overflow-y-auto p-6">
            {loadingDetail ? (
              <div className="space-y-3">
                <div className="h-10 rounded-xl bg-ds-bg-neutral-strong-default" />
                <div className="h-28 rounded-xl bg-ds-bg-neutral-strong-default" />
                <div className="h-10 rounded-xl bg-ds-bg-neutral-strong-default" />
              </div>
            ) : selected ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {selectedConnected ? (
                    <Badge
                      size="sm"
                      variant="secondary"
                      tone="success"
                      emphasis="subtle"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Connected
                    </Badge>
                  ) : null}
                  {selected.recommended ? (
                    <Badge size="sm" variant="secondary" emphasis="subtle">
                      <Sparkles className="h-3.5 w-3.5" />
                      Popular
                    </Badge>
                  ) : null}
                  <Badge size="sm" variant="outline">
                    {providerActionCount(selected)} actions
                  </Badge>
                  {selected.homepageUrl ? (
                    <a
                      href={selected.homepageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-label-sm text-ds-text-neutral-muted-default underline-offset-2 hover:underline"
                    >
                      Website
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  ) : null}
                </div>

                {selectedActions.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2 text-body-sm font-bold text-ds-text-neutral-default-default">
                        <ListChecks className="h-4 w-4 shrink-0 text-ds-icon-neutral-default-default" />
                        <span>Actions</span>
                      </div>
                      <span className="shrink-0 text-body-xs text-ds-text-neutral-muted-default">
                        {selectedActions.length}
                      </span>
                    </div>
                    <div className="max-h-[280px] overflow-y-auto rounded-xl border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-subtle-default">
                      {selectedActions.map((action, index) => (
                        <div
                          key={action.id || action.name || index}
                          className={`px-4 py-3 ${
                            index < selectedActions.length - 1
                              ? 'border-x-0 border-b border-t-0 border-solid border-ds-border-neutral-default-default'
                              : ''
                          }`}
                        >
                          <div className="min-w-0 text-body-sm font-bold text-ds-text-neutral-default-default">
                            {actionLabel(action)}
                          </div>
                          {action.id && action.id !== action.name ? (
                            <div className="mt-0.5 truncate text-body-xs text-ds-text-neutral-muted-default">
                              {action.id}
                            </div>
                          ) : null}
                          {action.description ? (
                            <div className="mt-1 text-body-xs leading-5 text-ds-text-neutral-muted-default">
                              {action.description}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {authOptions.length > 1 ? (
                  <div className="space-y-2">
                    <div className="text-body-sm font-bold text-ds-text-neutral-default-default">
                      Authentication
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {authOptions.map((auth) => (
                        <button
                          key={auth.type}
                          type="button"
                          onClick={() => {
                            setSelectedAuthType(auth.type);
                            setValues({});
                            setFormError(null);
                          }}
                          className={`rounded-lg border border-solid px-3 py-1.5 text-label-sm transition-colors ${
                            selectedAuthType === auth.type
                              ? 'border-ds-border-brand-default-default bg-ds-bg-brand-default-default text-ds-text-brand-inverse-default'
                              : 'border-ds-border-neutral-default-default bg-ds-bg-neutral-default-default text-ds-text-neutral-default-default hover:bg-ds-bg-neutral-subtle-default'
                          }`}
                        >
                          {authLabel(auth.type)}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {selectedAuth?.type === 'oauth2' ? (
                  <div className="rounded-xl border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-subtle-default p-4 text-body-sm text-ds-text-neutral-muted-default">
                    <div className="mb-2 font-bold text-ds-text-neutral-default-default">
                      Connect with OAuth
                    </div>
                    Eigent will open the provider authorization page through
                    Connector Gateway. After authorization completes, refresh
                    this connector to see the connected account.
                    {selectedAuth.scopes?.length ? (
                      <div className="mt-3 line-clamp-3 text-body-xs">
                        Scopes: {selectedAuth.scopes.join(', ')}
                      </div>
                    ) : null}
                  </div>
                ) : selectedAuth?.type === 'no_auth' ? (
                  <div className="flex items-start gap-3 rounded-xl border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-subtle-default p-4 text-body-sm text-ds-text-neutral-muted-default">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-ds-icon-neutral-default-default" />
                    This connector does not require credentials.
                  </div>
                ) : selectedFields.length > 0 ? (
                  <div className="space-y-3">
                    {selectedFields.map((field) =>
                      field.inputType === 'textarea' ||
                      field.inputType === 'json' ? (
                        <Textarea
                          key={field.key}
                          variant="enhanced"
                          title={field.label}
                          required={field.required}
                          placeholder={field.placeholder || undefined}
                          note={field.description || undefined}
                          value={values[field.key] || ''}
                          onChange={(event) =>
                            setValues((current) => ({
                              ...current,
                              [field.key]: event.target.value,
                            }))
                          }
                          className="min-h-[92px]"
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
                          value={values[field.key] || ''}
                          onChange={(event) =>
                            setValues((current) => ({
                              ...current,
                              [field.key]: event.target.value,
                            }))
                          }
                        />
                      )
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-subtle-default p-4 text-body-sm text-ds-text-neutral-muted-default">
                    No credential fields are declared for this authentication
                    type.
                  </div>
                )}

                {formError ? (
                  <div className="rounded-xl bg-ds-bg-error-subtle-default p-3 text-body-sm text-ds-text-error-strong-default">
                    {formError}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>

          <SheetFooter className="border-x-0 border-b-0 border-t border-solid border-ds-border-neutral-default-default p-4">
            <div className="flex w-full items-center justify-between gap-3">
              {selectedConnected ? (
                <Button
                  type="button"
                  variant="ghost"
                  tone="error"
                  disabled={saving}
                  onClick={() => void removeConnection()}
                >
                  <Trash2 className="h-4 w-4" />
                  Disconnect
                </Button>
              ) : (
                <div />
              )}
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={saving}
                  onClick={closeProvider}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={!canSave || saving}
                  onClick={() => void saveConnection()}
                >
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : selectedAuth?.type === 'oauth2' ? (
                    <ExternalLink className="h-4 w-4" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  {selectedAuth?.type === 'oauth2'
                    ? selectedConnected
                      ? 'Reconnect OAuth'
                      : 'Connect OAuth'
                    : selectedConnected
                      ? 'Save'
                      : 'Connect'}
                </Button>
              </div>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
