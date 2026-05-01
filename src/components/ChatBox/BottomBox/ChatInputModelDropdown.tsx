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
 * Default model picker for the chat input bar — same structure as Agents → Models.
 * Configured models switch inline; unconfigured options open Agents → Models.
 */

import { proxyFetchGet } from '@/api/http';
import folderIcon from '@/assets/Folder.svg';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  applyDefaultModelSelection,
  DEFAULT_MODEL_CONFIGURE_PATH,
  isDefaultModelConfigured,
  type DefaultModelCategory,
} from '@/lib/applyDefaultModelSelection';
import { INIT_PROVODERS } from '@/lib/llm';
import { cn } from '@/lib/utils';
import {
  getLocalPlatformName,
  LOCAL_MODEL_OPTIONS,
} from '@/pages/Agents/localModels';
import {
  getModelImage,
  needsInvertModelImage,
} from '@/shared/modelProviderImages';
import { useAuthStore } from '@/store/authStore';
import type { Provider } from '@/types';

import {
  Check,
  ChevronDown,
  HardDrive,
  Key,
  Layers,
  Server,
  Sparkles,
} from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

const cloudModelOptions = [
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview' },
  { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro Preview' },
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview' },
  { id: 'gpt-5.4', name: 'GPT-5.4' },
  { id: 'gpt-5.5', name: 'GPT-5.5' },
  { id: 'gpt-5-mini', name: 'GPT-5 Mini' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
  { id: 'claude-opus-4-7', name: 'Claude Opus 4.7' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
  { id: 'minimax_m2_7', name: 'Minimax M2.7' },
] as const;

export interface ChatInputModelDropdownProps {
  disabled?: boolean;
  /**
   * When true, shows the current default model in the same shell as
   * `WorkspaceSessionModeToggle` (readOnly) — no chevron, not interactive,
   * no filled background (session input bar).
   * Used for session chat input where the model is fixed for the session.
   */
  readOnly?: boolean;
}

const modelTriggerShellClass = cn(
  'rounded-xl px-2 py-1 inline-flex max-w-[min(100%,320px)] shrink-0 items-center gap-1.5',
  'bg-ds-bg-neutral-default-default text-ds-text-neutral-default-default'
);

export function ChatInputModelDropdown({
  disabled,
  readOnly = false,
}: ChatInputModelDropdownProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    modelType,
    cloud_model_type,
    appearance,
    setModelType,
    setCloudModelType,
  } = useAuthStore();

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
                is_valid: !!found?.is_valid,
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
        } else {
          setLocalPrefer(false);
          setCloudPrefer(false);
        }
      } catch (e) {
        console.error('Error fetching providers:', e);
      }
    })();
  }, [items, modelType]);

  /** Model name only in the trigger (e.g. "Gemini 3.1 Pro Preview", no cloud/source prefix). */
  const triggerModelName = useMemo(() => {
    if (cloudPrefer) {
      const cloudModel = cloudModelOptions.find(
        (m) => m.id === cloud_model_type
      );
      return cloudModel
        ? cloudModel.name
        : String(cloud_model_type)
            .replace(/-/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase());
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
    form,
    items,
    localPrefer,
    localPlatform,
    localTypes,
    t,
  ]);

  const needsInvert = (modelId: string | null): boolean =>
    needsInvertModelImage(modelId, appearance);

  const handleDefaultModelSelect = useCallback(
    async (category: DefaultModelCategory, modelId: string) => {
      if (
        !isDefaultModelConfigured(category, modelId, {
          items,
          form,
          localProviderIds,
        })
      ) {
        navigate(DEFAULT_MODEL_CONFIGURE_PATH);
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
          setCloudModelType(id as never);
        },
        t,
      });
    },
    [
      items,
      form,
      localProviderIds,
      localPlatform,
      navigate,
      setModelType,
      setCloudModelType,
      t,
    ]
  );

  /** Radix submenu forces align=start (tops align); use alignOffset so sub bottom aligns with the SubTrigger row bottom. */
  const activeSubTriggerRef = useRef<HTMLElement | null>(null);
  const subMenuContentRef = useRef<HTMLDivElement | null>(null);
  const [subMenuAlignOffset, setSubMenuAlignOffset] = useState(0);
  /** Bumped only when a submenu opens — never from ref callbacks (Radix composed refs re-fire and would loop). */
  const [subAlignSyncEpoch, setSubAlignSyncEpoch] = useState(0);

  const syncSubMenuAlignOffset = useCallback(() => {
    const trigger = activeSubTriggerRef.current;
    const sub = subMenuContentRef.current;
    if (!trigger || !sub) return;

    const triggerRect = trigger.getBoundingClientRect();
    const subH = sub.offsetHeight;

    const desiredTop = triggerRect.bottom - subH;
    const next = Math.round(desiredTop - triggerRect.top);

    setSubMenuAlignOffset((prev) => (prev === next ? prev : next));
  }, []);

  useLayoutEffect(() => {
    if (subAlignSyncEpoch === 0) return;
    let cancelled = false;
    let raf1 = 0;
    let raf2 = 0;
    let raf3 = 0;
    let raf4 = 0;

    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        syncSubMenuAlignOffset();
        raf3 = requestAnimationFrame(() => {
          raf4 = requestAnimationFrame(() => {
            if (cancelled) return;
            syncSubMenuAlignOffset();
          });
        });
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      cancelAnimationFrame(raf3);
      cancelAnimationFrame(raf4);
    };
  }, [subAlignSyncEpoch, syncSubMenuAlignOffset]);

  if (readOnly) {
    return (
      <div
        role="status"
        title={triggerModelName}
        aria-label={triggerModelName}
        className={cn(
          modelTriggerShellClass,
          'pointer-events-none bg-transparent',
          {
            'opacity-50': disabled,
          }
        )}
      >
        <span className="inline-flex min-h-[1.25rem] min-w-0 items-center gap-1.5 overflow-hidden">
          <Sparkles className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
          <span className="min-w-0 truncate !text-label-xs font-semibold">
            {triggerModelName}
          </span>
        </span>
      </div>
    );
  }

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) setSubMenuAlignOffset(0);
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={triggerModelName}
          aria-label={triggerModelName}
          aria-haspopup="menu"
          className={cn(
            modelTriggerShellClass,
            'min-w-0 cursor-pointer border-0 text-left',
            'justify-between font-semibold transition-colors',
            'hover:bg-ds-bg-neutral-subtle-hover active:bg-ds-bg-neutral-subtle-default',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-border-neutral-strong-default focus-visible:ring-offset-2 focus-visible:ring-offset-ds-bg-neutral-default-default',
            'disabled:pointer-events-none disabled:opacity-50'
          )}
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            <Sparkles
              className="size-3.5 shrink-0"
              strokeWidth={2}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-left !text-label-xs text-ds-text-neutral-default-default">
              {triggerModelName}
            </span>
          </span>
          <ChevronDown
            className="h-3.5 w-3.5 shrink-0 opacity-80"
            aria-hidden
            strokeWidth={2}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={4}
        alignOffset={0}
        collisionPadding={12}
        avoidCollisions
        className="w-[180px]"
      >
        {import.meta.env.VITE_USE_LOCAL_PROXY !== 'true' && (
          <DropdownMenuSub
            onOpenChange={(open) => {
              if (open) setSubAlignSyncEpoch((e) => e + 1);
            }}
          >
            <DropdownMenuSubTrigger
              className="flex w-full min-w-0 items-center justify-start gap-2 [&>svg:first-child]:!h-4 [&>svg:first-child]:!min-h-4 [&>svg:first-child]:!w-4 [&>svg:first-child]:!min-w-4"
              onPointerEnter={(e) => {
                activeSubTriggerRef.current = e.currentTarget;
              }}
            >
              <img
                src={folderIcon}
                alt=""
                className="mt-0.5 h-4 w-4 shrink-0"
                aria-hidden
              />
              <span className="min-w-0 flex-1 text-left text-body-sm">
                {t('setting.eigent-cloud')}
              </span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              ref={subMenuContentRef}
              alignOffset={subMenuAlignOffset}
              className="max-h-[300px] w-[200px] overflow-y-auto"
              collisionPadding={12}
              avoidCollisions
            >
              {cloudModelOptions.map((model) => (
                <DropdownMenuItem
                  key={model.id}
                  onSelect={() => {
                    void handleDefaultModelSelect('cloud', model.id);
                  }}
                  className="flex items-center justify-between"
                >
                  <span className="text-body-sm">{model.name}</span>
                  {cloudPrefer && cloud_model_type === model.id && (
                    <Check className="h-4 w-4 text-ds-text-success-default-default" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        <DropdownMenuSub
          onOpenChange={(open) => {
            if (open) setSubAlignSyncEpoch((e) => e + 1);
          }}
        >
          <DropdownMenuSubTrigger
            className="flex w-full min-w-0 items-center justify-start gap-2 [&>svg:first-child]:!h-5 [&>svg:first-child]:!min-h-4 [&>svg:first-child]:!w-4 [&>svg:first-child]:!min-w-4"
            onPointerEnter={(e) => {
              activeSubTriggerRef.current = e.currentTarget;
            }}
          >
            <Layers
              className="shrink-0 text-ds-icon-neutral-default-default"
              aria-hidden
            />
            <span className="min-w-0 flex-1 text-left text-body-sm">
              {t('setting.custom-model')}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            ref={subMenuContentRef}
            alignOffset={subMenuAlignOffset}
            className="max-h-[440px] w-[220px] overflow-y-auto"
            collisionPadding={12}
            avoidCollisions
          >
            {items.map((item, idx) => {
              const isConfigured = !!form[idx]?.provider_id;
              const isPreferred = form[idx]?.prefer;
              const modelImage = getModelImage(item.id);

              return (
                <DropdownMenuItem
                  key={item.id}
                  onSelect={() => {
                    void handleDefaultModelSelect('custom', item.id);
                  }}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    {modelImage ? (
                      <img
                        src={modelImage}
                        alt={item.name}
                        className="h-4 w-4"
                        style={
                          needsInvert(item.id)
                            ? { filter: 'invert(1)' }
                            : undefined
                        }
                      />
                    ) : (
                      <Key className="h-3 w-3 text-ds-icon-neutral-muted-default" />
                    )}
                    <span
                      className={`text-body-sm ${isConfigured ? 'text-ds-text-neutral-default-default' : 'text-ds-text-neutral-subtle-default'}`}
                    >
                      {item.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {!isConfigured && (
                      <div className="h-2 w-2 rounded-full bg-ds-text-neutral-subtle-default opacity-10" />
                    )}
                    {isPreferred && (
                      <Check className="h-4 w-4 text-ds-text-success-default-default" />
                    )}
                    {isConfigured && !isPreferred && (
                      <div className="h-2 w-2 rounded-full bg-ds-text-success-default-default" />
                    )}
                  </div>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub
          onOpenChange={(open) => {
            if (open) setSubAlignSyncEpoch((e) => e + 1);
          }}
        >
          <DropdownMenuSubTrigger
            className="flex w-full min-w-0 items-center justify-start gap-2 [&>svg:first-child]:!h-4 [&>svg:first-child]:!min-h-4 [&>svg:first-child]:!w-4 [&>svg:first-child]:!min-w-4"
            onPointerEnter={(e) => {
              activeSubTriggerRef.current = e.currentTarget;
            }}
          >
            <HardDrive
              className="shrink-0 text-ds-icon-neutral-default-default"
              aria-hidden
            />
            <span className="min-w-0 flex-1 text-left text-body-sm">
              {t('setting.local-model')}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            ref={subMenuContentRef}
            alignOffset={subMenuAlignOffset}
            className="w-[200px]"
            collisionPadding={12}
            avoidCollisions
          >
            {LOCAL_MODEL_OPTIONS.map((model) => {
              const isConfigured = !!localProviderIds[model.id];
              const isPreferred = localPrefer && localPlatform === model.id;
              const modelImage = getModelImage(`local-${model.id}`);

              return (
                <DropdownMenuItem
                  key={model.id}
                  onSelect={() => {
                    void handleDefaultModelSelect('local', model.id);
                  }}
                  className="flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    {modelImage ? (
                      <img
                        src={modelImage}
                        alt={model.name}
                        className="h-4 w-4"
                        style={
                          needsInvert(`local-${model.id}`)
                            ? { filter: 'invert(1)' }
                            : undefined
                        }
                      />
                    ) : (
                      <Server className="h-4 w-4 text-ds-icon-neutral-muted-default" />
                    )}
                    <span
                      className={`text-body-sm ${isConfigured ? 'text-ds-text-neutral-default-default' : 'text-ds-text-neutral-subtle-default'}`}
                    >
                      {model.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {!isConfigured && (
                      <div className="h-2 w-2 rounded-full bg-ds-text-neutral-subtle-default opacity-10" />
                    )}
                    {isPreferred && (
                      <Check className="h-4 w-4 text-ds-text-success-default-default" />
                    )}
                    {isConfigured && !isPreferred && (
                      <div className="h-2 w-2 rounded-full bg-ds-text-success-default-default" />
                    )}
                  </div>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
