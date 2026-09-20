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

import { Button } from '@/components/ui/button';
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
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { useConfiguredModels } from '@/hooks/useConfiguredModels';
import { isCloudModelAvailable } from '@/lib/cloudModelAvailability';
import {
  providerCategory,
  providerDefinition,
  setConfiguredProviderDefault,
} from '@/lib/configuredModels';
import { getProviderValid } from '@/lib/providerStatus';
import { cn } from '@/lib/utils';
import {
  getModelImage,
  needsInvertModelImage,
} from '@/shared/modelProviderImages';
import { useAuthStore } from '@/store/authStore';
import { useCloudModelStore } from '@/store/cloudModelStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { openSettings } from '@/store/settingsStore';
import { useSpaceStore } from '@/store/spaceStore';
import { useUsageNoticeStore } from '@/store/usageNoticeStore';
import { ThinkingEffort, type ThinkingEffortType } from '@/types/constants';
import { Check } from 'lucide-react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import { useId, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

export interface ModelAndThinkingEffortSelectProps {
  thinkingEffort: ThinkingEffortType | undefined;
  onThinkingEffortChange?: (effort: ThinkingEffortType | undefined) => void;
  disabled?: boolean;
  projectId?: string | null;
  readOnly?: boolean;
  className?: string;
}
type Selection = {
  modelType: 'cloud' | 'custom' | 'local' | 'codex_subscription';
  cloud_model_type?: string;
  codex_model_type?: string;
  provider_id?: number;
  model_platform?: string;
  model_type?: string;
};
type Option = {
  id: string;
  name: string;
  group: string;
  selection: Selection;
};
const EFFORTS = [
  ThinkingEffort.LOW,
  ThinkingEffort.MEDIUM,
  ThinkingEffort.HIGH,
  ThinkingEffort.XHIGH,
  ThinkingEffort.MAX,
] as const;
const EFFORT_THUMB_SIZE_CLASSES = [
  'size-ds-16',
  'size-ds-20',
  'size-ds-24',
  'size-ds-control-sm',
  'size-ds-control-md',
] as const;

// Exact track silhouette from Figma node 8118:10461, isolated from its frame.
const THINKING_EFFORT_TRACK_PATH =
  'M115 68C115 61.3011 120.297 55.8013 126.992 55.5503L488.019 42.0118C502.754 41.4592 515 53.2548 515 68C515 82.7452 502.754 94.5408 488.019 93.9882L126.992 80.4497C120.297 80.1987 115 74.6989 115 68Z';

const triggerShellClass = cn(
  'rounded-xl px-2 py-1 inline-flex max-w-[min(100%,320px)] shrink-0 items-center gap-ds-8',
  'bg-ds-neutral-default-default text-ds-ink-default-default'
);

function sliderPosition(index: number) {
  const ratio = index / (EFFORTS.length - 1);
  const percentage = ratio * 100;
  const edgeOffset = 0.875 - ratio * 1.75;
  return `calc(${percentage}% + ${edgeOffset}rem)`;
}

interface ThinkingEffortSliderProps {
  value: ThinkingEffortType | undefined;
  onValueChange: (value: ThinkingEffortType) => void;
  getLabel: (value: ThinkingEffortType) => string;
  ariaLabel: string;
  defaultLabel: string;
}

