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

import SearchInput from '@/components/Dashboard/SearchInput';
import CollectionToolbar, {
  COLLECTION_TOOLBAR_SEARCH_CLASS,
} from '@/components/Layout/CollectionToolbar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DS_FOCUS_RING } from '@/components/ui/semanticProps';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TooltipSimple } from '@/components/ui/tooltip';
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Bell,
  Folder,
  RefreshCw,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import SettingsSectionLoading from '../SettingsSectionLoading';
import SettingsSectionPage from '../SettingsSectionPage';
import SkillAccessMenu from './components/SkillAccessMenu';
import SkillAccessTag from './components/SkillAccessTag';
import SkillActions from './components/SkillActions';
import SkillsDashboard from './components/SkillsDashboard';
import SkillSourceTag from './components/SkillSourceTag';
import {
  filterSkillLibrary,
  getSkillLibrarySubtitle,
  type SkillLibraryFilter,
} from './skillLibrary';
import { useSkillsLibrary } from './SkillsProvider';

// The Space list's filled row surface, applied to table cells so the outside
// corners and hover outline stay continuous without dividers between cells.
const SKILL_TABLE_ROW_CLASS = [
  'cursor-pointer border-0 border-x-0 border-y-0 bg-transparent hover:bg-transparent data-[state=selected]:bg-transparent',
  '[&>td]:border-x-0 [&>td]:border-y [&>td]:border-solid [&>td]:border-transparent',
  '[&>td]:bg-ds-neutral-default-default [&>td]:transition-colors [&>td]:duration-150 motion-reduce:[&>td]:transition-none',
  '[&>td:first-child]:rounded-s-ds-field [&>td:first-child]:border-x-0 [&>td:first-child]:border-y [&>td:first-child]:border-s [&>td:first-child]:border-e-0',
  '[&>td:last-child]:rounded-e-ds-field [&>td:last-child]:border-x-0 [&>td:last-child]:border-y [&>td:last-child]:border-s-0 [&>td:last-child]:border-e',
  '[&:hover>td]:border-ds-hairline-subtle-default [&:hover>td]:bg-ds-neutral-default-hover',
  'data-[state=selected]:[&>td]:bg-ds-neutral-muted-default',
].join(' ');

