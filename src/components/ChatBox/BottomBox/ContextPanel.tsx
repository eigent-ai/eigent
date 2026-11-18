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

import { fetchConnectedProviders, providerLabel } from '@/api/connectors';
import { proxyFetchGet } from '@/api/http';
import ellipseIcon from '@/assets/mcp/Ellipse-25.svg';
import { DsIcon } from '@/components/ui/ds-icon';
import {
  useIntegrationManagement,
  type IntegrationItem,
} from '@/hooks/useIntegrationManagement';
import { shouldExposeBuiltInConnector } from '@/lib/builtInConnectorPolicy';
import { rememberConnectorChipIcon } from '@/lib/connectorChipIcon';
import { integrationLeadingIconUrl } from '@/lib/connectorIcons';
import { connectorNameToToken } from '@/lib/richText';
import { skillNameToDirName } from '@/lib/skillToolkit';
import { cn } from '@/lib/utils';
import { useServerCapabilityStore } from '@/store/serverCapabilityStore';
import { openSettings } from '@/store/settingsStore';
import { useSkillsStore } from '@/store/skillsStore';
import {
  Check,
  Paperclip,
  Settings2,
  WandSparkles,
  Wrench,
} from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

/**
 * A skill or connector the menu can add. `token` is the exact string inserted
 * inline into the rich chat input (`#skill` / `@connector`).
 */
export interface ContextItem {
  id: string;
  name: string;
  token: string;
  source: 'skill' | 'gateway' | 'builtin' | 'mcp';
  /** Provider icon URL for hosted connector items. */
  iconUrl?: string;
}

/** Built-in integrations excluded from the connector list (mirrors settings). */
const EXCLUDED_BUILTIN_CONNECTORS = ['Search', 'RAG'];

/** The user's enabled skills from the skills store. */
function useSkillItems(): ContextItem[] {
  const skills = useSkillsStore((s) => s.skills);
  return useMemo(
    () =>
      skills
        .filter((s) => s.enabled)
        .map((s) => ({
          id: `skill-${s.id}`,
          name: s.name,
          token: `#${s.skillDirName || skillNameToDirName(s.name)}`,
          source: 'skill' as const,
        })),
    [skills]
  );
}

/**
 * Connected connectors only, matching the Connectors page sidebar: connected
 * hosted connectors (when the Connector Gateway is enabled), connected built-in
 * integrations (`/api/v1/config/info` + configs), and the user's enabled MCPs
 * (`/api/v1/mcp/users`), in that order.
 */