function ThinkingEffortSlider({
  value,
  onValueChange,
  getLabel,
  ariaLabel,
  defaultLabel,
}: ThinkingEffortSliderProps) {
  const trackClipId = useId().replaceAll(':', '');
  const selectedIndex = value === undefined ? -1 : EFFORTS.indexOf(value);
  const inputIndex = selectedIndex < 0 ? 2 : selectedIndex;
  const fillPercentage =
    selectedIndex < 0 ? 0 : (selectedIndex / (EFFORTS.length - 1)) * 100;

  const changeValue = (event: ChangeEvent<HTMLInputElement>) => {
    const next = EFFORTS[Number(event.target.value)];
    if (next) onValueChange(next);
  };

  const keepSliderKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    if (
      [
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        'Home',
        'End',
        'PageUp',
        'PageDown',
      ].includes(event.key)
    ) {
      event.stopPropagation();
    }
  };

  return (
    <div className="px-2 pb-2">
      <div className="relative h-8">
        <input
          type="range"
          min={0}
          max={EFFORTS.length - 1}
          step={1}
          value={inputIndex}
          aria-label={ariaLabel}
          aria-valuetext={value === undefined ? defaultLabel : getLabel(value)}
          onChange={changeValue}
          onKeyDown={keepSliderKeys}
          className="peer absolute inset-0 z-20 m-0 h-full w-full cursor-pointer opacity-0"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/2 h-7 -translate-y-1/2 rounded-full ring-offset-2 ring-offset-ds-neutral-subtle-default peer-focus-visible:ring-2 peer-focus-visible:ring-ds-ring-focus"
        >
          <svg
            className="absolute inset-0 size-full"
            viewBox="115 42 400 52"
            preserveAspectRatio="none"
          >
            <defs>
              <clipPath id={trackClipId}>
                <path d={THINKING_EFFORT_TRACK_PATH} />
              </clipPath>
            </defs>
            <path
              className="fill-ds-bg-neutral-default-default"
              d={THINKING_EFFORT_TRACK_PATH}
            />
            {selectedIndex >= 0 && (
              <rect
                x="115"
                y="42"
                height="52"
                width={(400 * fillPercentage) / 100}
                clipPath={`url(#${trackClipId})`}
                className="fill-ds-accent-strong-default transition-[width] duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
              />
            )}
          </svg>
          {EFFORTS.map((effort, index) => (
            <span
              key={effort}
              className="absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ds-neutral-subtle-default"
              style={{ left: sliderPosition(index) }}
            />
          ))}
        </div>
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-default-default shadow-ds-elevation-control transition-[left,width,height] duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none',
            EFFORT_THUMB_SIZE_CLASSES[inputIndex]
          )}
          style={{ left: sliderPosition(inputIndex) }}
        />
      </div>
    </div>
  );
}

