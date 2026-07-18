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

import { proxyFetchGet } from '@/api/http';
import ellipseIcon from '@/assets/mcp/Ellipse-25.svg';
import { Button } from '@/components/ui/button';
import { integrationLeadingIconUrl } from '@/lib/connectorIcons';
import {
  RICH_CONNECTOR_STYLE_CLASSES,
  RICH_SKILL_STYLE_CLASSES,
  connectorNameToToken,
  hashSkillLabel,
} from '@/lib/richText';
import { skillNameToDirName } from '@/lib/skillToolkit';
import { cn } from '@/lib/utils';
import { useSkillsStore } from '@/store/skillsStore';
import { Check, Plus, Wrench } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

/**
 * An item shown in a picker panel. `token` is the exact string inserted inline
 * into the rich chat input when the item is selected (`#skill` / `@connector`).
 */
export interface PickerItem {
  id: string;
  name: string;
  token: string;
}

/** A labelled section within a picker (e.g. built-in vs. your own connectors). */
export interface PickerGroup {
  id: string;
  /** Section heading; omit for a single ungrouped list (e.g. skills). */
  label?: string;
  items: PickerItem[];
}

interface PickerPanelProps {
  title: string;
  groups: PickerGroup[];
  /** Current input text — an item is "added" when its token appears in it. */
  inputValue: string;
  onToggleItem: (item: PickerItem) => void;
  /** Leading token tag for a row (`#skill` / `@connector`). */
  renderTag: (item: PickerItem) => ReactNode;
  /** Leading logo/icon for a row, shown before the item name. Omit for no logo. */
  renderLogo?: (item: PickerItem) => ReactNode;
  loading?: boolean;
  emptyLabel: string;
  emptyActionLabel: string;
  onEmptyAction: () => void;
}

/**
 * Floating list panel shown above BoxMain in the BottomBox shell. Selecting an
 * item inserts its token inline into the input; selecting an added item removes
 * it. Purely presentational — the trigger and open state live in BottomBox.
 */
export function PickerPanel({
  title,
  groups,
  inputValue,
  onToggleItem,
  renderTag,
  renderLogo,
  loading = false,
  emptyLabel,
  emptyActionLabel,
  onEmptyAction,
}: PickerPanelProps) {
  const nonEmptyGroups = groups.filter((g) => g.items.length > 0);
  const totalItems = nonEmptyGroups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="flex w-full flex-col overflow-hidden rounded-2xl border border-solid border-ds-border-neutral-default-default bg-ds-bg-neutral-subtle-default">
      {/* Header */}
      <div className="flex items-center gap-1 px-3 pb-1 pt-2">
        <span className="text-xs font-bold text-ds-text-neutral-muted-default">
          {title}
        </span>
        {totalItems > 0 && (
          <span className="text-xs font-bold text-ds-text-neutral-muted-default">
            {totalItems}
          </span>
        )}
      </div>

      {/* List: max-h-[240px] caps the panel's scrollable area */}
      <div className="scrollbar-always-visible flex max-h-[240px] flex-col gap-0.5 overflow-y-auto p-1">
        {loading ? (
          <>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-8 w-full animate-pulse rounded-lg bg-ds-bg-neutral-strong-default"
              />
            ))}
          </>
        ) : totalItems === 0 ? (
          <div className="flex w-full items-center justify-between gap-2 px-2 py-2">
            <span className="text-xs font-normal text-ds-text-neutral-muted-default">
              {emptyLabel}
            </span>
            <Button
              variant="ghost"
              size="xs"
              buttonContent="text"
              onClick={onEmptyAction}
            >
              {emptyActionLabel}
            </Button>
          </div>
        ) : (
          nonEmptyGroups.map((group) => (
            <Fragment key={group.id}>
              {group.label && (
                <div className="px-2 pb-0.5 pt-1.5 text-xs font-bold text-ds-text-neutral-muted-default">
                  {group.label}
                </div>
              )}
              {group.items.map((item) => (
                <PickerPanelItem
                  key={item.id}
                  item={item}
                  tag={renderTag(item)}
                  logo={renderLogo?.(item)}
                  added={inputValue.includes(item.token)}
                  onToggle={() => onToggleItem(item)}
                />
              ))}
            </Fragment>
          ))
        )}
      </div>
    </div>
  );
}

interface PickerPanelItemProps {
  item: PickerItem;
  tag: ReactNode;
  logo?: ReactNode;
  added: boolean;
  onToggle: () => void;
}