function useConnectorItems(): { items: ContextItem[]; loading: boolean } {
  const [builtInItems, setBuiltInItems] = useState<IntegrationItem[]>([]);
  const [gatewayItems, setGatewayItems] = useState<ContextItem[]>([]);
  const [mcpItems, setMcpItems] = useState<ContextItem[]>([]);
  const [loading, setLoading] = useState(true);

  const capabilities = useServerCapabilityStore((state) => state.capabilities);
  const capabilityStatus = useServerCapabilityStore((state) => state.status);
  const fetchCapabilities = useServerCapabilityStore(
    (state) => state.fetchCapabilities
  );
  const gatewayEnabled =
    capabilities.features.connector_gateway.enabled === true;

  // Reuse the Connectors page's connected-state rules (OAuth tokens, config
  // groups, Google Search defaults) instead of duplicating them here.
  const { installed } = useIntegrationManagement(builtInItems);

  useEffect(() => {
    void fetchCapabilities();
  }, [fetchCapabilities]);

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
          setBuiltInItems(
            Object.keys(infoRes.value)
              .filter((key) => !EXCLUDED_BUILTIN_CONNECTORS.includes(key))
              .map((key) => ({
                key,
                name: key,
                desc: '',
                env_vars: [],
                onInstall: () => undefined,
              }))
          );
        }
        if (usersRes.status === 'fulfilled') {
          const list = Array.isArray(usersRes.value)
            ? usersRes.value
            : (usersRes.value?.items ?? []);
          setMcpItems(
            list
              .filter((item: { status?: number }) => Number(item.status) === 1)
              .map((item: { id: number; mcp_name: string }) => ({
                id: `mcp-${item.id}`,
                name: item.mcp_name,
                token: connectorNameToToken(item.mcp_name),
                source: 'mcp' as const,
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

  useEffect(() => {
    if (capabilityStatus !== 'ready' || !gatewayEnabled) {
      setGatewayItems([]);
      return;
    }
    let cancelled = false;
    fetchConnectedProviders()
      .then((providers) => {
        if (cancelled) return;
        setGatewayItems(
          providers.map((provider) => ({
            id: `gateway-${provider.service}`,
            name: providerLabel(provider),
            token: connectorNameToToken(providerLabel(provider)),
            source: 'gateway' as const,
            iconUrl: provider.iconUrl || undefined,
          }))
        );
      })
      .catch(() => {
        if (!cancelled) setGatewayItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [capabilityStatus, gatewayEnabled]);

  const builtIn = useMemo(
    () =>
      builtInItems
        .filter((item) =>
          shouldExposeBuiltInConnector(item.key, gatewayEnabled)
        )
        .filter((item) => installed[item.key])
        .map((item) => ({
          id: `builtin-${item.key}`,
          name: item.name,
          token: connectorNameToToken(item.key),
          source: 'builtin' as const,
        })),
    [builtInItems, gatewayEnabled, installed]
  );

  // Hosted connectors' logos only arrive from the API; record them so the
  // tag inserted into the prompt can show the same logo.
  useEffect(() => {
    for (const item of gatewayItems) {
      if (item.iconUrl) rememberConnectorChipIcon(item.token, item.iconUrl);
    }
  }, [gatewayItems]);

  return {
    items: [...gatewayItems, ...builtIn, ...mcpItems],
    loading,
  };
}

/** Leading mark for a row: the skill glyph or the connector's own logo. */
function ContextItemLogo({ item }: { item: ContextItem }) {
  if (item.source === 'skill') {
    return <DsIcon icon={WandSparkles} className="text-ds-ink-muted-default" />;
  }
  if (item.source === 'mcp') {
    return <DsIcon icon={Wrench} className="text-ds-ink-muted-default" />;
  }
  const iconUrl =
    item.source === 'gateway'
      ? item.iconUrl
      : integrationLeadingIconUrl(item.name);
  return iconUrl ? (
    <img src={iconUrl} alt="" className="h-4 w-4 object-contain" />
  ) : (
    <img src={ellipseIcon} alt="" className="h-3 w-3" />
  );
}

const SECTION_LABEL_CLASS =
  'block px-2 pt-1.5 pb-0.5 text-ds-text-meta font-bold text-ds-ink-muted-default';

/** One selectable line in the panel, in display order. */
type ContextRow =
  | { kind: 'upload'; id: string; label: string; disabled: boolean }
  | { kind: 'item'; id: string; item: ContextItem; added: boolean }
  | { kind: 'manage'; id: string; label: string; onSelect: () => void };

function matchesQuery(text: string, needle: string): boolean {
  return text.toLowerCase().includes(needle);
}

function filterItems(items: ContextItem[], needle: string): ContextItem[] {
  if (!needle) return items;
  return items.filter(
    (item) =>
      matchesQuery(item.name, needle) ||
      matchesQuery(item.token.slice(1), needle)
  );
}

/** Imperative controls the composer uses while its text field has focus. */
export interface ContextPanelHandle {
  /** Moves the highlighted row by `delta`, wrapping at either end. */
  move: (delta: number) => void;
  /** Chooses the highlighted row. Returns false when no row is highlighted. */
  pick: () => boolean;
}

export interface ContextPanelProps {
  /** DOM id of the list, referenced by the text field's `aria-controls`. */
  listId: string;
  /** Text typed into the composer since the panel opened; filters every row. */
  query: string;
  /** Current input text; a skill or connector is added when its token is in it. */
  inputValue: string;
  /** Disables the upload row (privacy off, attachments not allowed). */
  uploadDisabled?: boolean;
  onUpload: () => void;
  /** Adds the item's token to the input, or removes it when already added. */
  onPickItem: (item: ContextItem) => void;
  /** The highlighted row's DOM id, for the text field's `aria-activedescendant`. */
  onActiveRowChange?: (rowId: string | undefined) => void;
}

/**
 * Floating "add context" panel above the composer: upload files, then skills,
 * then connectors. The composer's own text field is its search box — whatever
 * is typed after the panel opens filters every section, the arrow keys move
 * the highlight and Enter adds the highlighted row.
 */
export const ContextPanel = forwardRef<ContextPanelHandle, ContextPanelProps>(
  function ContextPanel(
    {
      listId,
      query,
      inputValue,
      uploadDisabled = false,
      onUpload,
      onPickItem,
      onActiveRowChange,
    },
    ref
  ) {
    const { t } = useTranslation();
    const skills = useSkillItems();
    const connectors = useConnectorItems();
    const needle = query.trim().toLowerCase();

    const uploadLabel = t('chat.input-attach-add-files-or-photos');
    const skillRows = filterItems(skills, needle);
    const connectorRows = filterItems(connectors.items, needle);
    const showUpload = !needle || matchesQuery(uploadLabel, needle);
    const connectorsLoading =
      connectors.loading && connectors.items.length === 0;

    const toItemRow = (item: ContextItem): ContextRow => ({
      kind: 'item',
      id: `${listId}-${item.id}`,
      item,
      added: inputValue.includes(item.token),
    });

    // Empty sections offer their settings page, but only while not searching:
    // a search with no hits says so once for the whole panel instead.
    const skillSection: ContextRow[] =
      skillRows.length > 0
        ? skillRows.map(toItemRow)
        : needle
          ? []
          : [
              {
                kind: 'manage',
                id: `${listId}-manage-skills`,
                label: t('chat.input-attach-manage-skills'),
                onSelect: () => openSettings('skills'),
              },
            ];
    const connectorSection: ContextRow[] =
      connectorRows.length > 0
        ? connectorRows.map(toItemRow)
        : needle || connectorsLoading
          ? []
          : [
              {
                kind: 'manage',
                id: `${listId}-manage-connectors`,
                label: t('chat.input-attach-manage-connectors'),
                onSelect: () => openSettings('connectors'),
              },
            ];
    const uploadRows: ContextRow[] = showUpload
      ? [
          {
            kind: 'upload',
            id: `${listId}-upload`,
            label: uploadLabel,
            disabled: uploadDisabled,
          },
        ]
      : [];

    const rows = [...uploadRows, ...skillSection, ...connectorSection];
    const selectable = rows.filter(
      (row) => !(row.kind === 'upload' && row.disabled)
    );

    // Searching highlights the best match so Enter adds it; with no search
    // text nothing is highlighted, so Enter still sends the message.
    const [activeId, setActiveId] = useState<string | undefined>(undefined);
    const firstSelectableId = selectable[0]?.id;
    useEffect(() => {
      setActiveId(needle ? firstSelectableId : undefined);
    }, [needle, firstSelectableId]);
    const activeRow = selectable.find((row) => row.id === activeId);

    useEffect(() => {
      onActiveRowChange?.(activeRow?.id);
    }, [activeRow?.id, onActiveRowChange]);

    useEffect(() => {
      if (!activeRow) return;
      document
        .getElementById(activeRow.id)
        ?.scrollIntoView?.({ block: 'nearest' });
    }, [activeRow]);

    const choose = (row: ContextRow) => {
      if (row.kind === 'upload') {
        if (!row.disabled) onUpload();
      } else if (row.kind === 'item') {
        onPickItem(row.item);
      } else {
        row.onSelect();
      }
    };

    useImperativeHandle(ref, () => ({
      move: (delta) => {
        if (selectable.length === 0) return;
        const current = selectable.findIndex((row) => row.id === activeId);
        const next =
          current === -1
            ? delta > 0
              ? 0
              : selectable.length - 1
            : (current + delta + selectable.length) % selectable.length;
        setActiveId(selectable[next].id);
      },
      pick: () => {
        if (!activeRow) return false;
        choose(activeRow);
        return true;
      },
    }));

    const renderRow = (row: ContextRow) => {
      const active = row.id === activeRow?.id;
      const disabled = row.kind === 'upload' && row.disabled;
      let leading: ReactNode;
      let label: ReactNode;
      if (row.kind === 'item') {
        leading = <ContextItemLogo item={row.item} />;
        label = row.item.name;
      } else {
        leading = (
          <DsIcon
            icon={row.kind === 'upload' ? Paperclip : Settings2}
            className="text-ds-ink-muted-default"
          />
        );
        label = row.label;
      }
      return (
        <div
          key={row.id}
          id={row.id}
          role="option"
          aria-selected={active}
          aria-disabled={disabled || undefined}
          title={row.kind === 'item' ? row.item.token : undefined}
          className={cn(
            'flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-ds-text-base transition-colors',
            disabled
              ? 'cursor-default opacity-50'
              : 'cursor-pointer hover:bg-ds-neutral-default-default',
            active && 'bg-ds-neutral-default-default',
            row.kind === 'manage'
              ? 'text-ds-ink-muted-default'
              : 'text-ds-ink-default-default'
          )}
          // Keep the caret in the composer, which is also the search field.
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={() => {
            if (!disabled && !active) setActiveId(row.id);
          }}
          onClick={() => choose(row)}
        >
          <span
            aria-hidden
            className="flex size-5 shrink-0 items-center justify-center"
          >
            {leading}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
          {row.kind === 'item' && row.added && (
            <DsIcon
              icon={Check}
              aria-hidden
              className="shrink-0 text-ds-icon-success-default-default"
            />
          )}
        </div>
      );
    };

    const renderSection = (
      id: string,
      title: string,
      sectionRows: ContextRow[],
      loading = false
    ) => {
      if (sectionRows.length === 0 && !loading) return null;
      const headingId = `${listId}-${id}-heading`;
      return (
        <div
          role="group"
          aria-labelledby={headingId}
          className="flex flex-col gap-0.5"
        >
          <span id={headingId} className={SECTION_LABEL_CLASS}>
            {title}
          </span>
          {sectionRows.map(renderRow)}
          {loading &&
            [0, 1].map((i) => (
              <div
                key={i}
                aria-hidden
                className="h-8 w-full animate-pulse rounded-xl bg-ds-neutral-default-default motion-reduce:animate-none"
              />
            ))}
        </div>
      );
    };

    const noMatches =
      needle &&
      rows.length === 0 &&
      !(connectors.loading && connectors.items.length === 0);

    return (
      <div className="flex w-full flex-col overflow-hidden rounded-2xl border border-x border-y border-solid border-ds-hairline-default-default bg-ds-neutral-subtle-default">
        <div
          id={listId}
          role="listbox"
          aria-label={t('chat.input-add-context')}
          className="scrollbar-always-visible flex max-h-[240px] flex-col gap-1 overflow-y-auto p-1"
        >
          {uploadRows.map(renderRow)}
          {renderSection('skills', t('chat.input-attach-skills'), skillSection)}
          {renderSection(
            'connectors',
            t('chat.input-attach-connectors'),
            connectorSection,
            connectorsLoading && !needle
          )}
          {noMatches && (
            <div className="px-2 py-2 text-ds-text-meta text-ds-ink-muted-default">
              {t('chat.input-context-no-matches', { query: query.trim() })}
            </div>
          )}
        </div>
      </div>
    );
  }
);
