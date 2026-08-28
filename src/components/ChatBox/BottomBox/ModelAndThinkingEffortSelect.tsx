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

/**
 * Combined thinking-effort and model selector for the chat input bar.
 * Configured models switch inline; unconfigured options open Agents → Models.
 */

import { proxyFetchGet } from '@/api/http';
import folderIcon from '@/assets/logo/eigent_icon_rich.svg';
import { DefaultModelMenuItem } from '@/components/ModelSelection/DefaultModelMenuItem';
import {
  getLocalPlatformName,
  LOCAL_MODEL_OPTIONS,
} from '@/components/Settings/Models/localModels';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DS_FOCUS_RING } from '@/components/ui/semanticProps';
import { createHost } from '@/host/createHost';
import {
  applyDefaultModelSelection,
  isDefaultModelConfigured,
  type DefaultModelCategory,
} from '@/lib/applyDefaultModelSelection';
import { INIT_PROVODERS } from '@/lib/llm';
import { getProviderValid } from '@/lib/providerStatus';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { useCloudModelStore } from '@/store/cloudModelStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { openSettings } from '@/store/settingsStore';
import { useSpaceStore } from '@/store/spaceStore';
import type { Provider } from '@/types';
import { ThinkingEffort, type ThinkingEffortType } from '@/types/constants';

import { Check, ChevronDown, HardDrive, Layers } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

export interface ModelAndThinkingEffortSelectProps {
  thinkingEffort: ThinkingEffortType | undefined;
  onThinkingEffortChange?: (effort: ThinkingEffortType | undefined) => void;
  disabled?: boolean;
  /**
   * Project whose pinned model this dropdown reads and writes. When set,
   * selections update only that Project's captured model; the global
   * default model is left untouched.
   */
  projectId?: string | null;
  /**
   * When true, shows the current default model in the same shell as
   * `ProjectModeToggle` (readOnly) — no chevron, not interactive,
   * no filled background (session input bar).
   * Used for session chat input where the model is fixed for the session.
   */
  readOnly?: boolean;
  className?: string;
}

const THINKING_EFFORT_OPTIONS: ThinkingEffortType[] = [
  ThinkingEffort.LOW,
  ThinkingEffort.MEDIUM,
  ThinkingEffort.HIGH,
  ThinkingEffort.XHIGH,
  ThinkingEffort.MAX,
];

const combinedTriggerShellClass = cn(
  'rounded-xl px-2 py-1 inline-flex max-w-[min(100%,320px)] shrink-0 items-center gap-1.5',
  'bg-ds-neutral-default-default text-ds-ink-default-default'
);