export default function Skills() {
  const { t } = useTranslation();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus({ preventScroll: true }), []);
  const {
    entries,
    spaces,
    loading,
    errors,
    refresh,
    openUpload,
    updateGlobal,
    updateGlobalMany,
    pendingIds,
  } = useSkillsLibrary();
  const [params, setParams] = useSearchParams();
  const query = params.get('skillSearch') || '';
  const filterValue = params.get('skillFilter');
  const filter: SkillLibraryFilter =
    filterValue === 'global' ||
    filterValue === 'builtin' ||
    filterValue === 'space'
      ? filterValue
      : 'all';
  const status = params.get('skillStatus') || 'all';
  // The Space picker only exists while the source filter is Space, so a
  // stale `skillSpace` in the URL must not silently hide global skills.
  const spaceId =
    filter === 'space' ? params.get('skillSpace') || 'all' : 'all';
  const descending = params.get('skillSort') === 'desc';
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [dismissedNoticeCount, setDismissedNoticeCount] = useState(0);
  const filtered = useMemo(
    () => filterSkillLibrary(entries, query, filter, status, spaceId),
    [entries, query, filter, status, spaceId]
  );
  const visible = descending ? [...filtered].reverse() : filtered;
  const actionable = visible.filter((entry) => entry.kind !== 'space');
  const selectedRows = actionable.filter((entry) => selected.has(entry.id));
  const allChecked =
    actionable.length > 0 && selectedRows.length === actionable.length;
  useEffect(() => setSelected(new Set()), [query, filter, status, spaceId]);
  useEffect(() => {
    if (!loading && errors.length === 0) {
      setNoticeDismissed(false);
      setDismissedNoticeCount(0);
    }
  }, [loading, errors.length]);
  const compactNoticeCount =
    errors.length > 0 ? errors.length : dismissedNoticeCount;
  const showNoticeBanner = errors.length > 0 && !noticeDismissed;
  const showCompactNotice = noticeDismissed && (errors.length > 0 || loading);
  const libraryBusy = loading || bulkPending || pendingIds.size > 0;
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === 'all' || !value) next.delete(key);
    else next.set(key, value);
    if (key === 'skillFilter' && value !== 'space') next.delete('skillSpace');
    setParams(next, { replace: true });
  };
  const skillSearch = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('skillId', id);
    return next.toString();
  };
  const setBulkEnabled = async (enabled: boolean) => {
    if (loading || bulkPending || pendingIds.size) return;
    setBulkPending(true);
    try {
      await updateGlobalMany(
        selectedRows
          .filter((entry) => entry.skill.enabled !== enabled)
          .map((entry) => entry.skill),
        { enabled }
      );
    } finally {
      setBulkPending(false);
    }
  };
  const sourceLabel = (kind: SkillLibraryFilter) =>
    t(`agents.library-filter-${kind}`);
  return (
    <SettingsSectionPage className="gap-ds-24 py-ds-24">
      <SkillsDashboard
        entries={entries}
        loading={loading}
        hasErrors={errors.length > 0}
      />
      <CollectionToolbar
        data-skills-toolbar
        aria-label={t('agents.library-toolbar')}
        title={t('agents.library-title')}
        headingLevel={1}
        headingRef={headingRef}
        count={
          <>
            <Badge variant="secondary" size="xs">
              {visible.length}
            </Badge>
            {showCompactNotice && (
              <TooltipSimple content={t('agents.library-retry')}>
                <Button
                  variant="secondary"
                  tone="information"
                  size="xs"
                  buttonRadius="full"
                  disabled={libraryBusy}
                  onClick={refresh}
                  aria-label={t('agents.library-retry-notice', {
                    count: compactNoticeCount,
                  })}
                >
                  <Bell />
                  {compactNoticeCount}
                </Button>
              </TooltipSimple>
            )}
          </>
        }
      >
        <div className={COLLECTION_TOOLBAR_SEARCH_CLASS}>
          <SearchInput
            value={query}
            onChange={(event) => setFilter('skillSearch', event.target.value)}
            ariaLabel={t('agents.library-search')}
            placeholder={t('agents.library-search')}
            clearOnEscape
          />
        </div>
        <Select
          value={filter}
          onValueChange={(value) => setFilter('skillFilter', value)}
        >
          <SelectTrigger
            size="xs"
            aria-label={t('agents.library-filter-label')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['all', 'global', 'builtin', 'space'] as const).map((kind) => (
              <SelectItem key={kind} value={kind}>
                {sourceLabel(kind)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filter === 'space' && (
          <Select
            value={spaceId}
            onValueChange={(value) => setFilter('skillSpace', value)}
          >
            <SelectTrigger
              size="xs"
              aria-label={t('agents.library-space-filter')}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t('agents.library-all-spaces')}
              </SelectItem>
              {spaces.map((space) => (
                <SelectItem key={space.id} value={space.id}>
                  {space.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Select
          value={status}
          onValueChange={(value) => setFilter('skillStatus', value)}
        >
          <SelectTrigger
            size="xs"
            aria-label={t('agents.library-status-filter')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {['all', 'enabled', 'disabled', 'profile'].map((value) => (
              <SelectItem key={value} value={value}>
                {t(`agents.library-status-${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="secondary"
          size="sm"
          buttonRadius="full"
          buttonContent="icon-only"
          disabled={loading || bulkPending || pendingIds.size > 0}
          onClick={refresh}
          aria-label={t('agents.library-refresh')}
        >
          <RefreshCw />
        </Button>
        <Button
          variant="primary"
          size="sm"
          buttonRadius="full"
          disabled={loading || bulkPending || pendingIds.size > 0}
          onClick={openUpload}
        >
          {t('agents.add-skill')}
        </Button>
      </CollectionToolbar>
      {showNoticeBanner && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-ds-8 rounded-ds-card bg-ds-bg-information-subtle-default p-ds-12 text-ds-text-information-strong-default"
        >
          <DsText className="m-0 flex-1 text-ds-text-information-strong-default">
            {errors.join(' ')}
          </DsText>
          <Button
            variant="outline"
            tone="information"
            size="sm"
            onClick={refresh}
            disabled={libraryBusy}
          >
            {t('agents.library-retry')}
          </Button>
          <Button
            variant="ghost"
            tone="information"
            size="sm"
            buttonContent="icon-only"
            onClick={() => {
              setDismissedNoticeCount(errors.length);
              setNoticeDismissed(true);
            }}
            aria-label={t('agents.library-dismiss-notice')}
          >
            <X />
          </Button>
        </div>
      )}
      {selectedRows.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-ds-8"
          aria-live="polite"
        >
          <DsText as="span">
            {t('agents.library-selected', { count: selectedRows.length })}
          </DsText>
          <Button
            variant="secondary"
            size="sm"
            disabled={loading || bulkPending || pendingIds.size > 0}
            onClick={() => void setBulkEnabled(true)}
          >
            {t('agents.library-enable-selected')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={loading || bulkPending || pendingIds.size > 0}
            onClick={() => void setBulkEnabled(false)}
          >
            {t('agents.library-disable-selected')}
          </Button>
        </div>
      )}
      {loading && entries.length === 0 ? (
        <SettingsSectionLoading label={t('agents.library-loading')} rows={5} />
      ) : (
        <div className="-m-ds-4 [&>div]:p-ds-4">
          <Table
            aria-label={t('agents.library-title')}
            containerClassName="scrollbar-always-visible"
            className="border-separate border-spacing-x-0 border-spacing-y-ds-4 text-start text-ds-text-base"
          >
            <TableHeader>
              <TableRow className="border-ds-hairline-subtle-default [&>th]:whitespace-nowrap">
                <TableHead className="text-start">
                  <label className="flex min-h-ds-control-sm items-center justify-start p-ds-4">
                    <Checkbox
                      aria-label={t('agents.library-select-all')}
                      disabled={!actionable.length || bulkPending}
                      checked={
                        allChecked
                          ? true
                          : selectedRows.length
                            ? 'indeterminate'
                            : false
                      }
                      onCheckedChange={(checked) =>
                        setSelected(
                          checked
                            ? new Set(actionable.map((entry) => entry.id))
                            : new Set()
                        )
                      }
                    />
                  </label>
                </TableHead>
                <TableHead
                  className="w-full text-start"
                  aria-sort={descending ? 'descending' : 'ascending'}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setFilter('skillSort', descending ? '' : 'desc')
                    }
                  >
                    {t('agents.library-name')}
                    {descending ? <ArrowUpAZ /> : <ArrowDownAZ />}
                  </Button>
                </TableHead>
                <TableHead className="text-start">
                  {t('agents.library-scope')}
                </TableHead>
                <TableHead className="text-start">
                  {t('agents.library-spaces-column')}
                </TableHead>
                <TableHead className="text-start">
                  {t('agents.library-agent-access-column')}
                </TableHead>
                <TableHead className="text-start">
                  {t('agents.library-status-filter')}
                </TableHead>
                <TableHead className="text-start">
                  <span className="sr-only">{t('layout.more-actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((entry) => (
                <TableRow
                  key={entry.id}
                  data-state={selected.has(entry.id) ? 'selected' : undefined}
                  className={SKILL_TABLE_ROW_CLASS}
                  onClick={() =>
                    setParams(skillSearch(entry.id), { replace: true })
                  }
                >
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    {entry.kind !== 'space' && (
                      <label className="flex min-h-ds-control-sm items-center justify-start p-ds-4">
                        <Checkbox
                          disabled={bulkPending}
                          aria-label={t('agents.library-select', {
                            name: entry.name,
                          })}
                          checked={selected.has(entry.id)}
                          onCheckedChange={(checked) =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (checked) next.add(entry.id);
                              else next.delete(entry.id);
                              return next;
                            })
                          }
                        />
                      </label>
                    )}
                  </TableCell>
                  <TableCell className="w-full max-w-0">
                    <Button
                      asChild
                      variant="text"
                      size="sm"
                      textWeight="medium"
                      className="w-full min-w-0 no-underline hover:no-underline"
                    >
                      <Link
                        to={{ search: `?${skillSearch(entry.id)}` }}
                        replace
                        title={entry.name}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <span className="min-w-0 truncate">{entry.name}</span>
                      </Link>
                    </Button>
                    {/* Supporting text for the row, deliberately outside the
                      link so the link's accessible name stays the skill name.
                      Padding matches Button `sm` so both lines align. */}
                    {getSkillLibrarySubtitle(entry) && (
                      <DsText
                        as="p"
                        role="meta"
                        title={getSkillLibrarySubtitle(entry)}
                        className="m-0 truncate px-[var(--ds-button-sm-padding-inline)] text-ds-ink-muted-default"
                      >
                        {getSkillLibrarySubtitle(entry)}
                      </DsText>
                    )}
                  </TableCell>
                  <TableCell>
                    <SkillSourceTag kind={entry.kind} />
                  </TableCell>
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <TooltipSimple
                      content={
                        entry.kind === 'space'
                          ? entry.spaceName
                          : t('agents.library-space-count-unavailable')
                      }
                    >
                      <span tabIndex={0} className={DS_FOCUS_RING}>
                        {/* Each profile package belongs to one Space. Global
                          copies have no recorded link to profile packages. */}
                        <span aria-hidden>
                          {entry.kind === 'space' ? 1 : '—'}
                        </span>
                        <span className="sr-only">
                          {entry.kind === 'space'
                            ? t('agents.library-space-count', { count: 1 })
                            : t('agents.library-space-count-unavailable')}
                        </span>
                      </span>
                    </TooltipSimple>
                  </TableCell>
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    {entry.kind === 'space' ? (
                      <SkillAccessTag
                        allAgents={!entry.assignTo.length}
                        agentCount={new Set(entry.assignTo).size}
                        title={entry.assignTo.join(', ')}
                      />
                    ) : (
                      <SkillAccessMenu skill={entry.skill} />
                    )}
                  </TableCell>
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    {entry.kind === 'space' ? (
                      <Badge variant="secondary" className="whitespace-nowrap">
                        {t('agents.library-status-profile')}
                      </Badge>
                    ) : (
                      <label className="flex items-center justify-start gap-ds-8 whitespace-nowrap">
                        <Switch
                          checked={entry.skill.enabled}
                          disabled={
                            loading ||
                            pendingIds.has(entry.skill.id) ||
                            bulkPending
                          }
                          onCheckedChange={(enabled) =>
                            void updateGlobal(entry.skill, { enabled })
                          }
                          aria-label={t('agents.library-enable', {
                            name: entry.name,
                          })}
                        />
                        <DsText as="span" role="meta">
                          {t(
                            entry.skill.enabled
                              ? 'agents.library-enabled'
                              : 'agents.library-disabled'
                          )}
                        </DsText>
                      </label>
                    )}
                  </TableCell>
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <SkillActions entry={entry} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {!loading && !visible.length && (
        <div className="flex flex-col items-center gap-ds-12 py-ds-40 text-center">
          <DsIcon icon={Folder} recipe="detailed" />
          <DsText className="m-0">
            {entries.length
              ? t('agents.library-no-results')
              : t('agents.library-empty')}
          </DsText>
          <Button
            variant="secondary"
            size="sm"
            disabled={!entries.length && pendingIds.size > 0}
            onClick={
              entries.length
                ? () => {
                    const next = new URLSearchParams(params);
                    [
                      'skillSearch',
                      'skillFilter',
                      'skillStatus',
                      'skillSpace',
                    ].forEach((key) => next.delete(key));
                    setParams(next, { replace: true });
                  }
                : openUpload
            }
          >
            {entries.length
              ? t('agents.library-clear-filters')
              : t('agents.add-skill')}
          </Button>
        </div>
      )}
      {entries.some((entry) => entry.kind === 'space') && (
        <DsText as="p" role="meta" className="m-0 text-ds-ink-muted-default">
          {t('agents.library-profile-note')}
        </DsText>
      )}
    </SettingsSectionPage>
  );
}