function PickerPanelItem({
  item,
  tag,
  logo,
  added,
  onToggle,
}: PickerPanelItemProps) {
  return (
    <button
      type="button"
      aria-pressed={added}
      className="group flex w-full items-center gap-2 rounded-xl border-0 bg-ds-bg-neutral-subtle-default px-2 py-1.5 text-left transition-colors hover:bg-ds-bg-neutral-default-default"
      onClick={onToggle}
    >
      {logo && (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
          {logo}
        </span>
      )}
      <span className="min-w-0 flex-1 overflow-hidden overflow-ellipsis whitespace-nowrap text-sm font-medium text-ds-text-neutral-default-default">
        {item.name}
      </span>
      <span className="max-w-[45%] shrink-0 overflow-hidden whitespace-nowrap">
        {tag}
      </span>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        {added ? (
          <Check size={16} className="text-ds-icon-success-default-default" />
        ) : (
          <Plus
            size={16}
            className="text-ds-icon-neutral-muted-default opacity-0 transition-opacity group-hover:opacity-100"
          />
        )}
      </span>
    </button>
  );
}

interface WiredPickerPanelProps {
  inputValue: string;
  onToggleItem: (item: PickerItem) => void;
}

/** Built-in integrations excluded from the MCP connector list (mirrors settings). */
const EXCLUDED_BUILTIN_CONNECTORS = ['Search', 'RAG'];

/**
 * Full connector list matching the Connectors settings page: built-in
 * integrations (`/api/v1/config/info`) plus the user's own MCPs
 * (`/api/v1/mcp/users`), shown as two labelled sections.
 */
export function ConnectorPickerPanel({
  inputValue,
  onToggleItem,
}: WiredPickerPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [builtIn, setBuiltIn] = useState<PickerItem[]>([]);
  const [yourMcps, setYourMcps] = useState<PickerItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      proxyFetchGet('/api/v1/config/info'),
      proxyFetchGet('/api/v1/mcp/users'),
    ])
      .then(([infoRes, usersRes]) => {
        if (cancelled) return;
        if (
          infoRes.status === 'fulfilled' &&
          infoRes.value &&
          typeof infoRes.value === 'object'
        ) {
          setBuiltIn(
            Object.keys(infoRes.value)
              .filter((key) => !EXCLUDED_BUILTIN_CONNECTORS.includes(key))
              .map((key) => ({
                id: `builtin-${key}`,
                name: key,
                token: connectorNameToToken(key),
              }))
          );
        }
        if (usersRes.status === 'fulfilled') {
          const list = Array.isArray(usersRes.value)
            ? usersRes.value
            : (usersRes.value?.items ?? []);
          setYourMcps(
            list.map((item: { id: number; mcp_name: string }) => ({
              id: `user-${item.id}`,
              name: item.mcp_name,
              token: connectorNameToToken(item.mcp_name),
            }))
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const groups: PickerGroup[] = [
    {
      id: 'builtin',
      label: t('setting.mcp-sidebar-built-in'),
      items: builtIn,
    },
    { id: 'yours', label: t('setting.your-own-mcps'), items: yourMcps },
  ];

  return (
    <PickerPanel
      title={t('chat.input-attach-connectors')}
      groups={groups}
      inputValue={inputValue}
      onToggleItem={onToggleItem}
      renderTag={(item) => (
        <span
          className={cn(
            'rounded px-1 py-px text-xs font-medium',
            RICH_CONNECTOR_STYLE_CLASSES
          )}
        >
          {item.token}
        </span>
      )}
      renderLogo={(item) => {
        if (!item.id.startsWith('builtin-')) {
          return (
            <Wrench size={16} className="text-ds-icon-neutral-muted-default" />
          );
        }
        const iconUrl = integrationLeadingIconUrl(item.name);
        return iconUrl ? (
          <img src={iconUrl} alt="" className="h-4 w-4 object-contain" />
        ) : (
          <img src={ellipseIcon} alt="" className="h-3 w-3" />
        );
      }}
      loading={loading}
      emptyLabel={t('chat.no-connectors-added')}
      emptyActionLabel={t('chat.input-attach-manage-connectors')}
      onEmptyAction={() => navigate('/history?tab=connectors')}
    />
  );
}

/** Lists the user's enabled skills from the skills store. */
export function SkillPickerPanel({
  inputValue,
  onToggleItem,
}: WiredPickerPanelProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const skills = useSkillsStore((s) => s.skills);

  const items = useMemo(
    () =>
      skills
        .filter((s) => s.enabled)
        .map((s) => ({
          id: s.id,
          name: s.name,
          token: `#${s.skillDirName || skillNameToDirName(s.name)}`,
        })),
    [skills]
  );

  return (
    <PickerPanel
      title={t('chat.input-attach-skills')}
      groups={[{ id: 'skills', items }]}
      inputValue={inputValue}
      onToggleItem={onToggleItem}
      renderTag={(item) => {
        const clsIdx =
          hashSkillLabel(item.token) % RICH_SKILL_STYLE_CLASSES.length;
        return (
          <span
            className={cn(
              'rounded px-1 py-px text-xs font-medium',
              RICH_SKILL_STYLE_CLASSES[clsIdx]
            )}
          >
            {item.token}
          </span>
        );
      }}
      emptyLabel={t('chat.no-skills-added')}
      emptyActionLabel={t('chat.input-attach-manage-skills')}
      onEmptyAction={() => navigate('/history?tab=agents')}
    />
  );
}