export function ModelAndThinkingEffortSelect({
  thinkingEffort,
  onThinkingEffortChange,
  disabled,
  projectId,
  readOnly = false,
  className,
}: ModelAndThinkingEffortSelectProps) {
  const { t } = useTranslation();
  const thinkingEffortLabelId = useId();
  const modelLabelId = useId();
  const {
    modelType,
    cloud_model_type,
    codex_model_type,
    email,
    setModelType,
    setCloudModelType,
  } = useAuthStore();
  const cloudModels = useCloudModelStore((state) => state.models);
  const fetchCloudModels = useCloudModelStore(
    (state) => state.fetchCloudModels
  );
  const getCloudModelDisplayName = useCloudModelStore(
    (state) => state.getModelDisplayName
  );
  const effectiveCloudModelId = useCloudModelStore((state) =>
    state.getEffectiveModelId(cloud_model_type)
  );
  const setProjectModel = useProjectRuntimeStore(
    (state) => state.setProjectModel
  );
  const runtimePinnedSelection = useProjectRuntimeStore((state) =>
    projectId
      ? (state.projects[projectId]?.metadata?.modelSelection ?? null)
      : null
  );
  const spacePinnedSelection = useSpaceStore((state) => {
    if (!projectId) return null;
    const spaceId = state.projectIdIndex[projectId];
    if (!spaceId) return null;
    return (
      state.projectsBySpaceId[spaceId]?.[projectId]?.metadata?.modelSelection ??
      null
    );
  });
  const pinnedSelection = projectId
    ? (runtimePinnedSelection ?? spacePinnedSelection)
    : null;
  const cloudModelOptions = useMemo(
    () =>
      cloudModels.map((model) => ({
        id: model.id,
        name: model.display_name,
      })),
    [cloudModels]
  );

  const [items] = useState<Provider[]>(
    INIT_PROVODERS.filter((p) => p.id !== 'local')
  );
  const [form, setForm] = useState(() =>
    INIT_PROVODERS.filter((p) => p.id !== 'local').map((p) => ({
      apiKey: p.apiKey,
      apiHost: p.apiHost,
      is_valid: p.is_valid ?? false,
      model_type: p.model_type ?? '',
      externalConfig: p.externalConfig
        ? p.externalConfig.map((ec) => ({ ...ec }))
        : undefined,
      provider_id: p.provider_id ?? undefined,
      prefer: p.prefer ?? false,
    }))
  );
  const [cloudPrefer, setCloudPrefer] = useState(false);
  const [localPrefer, setLocalPrefer] = useState(false);
  const [localPlatform, setLocalPlatform] = useState<string>('ollama');
  const [localTypes, setLocalTypes] = useState<Record<string, string>>({});
  const [localProviderIds, setLocalProviderIds] = useState<
    Record<string, number | undefined>
  >({});
  const [codexStatus, setCodexStatus] = useState<{
    connected: boolean;
    status: string;
  }>({ connected: false, status: 'not_connected' });

  useEffect(() => {
    if (import.meta.env.VITE_USE_LOCAL_PROXY === 'true') return;
    void fetchCloudModels();
  }, [fetchCloudModels]);

  useEffect(() => {
    (async () => {
      try {
        const res = await proxyFetchGet('/api/v1/providers');
        const providerList = Array.isArray(res) ? res : res.items || [];

        setForm((f) =>
          f.map((fi, idx) => {
            const item = items[idx];
            const found = providerList.find(
              (p: { provider_name: string }) => p.provider_name === item.id
            );
            if (found) {
              return {
                ...fi,
                provider_id: found.id,
                apiKey: found.api_key || '',
                apiHost: found.endpoint_url || item.apiHost,
                is_valid: getProviderValid(found),
                prefer: found.prefer ?? false,
                model_type: found.model_type ?? '',
                externalConfig: fi.externalConfig
                  ? fi.externalConfig.map((ec) => {
                      if (
                        found.encrypted_config &&
                        found.encrypted_config[ec.key] !== undefined
                      ) {
                        return { ...ec, value: found.encrypted_config[ec.key] };
                      }
                      return ec;
                    })
                  : undefined,
              };
            }
            return fi;
          })
        );

        const localProviders = providerList.filter(
          (p: { provider_name: string }) =>
            LOCAL_MODEL_OPTIONS.some((model) => model.id === p.provider_name)
        );

        const types: Record<string, string> = {};
        const providerIds: Record<string, number | undefined> = {};

        localProviders.forEach((local: Record<string, unknown>) => {
          const platform =
            (local.encrypted_config as { model_platform?: string } | undefined)
              ?.model_platform || (local.provider_name as string);
          types[platform] =
            (local.encrypted_config as { model_type?: string } | undefined)
              ?.model_type || '';
          providerIds[platform] = local.id as number;

          if (local.prefer) {
            setLocalPrefer(true);
            setLocalPlatform(platform);
          }
        });

        setLocalTypes(types);
        setLocalProviderIds(providerIds);

        if (localProviders.length === 0) {
          const nextTypes: Record<string, string> = {};
          const nextIds: Record<string, number | undefined> = {};
          LOCAL_MODEL_OPTIONS.forEach((model) => {
            nextTypes[model.id] = '';
            nextIds[model.id] = undefined;
          });
          setLocalTypes(nextTypes);
          setLocalProviderIds(nextIds);
        }

        if (modelType === 'cloud') {
          setCloudPrefer(true);
          setForm((f) => f.map((fi) => ({ ...fi, prefer: false })));
          setLocalPrefer(false);
        } else if (modelType === 'local') {
          setForm((f) => f.map((fi) => ({ ...fi, prefer: false })));
          setLocalPrefer(true);
          setCloudPrefer(false);
        } else if (modelType === 'codex_subscription') {
          setForm((f) => f.map((fi) => ({ ...fi, prefer: false })));
          setLocalPrefer(false);
          setCloudPrefer(false);
        } else {
          setLocalPrefer(false);
          setCloudPrefer(false);
        }
      } catch (e) {
        console.error('Error fetching providers:', e);
      }
    })();
  }, [items, modelType]);

  const refreshCodexStatus = useCallback(async () => {
    if (!email) {
      setCodexStatus({ connected: false, status: 'not_connected' });
      return;
    }
    try {
      const status =
        await createHost().electronAPI?.codexSubscriptionStatus?.(email);
      setCodexStatus(status || { connected: false, status: 'not_connected' });
    } catch (error) {
      console.error('Failed to load Codex subscription status:', error);
      setCodexStatus({ connected: false, status: 'error' });
    }
  }, [email]);

  useEffect(() => {
    refreshCodexStatus();
  }, [refreshCodexStatus]);

  useEffect(() => {
    const ipcRenderer = createHost().ipcRenderer;
    if (!ipcRenderer?.on || !ipcRenderer?.off) return;
    const listener = () => {
      refreshCodexStatus();
    };
    ipcRenderer.on('subscription-auth:codex-status-changed', listener);
    return () => {
      ipcRenderer.off('subscription-auth:codex-status-changed', listener);
    };
  }, [refreshCodexStatus]);

  const handleCodexSetDefault = useCallback(() => {
    if (projectId) {
      const codexModelId = codex_model_type || 'gpt-5.5';
      setProjectModel(projectId, {
        modelType: 'codex_subscription',
        codex_model_type: codexModelId,
        model_platform: 'openai',
        model_type: codexModelId,
      });
      return;
    }
    setCloudPrefer(false);
    setLocalPrefer(false);
    setForm((f) => f.map((fi) => ({ ...fi, prefer: false })));
    setModelType('codex_subscription');
  }, [codex_model_type, projectId, setModelType, setProjectModel]);

  /** Model name only in the trigger (e.g. "Gemini 3.1 Pro Preview", no cloud/source prefix). */
  const triggerModelName = useMemo(() => {
    if (pinnedSelection) {
      if (pinnedSelection.modelType === 'codex_subscription') {
        const pinnedCodexModelType = pinnedSelection.codex_model_type || '';
        return t('chat.codex-subscription-model', {
          model: pinnedCodexModelType ? ` (${pinnedCodexModelType})` : '',
          defaultValue: 'Codex Subscription{{model}}',
        });
      }
      if (pinnedSelection.modelType === 'cloud') {
        return getCloudModelDisplayName(
          pinnedSelection.cloud_model_type || cloud_model_type
        );
      }
      if (pinnedSelection.modelType === 'custom') {
        const idx =
          pinnedSelection.provider_id !== undefined
            ? form.findIndex(
                (f) => f.provider_id === pinnedSelection.provider_id
              )
            : -1;
        if (idx !== -1) {
          const mt = form[idx].model_type || '';
          return `${items[idx].name}${mt ? ` (${mt})` : ''}`;
        }
      }
      if (pinnedSelection.modelType === 'local') {
        const platform = Object.keys(localProviderIds).find(
          (key) => localProviderIds[key] === pinnedSelection.provider_id
        );
        if (platform) {
          const mt = localTypes[platform] || '';
          return `${getLocalPlatformName(platform)}${mt ? ` (${mt})` : ''}`;
        }
      }
      // Providers are still loading (or the pinned provider disappeared):
      // fall back to the identifiers captured with the pin.
      if (pinnedSelection.model_platform || pinnedSelection.model_type) {
        const platformLabel = pinnedSelection.model_platform || '';
        const mt = pinnedSelection.model_type || '';
        return platformLabel ? `${platformLabel}${mt ? ` (${mt})` : ''}` : mt;
      }
    }

    if (modelType === 'codex_subscription') {
      return t('chat.codex-subscription-model', {
        model: codex_model_type ? ` (${codex_model_type})` : '',
        defaultValue: 'Codex Subscription{{model}}',
      });
    }

    if (cloudPrefer) {
      return getCloudModelDisplayName(cloud_model_type);
    }

    const preferredIdx = form.findIndex((f) => f.prefer);
    if (preferredIdx !== -1) {
      const item = items[preferredIdx];
      const mt = form[preferredIdx].model_type || '';
      return `${item.name}${mt ? ` (${mt})` : ''}`;
    }

    if (localPrefer && localPlatform) {
      const platformName = getLocalPlatformName(localPlatform);
      const mt = localTypes[localPlatform] || '';
      return `${platformName}${mt ? ` (${mt})` : ''}`;
    }

    return t('setting.select-default-model');
  }, [
    cloudPrefer,
    cloud_model_type,
    codex_model_type,
    form,
    getCloudModelDisplayName,
    items,
    localPrefer,
    localPlatform,
    localProviderIds,
    localTypes,
    modelType,
    pinnedSelection,
    t,
  ]);

  const triggerThinkingEffortName =
    thinkingEffort === undefined
      ? t('layout.default')
      : t(`layout.thinking-effort-${thinkingEffort}`);
  const selectedCloudModelId =
    (pinnedSelection?.modelType === 'cloud'
      ? pinnedSelection.cloud_model_type || effectiveCloudModelId
      : !pinnedSelection && cloudPrefer
        ? effectiveCloudModelId
        : '') ?? '';
  const codexSubscriptionItemId =
    items.find((provider) => provider.authMode === 'oauth_subscription')?.id ??
    '';
  const preferredCustomIndex = form.findIndex((provider) => provider.prefer);
  const selectedCustomModelId = pinnedSelection
    ? pinnedSelection.modelType === 'codex_subscription'
      ? codexSubscriptionItemId
      : // A pin without `provider_id` matches nothing: `form[index].provider_id`
        // is `undefined` for every not-yet-loaded provider, so an unguarded
        // lookup would tick the first (usually unconfigured) row.
        pinnedSelection.modelType === 'custom' &&
          pinnedSelection.provider_id !== undefined
        ? (items.find(
            (_, index) =>
              form[index]?.provider_id === pinnedSelection.provider_id
          )?.id ?? '')
        : ''
    : modelType === 'codex_subscription'
      ? codexSubscriptionItemId
      : preferredCustomIndex >= 0
        ? items[preferredCustomIndex].id
        : '';
  const selectedLocalModelId =
    // Same guard as above: `localProviderIds` holds `undefined` for every
    // unconfigured platform, so a pin without `provider_id` must match none.
    pinnedSelection?.modelType === 'local' &&
    pinnedSelection.provider_id !== undefined
      ? (Object.keys(localProviderIds).find(
          (platform) =>
            localProviderIds[platform] === pinnedSelection.provider_id
        ) ?? '')
      : !pinnedSelection && localPrefer
        ? localPlatform
        : '';
  const combinedTriggerText = `${triggerModelName} ${triggerThinkingEffortName}`;
  const combinedAccessibleName = `${t(
    'setting.model'
  )}: ${triggerModelName}; ${t(
    'layout.thinking-effort-label'
  )}: ${triggerThinkingEffortName}`;

  const handleDefaultModelSelect = useCallback(
    async (category: DefaultModelCategory, modelId: string) => {
      if (
        !isDefaultModelConfigured(category, modelId, {
          items,
          form,
          localProviderIds,
        })
      ) {
        openSettings('models');
        return;
      }
      if (projectId) {
        // Pin the choice to this Project only; the global default model
        // (and the server-side preferred provider) stays unchanged.
        if (category === 'cloud') {
          setProjectModel(projectId, {
            modelType: 'cloud',
            cloud_model_type: modelId,
          });
          return;
        }
        if (category === 'custom') {
          const idx = items.findIndex((item) => item.id === modelId);
          const providerId = idx !== -1 ? form[idx]?.provider_id : undefined;
          if (providerId === undefined) return;
          setProjectModel(projectId, {
            modelType: 'custom',
            provider_id: providerId,
            model_platform: modelId,
            model_type: form[idx]?.model_type || undefined,
          });
          return;
        }
        if (category === 'local') {
          const providerId = localProviderIds[modelId];
          if (providerId === undefined) return;
          setProjectModel(projectId, {
            modelType: 'local',
            provider_id: providerId,
            model_platform: modelId,
            model_type: localTypes[modelId] || undefined,
          });
          return;
        }
        return;
      }
      await applyDefaultModelSelection({
        category,
        modelId,
        items,
        form,
        setForm: setForm as Dispatch<SetStateAction<unknown[]>>,
        setCloudPrefer,
        setLocalPrefer,
        setLocalPlatform,
        localProviderIds,
        localPlatform,
        setModelType,
        setCloudModelType: (id: string) => {
          setCloudModelType(id);
        },
        t,
      });
    },
    [
      items,
      form,
      localProviderIds,
      localPlatform,
      localTypes,
      projectId,
      setProjectModel,
      setModelType,
      setCloudModelType,
      t,
    ]
  );

  const activeSubTriggerRef = useRef<HTMLElement | null>(null);

  // Bottom-align the sub content with the trigger row purely imperatively:
  // shift the content up by (subHeight - triggerHeight) via marginTop.
  // No React state is touched, so this can never cause a re-render loop.
  const subContentCallbackRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const trigger = activeSubTriggerRef.current;
    if (!trigger) return;
    const subH = el.offsetHeight;
    const trigH = trigger.offsetHeight;
    if (subH <= 0 || trigH <= 0) return;
    el.style.marginTop = `${trigH - subH}px`;
  }, []);

  const [open, setOpen] = useState(false);

  if (readOnly) {
    return (
      <div
        role="status"
        title={combinedTriggerText}
        aria-label={combinedAccessibleName}
        className={cn(
          combinedTriggerShellClass,
          'pointer-events-none bg-transparent',
          {
            'opacity-50': disabled,
          },
          className
        )}
      >
        <span className="inline-flex min-h-[1.25rem] min-w-0 items-center gap-1.5 overflow-hidden">
          <span className="min-w-0 truncate !text-ds-text-meta font-semibold">
            {triggerModelName}
          </span>
          <span className="shrink-0 !text-ds-text-meta font-semibold text-ds-ink-muted-default">
            {triggerThinkingEffortName}
          </span>
        </span>
      </div>
    );
  }

  return (
    <DropdownMenu
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void fetchCloudModels();
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={combinedTriggerText}
          aria-label={combinedAccessibleName}
          aria-haspopup="menu"
          className={cn(
            combinedTriggerShellClass,
            'min-w-0 cursor-pointer border-0 border-x-0 border-y-0 text-left',
            'justify-between font-semibold transition-[background-color,box-shadow,opacity] duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)]',
            'hover:bg-ds-neutral-subtle-default active:shadow-ds-elevation-control-pressed data-[state=open]:bg-ds-neutral-subtle-default',
            DS_FOCUS_RING,
            'focus-visible:ring-offset-ds-neutral-default-default',
            'disabled:pointer-events-none disabled:opacity-50',
            open && 'min-w-56',
            className
          )}
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            <span className="min-w-0 flex-1 truncate text-left !text-ds-text-meta text-ds-ink-default-default">
              {triggerModelName}
            </span>
            <span className="shrink-0 !text-ds-text-meta text-ds-ink-muted-default">
              {triggerThinkingEffortName}
            </span>
          </span>
          <ChevronDown className="size-4 shrink-0 opacity-80" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        sideOffset={4}
        collisionPadding={12}
        avoidCollisions
        className="min-w-56"
      >
        <DropdownMenuLabel
          id={thinkingEffortLabelId}
          className="px-2 py-1.5 text-ds-text-meta font-medium text-ds-ink-muted-default"
        >
          {t('layout.thinking-effort-label')}
        </DropdownMenuLabel>
        <DropdownMenuGroup aria-labelledby={thinkingEffortLabelId}>
          <DropdownMenuItem
            role="menuitemradio"
            aria-checked={thinkingEffort === undefined}
            onSelect={() => onThinkingEffortChange?.(undefined)}
            className="h-ds-control-md min-h-ds-control-md py-0"
          >
            <span className="min-w-0 flex-1 truncate">
              {t('layout.default')}
            </span>
            {thinkingEffort === undefined ? (
              <Check
                className="ml-auto size-4 shrink-0 text-ds-ink-default-default"
                aria-hidden
              />
            ) : null}
          </DropdownMenuItem>
          {THINKING_EFFORT_OPTIONS.map((effort) => {
            const selected = effort === thinkingEffort;
            return (
              <DropdownMenuItem
                key={effort}
                role="menuitemradio"
                aria-checked={selected}
                onSelect={() => onThinkingEffortChange?.(effort)}
                className="h-ds-control-md min-h-ds-control-md py-0"
              >
                <span className="min-w-0 flex-1 truncate">
                  {t(`layout.thinking-effort-${effort}`)}
                </span>
                {selected ? (
                  <Check
                    className="ml-auto size-4 shrink-0 text-ds-ink-default-default"
                    aria-hidden
                  />
                ) : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuLabel
          id={modelLabelId}
          className="px-2 py-1.5 text-ds-text-meta font-medium text-ds-ink-muted-default"
        >
          {t('setting.model')}
        </DropdownMenuLabel>
        <DropdownMenuGroup aria-labelledby={modelLabelId}>
          {import.meta.env.VITE_USE_LOCAL_PROXY !== 'true' && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                className="h-ds-control-md min-h-ds-control-md w-full min-w-0 py-0"
                onPointerEnter={(e) => {
                  activeSubTriggerRef.current = e.currentTarget;
                }}
              >
                <span className="flex size-ds-icon-lg shrink-0 items-center justify-center">
                  <img
                    src={folderIcon}
                    alt=""
                    className="size-ds-icon-lg"
                    aria-hidden
                  />
                </span>
                <span className="min-w-0 flex-1 text-left text-ds-text-base">
                  {t('setting.eigent-cloud')}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent
                ref={subContentCallbackRef}
                className="scrollbar-always-visible max-h-[300px] w-[200px] overflow-y-auto"
              >
                <DropdownMenuGroup aria-label={t('setting.eigent-cloud')}>
                  {cloudModelOptions.map((model) => {
                    const selected = selectedCloudModelId === model.id;
                    return (
                      <DefaultModelMenuItem
                        key={model.id}
                        configured
                        selected={selected}
                        statusLabel={t('setting.configured')}
                        onSelect={() => {
                          void handleDefaultModelSelect('cloud', model.id);
                        }}
                      >
                        {model.name}
                      </DefaultModelMenuItem>
                    );
                  })}
                </DropdownMenuGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              className="h-ds-control-md min-h-ds-control-md w-full min-w-0 py-0"
              onPointerEnter={(e) => {
                activeSubTriggerRef.current = e.currentTarget;
              }}
            >
              <span className="flex size-ds-icon-lg shrink-0 items-center justify-center">
                <Layers className="size-ds-icon-md" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 text-left text-ds-text-base">
                {t('setting.custom-model')}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              ref={subContentCallbackRef}
              className="scrollbar-always-visible max-h-[440px] w-[220px] overflow-y-auto"
            >
              <DropdownMenuGroup aria-label={t('setting.custom-model')}>
                {items
                  .map((item, idx) => ({ item, idx }))
                  .sort((a, b) => {
                    // Subscription (OAuth) providers first, original order otherwise.
                    const aSub =
                      a.item.authMode === 'oauth_subscription' ? 0 : 1;
                    const bSub =
                      b.item.authMode === 'oauth_subscription' ? 0 : 1;
                    return aSub - bSub;
                  })
                  .map(({ item, idx }) => {
                    const isSubscriptionAuth =
                      item.authMode === 'oauth_subscription';
                    const isConfigured = isSubscriptionAuth
                      ? codexStatus.connected
                      : !!form[idx]?.provider_id;
                    const selected = selectedCustomModelId === item.id;

                    return (
                      <DefaultModelMenuItem
                        key={item.id}
                        configured={isConfigured}
                        selected={selected}
                        statusLabel={t(
                          isConfigured
                            ? 'setting.configured'
                            : 'setting.not-configured'
                        )}
                        onSelect={() => {
                          if (isSubscriptionAuth) {
                            if (isConfigured) {
                              handleCodexSetDefault();
                            } else {
                              openSettings('models');
                            }
                            return;
                          }
                          void handleDefaultModelSelect('custom', item.id);
                        }}
                      >
                        {item.name}
                      </DefaultModelMenuItem>
                    );
                  })}
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger
              className="h-ds-control-md min-h-ds-control-md w-full min-w-0 py-0"
              onPointerEnter={(e) => {
                activeSubTriggerRef.current = e.currentTarget;
              }}
            >
              <span className="flex size-ds-icon-lg shrink-0 items-center justify-center">
                <HardDrive className="size-ds-icon-md" aria-hidden />
              </span>
              <span className="min-w-0 flex-1 text-left text-ds-text-base">
                {t('setting.local-model')}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              ref={subContentCallbackRef}
              className="scrollbar-always-visible max-h-[300px] w-[200px] overflow-y-auto"
            >
              <DropdownMenuGroup aria-label={t('setting.local-model')}>
                {LOCAL_MODEL_OPTIONS.map((model) => {
                  const isConfigured = !!localProviderIds[model.id];
                  const selected = selectedLocalModelId === model.id;

                  return (
                    <DefaultModelMenuItem
                      key={model.id}
                      configured={isConfigured}
                      selected={selected}
                      statusLabel={t(
                        isConfigured
                          ? 'setting.configured'
                          : 'setting.not-configured'
                      )}
                      onSelect={() => {
                        void handleDefaultModelSelect('local', model.id);
                      }}
                    >
                      {model.name}
                    </DefaultModelMenuItem>
                  );
                })}
              </DropdownMenuGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