export function ModelAndThinkingEffortSelect({
  thinkingEffort,
  onThinkingEffortChange,
  disabled,
  projectId,
  readOnly = false,
  className,
}: ModelAndThinkingEffortSelectProps) {
  const { t } = useTranslation();
  const inventory = useConfiguredModels();
  const auth = useAuthStore();
  const [modelSubmenuTrigger, setModelSubmenuTrigger] =
    useState<HTMLDivElement | null>(null);
  const [modelSubmenuContent, setModelSubmenuContent] =
    useState<HTMLDivElement | null>(null);
  const [modelSubmenuAlignOffset, setModelSubmenuAlignOffset] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const planKey = useUsageNoticeStore((state) => state.subscription?.plan_key);
  const [busy, setBusy] = useState(false);
  const getCloudName = useCloudModelStore((state) => state.getModelDisplayName);
  const effectiveCloudId = useCloudModelStore((state) =>
    state.getEffectiveModelId(auth.cloud_model_type)
  );
  const setProjectModel = useProjectRuntimeStore(
    (state) => state.setProjectModel
  );
  const runtimeSelection = useProjectRuntimeStore((state) =>
    projectId ? state.projects[projectId]?.metadata?.modelSelection : null
  );
  const storedSelection = useSpaceStore((state) => {
    if (!projectId) return null;
    const spaceId = state.projectIdIndex[projectId];
    return spaceId
      ? state.projectsBySpaceId[spaceId]?.[projectId]?.metadata?.modelSelection
      : null;
  });
  useLayoutEffect(() => {
    if (!modelSubmenuTrigger || !modelSubmenuContent) return;
    const updateAlignOffset = () => {
      const triggerHeight = modelSubmenuTrigger.offsetHeight;
      const contentHeight = modelSubmenuContent.offsetHeight;
      setModelSubmenuAlignOffset(Math.round(triggerHeight - contentHeight));
    };
    updateAlignOffset();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateAlignOffset);
    observer.observe(modelSubmenuTrigger);
    observer.observe(modelSubmenuContent);
    return () => observer.disconnect();
  }, [modelSubmenuContent, modelSubmenuTrigger]);
  const pinned = projectId ? (runtimeSelection ?? storedSelection) : null;
  const preferred = inventory.records.find(
    (record) =>
      record.prefer && providerCategory(record.provider_name) === auth.modelType
  );
  const selection: Selection = pinned ?? {
    modelType: auth.modelType,
    cloud_model_type: effectiveCloudId ?? undefined,
    codex_model_type: auth.codex_model_type,
    provider_id: preferred?.id,
    model_type: preferred?.model_type,
  };
  const selectedId =
    selection.modelType === 'cloud'
      ? `cloud:${selection.cloud_model_type}`
      : selection.modelType === 'codex_subscription'
        ? 'codex'
        : `provider:${selection.provider_id}`;
  const selectedName =
    selection.modelType === 'cloud'
      ? getCloudName(selection.cloud_model_type ?? '')
      : selection.modelType === 'codex_subscription'
        ? selection.codex_model_type
        : (inventory.records.find(
            (record) => record.id === selection.provider_id
          )?.model_type ?? selection.model_type);
  const effortLabel = t(
    thinkingEffort === undefined
      ? 'setting.default'
      : `layout.thinking-effort-${thinkingEffort}`
  );
  const modelLabel = selectedName || t('setting.not-configured');
  const triggerLabel = `${modelLabel}, ${effortLabel}`;
  const options: Option[] = [
    ...(inventory.cloudAvailable
      ? inventory.cloudModels
          .filter(
            (model) =>
              !inventory.hidden.includes(model.id) &&
              isCloudModelAvailable(model, planKey)
          )
          .map((model): Option => ({
            id: `cloud:${model.id}`,
            name: model.display_name,
            group: 'eigent',
            selection: { modelType: 'cloud', cloud_model_type: model.id },
          }))
      : []),
    ...inventory.records.filter(getProviderValid).map((record): Option => ({
      id: `provider:${record.id}`,
      name: record.model_type,
      group: record.provider_name,
      selection: {
        modelType: providerCategory(record.provider_name),
        provider_id: record.id,
        model_platform: record.provider_name,
        model_type: record.model_type,
      },
    })),
    ...(inventory.codexConnected
      ? [
          {
            id: 'codex',
            name: auth.codex_model_type,
            group: 'codex-subscription',
            selection: {
              modelType: 'codex_subscription' as const,
              codex_model_type: auth.codex_model_type,
            },
          },
        ]
      : []),
  ];
  async function choose(option: Option) {
    if (busy) return;
    if (projectId) {
      setProjectModel(projectId, option.selection);
      return;
    }
    setBusy(true);
    try {
      if (option.selection.modelType === 'cloud') {
        auth.setCloudModelType(option.selection.cloud_model_type!);
        auth.setModelType('cloud');
      } else if (option.selection.modelType === 'codex_subscription')
        auth.setModelType('codex_subscription');
      else {
        const record = inventory.records.find(
          (item) => item.id === option.selection.provider_id
        );
        if (record) await setConfiguredProviderDefault(record);
      }
    } catch {
      toast.error(t('setting.save-failed'));
    } finally {
      setBusy(false);
    }
  }
  if (readOnly)
    return (
      <DsText
        as="span"
        className={cn('inline-flex items-center gap-ds-8', className)}
        title={triggerLabel}
      >
        <span className="min-w-0 truncate">{modelLabel}</span>
        <span className="shrink-0 text-ds-ink-muted-default">
          {effortLabel}
        </span>
      </DsText>
    );
  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled || busy}
          className={cn(
            triggerShellClass,
            'min-w-0 cursor-pointer border-0 border-x-0 border-y-0 text-left',
            'justify-start font-semibold transition-colors',
            'hover:bg-ds-neutral-subtle-default active:shadow-ds-elevation-control-pressed data-[state=open]:bg-ds-neutral-subtle-default',
            'focus-visible:ring-2 focus-visible:ring-ds-hairline-strong-default focus-visible:ring-offset-2 focus-visible:ring-offset-ds-neutral-default-default focus-visible:outline-none',
            'disabled:pointer-events-none disabled:opacity-50',
            className
          )}
          aria-label={`${t('setting.select-model')}: ${triggerLabel}`}
          title={triggerLabel}
        >
          <span className="min-w-0 truncate text-left !text-ds-text-meta text-ds-ink-default-default">
            {modelLabel}
          </span>
          <span className="shrink-0 !text-ds-text-meta font-medium text-ds-ink-muted-default">
            {effortLabel}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        sideOffset={4}
        collisionPadding={12}
        avoidCollisions
        className="w-[280px] max-w-[var(--radix-dropdown-menu-content-available-width)] overflow-hidden"
      >
        {onThinkingEffortChange && (
          <>
            <div className="flex items-center justify-between gap-2 px-2 py-1">
              <span className="text-ds-text-meta font-semibold text-ds-ink-default-default">
                {t('layout.thinking-effort-label')}: {effortLabel}
              </span>
              <Button
                variant="ghost"
                size="xs"
                disabled={thinkingEffort === undefined}
                onClick={() => onThinkingEffortChange(undefined)}
              >
                {t('setting.reset')}
              </Button>
            </div>
            <ThinkingEffortSlider
              value={thinkingEffort}
              onValueChange={onThinkingEffortChange}
              getLabel={(effort) => t(`layout.thinking-effort-${effort}`)}
              ariaLabel={t('layout.thinking-effort-label')}
              defaultLabel={t('setting.default')}
            />
            <DropdownMenuSeparator />
          </>
        )}
        <div className="flex items-center justify-between gap-2 px-2 py-1">
          <span className="text-ds-text-meta font-semibold text-ds-ink-default-default">
            {t('setting.models')}
          </span>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => {
              setMenuOpen(false);
              openSettings('models');
            }}
          >
            {t('setting.model-list.add-more')}
          </Button>
        </div>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            ref={setModelSubmenuTrigger}
            className="min-h-ds-control-lg"
          >
            <span className="min-w-0 flex-1 truncate">{modelLabel}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            ref={setModelSubmenuContent}
            alignOffset={modelSubmenuAlignOffset}
            sideOffset={6}
            collisionPadding={12}
            avoidCollisions
            className="scrollbar-always-visible max-h-96 w-max max-w-[var(--radix-dropdown-menu-content-available-width)] overflow-y-auto"
          >
            {inventory.loading && (
              <DropdownMenuLabel>{t('setting.loading')}</DropdownMenuLabel>
            )}
            {inventory.error && (
              <DropdownMenuItem onSelect={inventory.refresh}>
                {t('setting.model-list.load-error')} ·{' '}
                {t('setting.model-list.retry')}
              </DropdownMenuItem>
            )}
            {[...new Set(options.map((option) => option.group))].map(
              (group, groupIndex) => {
                const groupName =
                  group === 'eigent'
                    ? 'Eigent'
                    : providerDefinition(group).name;
                const providerImageId = group === 'eigent' ? 'cloud' : group;
                const providerImage = getModelImage(providerImageId);
                return (
                  <div key={group}>
                    {groupIndex > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuGroup aria-label={groupName}>
                      <DropdownMenuLabel className="truncate px-2 py-1.5 font-normal text-ds-ink-muted-default">
                        <span className="flex items-center gap-ds-6 text-ds-text-meta font-medium">
                          {providerImage && (
                            <img
                              src={providerImage}
                              alt=""
                              className={cn(
                                'size-ds-16 shrink-0 object-contain',
                                needsInvertModelImage(
                                  providerImageId,
                                  auth.appearance
                                ) && 'invert'
                              )}
                            />
                          )}
                          {groupName}
                        </span>
                      </DropdownMenuLabel>
                      {options
                        .filter((option) => option.group === group)
                        .map((option) => (
                          <DropdownMenuItem
                            key={option.id}
                            role="menuitemradio"
                            aria-checked={selectedId === option.id}
                            disabled={busy}
                            onSelect={() => choose(option)}
                          >
                            <DsText
                              as="span"
                              className="min-w-0 flex-1 truncate"
                            >
                              {option.name}
                            </DsText>
                            {selectedId === option.id && (
                              <DsIcon
                                icon={Check}
                                className="text-ds-accent-default-default"
                              />
                            )}
                          </DropdownMenuItem>
                        ))}
                    </DropdownMenuGroup>
                  </div>
                );
              }
            )}
            {!options.length && !inventory.loading && !inventory.error && (
              <DropdownMenuLabel>
                {t('setting.not-configured')}
              </DropdownMenuLabel>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
