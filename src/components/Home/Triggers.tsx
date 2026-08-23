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

import { AUTOMATION_ICON } from '@/lib/triggerIcon';
import {
  proxyActivateTrigger,
  proxyDeactivateTrigger,
  proxyDeleteTrigger,
} from '@/service/triggerApi';
import { Trigger, TriggerStatus, TriggerType } from '@/types';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import HomeHubBoard from './components/HomeHubBoard';
import HomeHubBoardCard from './components/HomeHubBoardCard';
import HomeHubCard from './components/HomeHubCard';
import HomeHubGrid from './components/HomeHubGrid';
import HomeHubListItem from './components/HomeHubListItem';
import HomeHubListTable from './components/HomeHubListTable';
import { useHomeHub } from './context';
import { useHomeHubNavigation } from './hooks/useHomeHubNavigation';
import { useSpaceLabel } from './hooks/useSpaceLabel';
import { SpaceDetailListSkeleton } from './SpaceDetailLoadingSkeleton';
import {
  compareHubByName,
  compareHubByTimestamp,
  matchesHubNameSearch,
} from './utils';
import { getTriggerBoardColumn, groupByBoardColumn } from './utils/boardStatus';

function getTriggerTypeLabel(
  trigger: Trigger,
  t: (key: string, options?: Record<string, unknown>) => string
) {
  if (trigger.trigger_type === TriggerType.Schedule) {
    return t('triggers.schedule-trigger');
  }
  return t('triggers.app-trigger');
}

function TriggerRow({
  trigger,
  viewMode,
  onEdit,
  onDelete,
  onToggleActive,
}: {
  trigger: Trigger;
  viewMode: 'grid' | 'list' | 'board';
  onEdit: (trigger: Trigger) => void;
  onDelete: (trigger: Trigger) => void;
  onToggleActive: (trigger: Trigger) => void;
}) {
  const { t } = useTranslation();
  const spaceLabel = useSpaceLabel(trigger.space_id);
  const sharedProps = {
    kind: 'trigger' as const,
    trigger,
    spaceLabel,
    triggerTypeLabel: getTriggerTypeLabel(trigger, t),
    onEdit,
    onDelete,
    onToggleActive,
  };

  return viewMode === 'list' ? (
    <HomeHubListItem {...sharedProps} />
  ) : viewMode === 'board' ? (
    <HomeHubBoardCard {...sharedProps} />
  ) : (
    <HomeHubCard {...sharedProps} />
  );
}

interface TriggersProps {
  triggersOverride?: Trigger[];
  presentation?: 'home' | 'space-detail';
}

export default function Triggers({
  triggersOverride,
  presentation = 'home',
}: TriggersProps = {}) {
  const { t } = useTranslation();
  const {
    viewMode,
    searchQuery,
    sortBy,
    sortDirection,
    triggers: homeTriggers,
    triggersLoading,
    reloadTriggers,
  } = useHomeHub();
  const triggers = triggersOverride ?? homeTriggers;
  const effectiveViewMode = presentation === 'space-detail' ? 'list' : viewMode;
  const effectiveSearchQuery =
    presentation === 'space-detail' ? '' : searchQuery;
  const { openTrigger } = useHomeHubNavigation();

  const filteredTriggers = useMemo(() => {
    const filtered = !effectiveSearchQuery.trim()
      ? triggers
      : triggers.filter((trigger) =>
          matchesHubNameSearch(effectiveSearchQuery, trigger.name)
        );

    return [...filtered].sort((a, b) => {
      if (sortBy === 'name') {
        return compareHubByName(a.name, b.name, sortDirection);
      }
      if (sortBy === 'updated') {
        return compareHubByTimestamp(
          a.updated_at || a.last_executed_at || a.created_at,
          b.updated_at || b.last_executed_at || b.created_at,
          sortDirection
        );
      }
      return compareHubByTimestamp(a.created_at, b.created_at, sortDirection);
    });
  }, [effectiveSearchQuery, sortBy, sortDirection, triggers]);

  const handleEditTrigger = useCallback(
    (trigger: Trigger) => {
      void openTrigger(trigger);
    },
    [openTrigger]
  );

  const handleToggleActive = useCallback(
    async (trigger: Trigger) => {
      try {
        if (trigger.status === TriggerStatus.Active) {
          await proxyDeactivateTrigger(trigger.id);
        } else {
          await proxyActivateTrigger(trigger.id);
        }
        void reloadTriggers();
      } catch (error) {
        console.error('Failed to toggle trigger:', error);
      }
    },
    [reloadTriggers]
  );

  const handleDelete = useCallback(
    async (trigger: Trigger) => {
      try {
        await proxyDeleteTrigger(trigger.id);
        void reloadTriggers();
      } catch (error) {
        console.error('Failed to delete trigger:', error);
      }
    },
    [reloadTriggers]
  );

  const renderTriggerRow = useCallback(
    (trigger: Trigger, mode: 'grid' | 'list' | 'board') => (
      <TriggerRow
        key={trigger.id}
        trigger={trigger}
        viewMode={mode}
        onEdit={handleEditTrigger}
        onDelete={handleDelete}
        onToggleActive={handleToggleActive}
      />
    ),
    [handleDelete, handleEditTrigger, handleToggleActive]
  );

  const boardColumns = useMemo(() => {
    const grouped = groupByBoardColumn(filteredTriggers, getTriggerBoardColumn);

    return {
      default: grouped.default.map((trigger) =>
        renderTriggerRow(trigger, 'board')
      ),
      running: grouped.running.map((trigger) =>
        renderTriggerRow(trigger, 'board')
      ),
      awaiting_review: grouped.awaiting_review.map((trigger) =>
        renderTriggerRow(trigger, 'board')
      ),
    };
  }, [filteredTriggers, renderTriggerRow]);

  if (triggersLoading) {
    if (presentation === 'space-detail') {
      return <SpaceDetailListSkeleton kind="trigger" />;
    }
    return (
      <div className="flex w-full min-w-0 flex-col">
        <div className="pb-12 text-ds-text-base text-ds-ink-muted-default">
          {t('layout.loading')}
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-col">
      <div className="mb-12 w-full min-w-0">
        {triggers.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <AUTOMATION_ICON className="mb-4 h-12 w-12 text-ds-ink-muted-default" />
            <div className="text-sm text-ds-ink-muted-default">
              {t('triggers.no-triggers') || t('layout.triggers')}
            </div>
          </div>
        ) : filteredTriggers.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <div className="text-sm text-ds-ink-muted-default">
              {t('layout.search-no-results')}
            </div>
          </div>
        ) : effectiveViewMode === 'board' ? (
          <HomeHubBoard columns={boardColumns} />
        ) : effectiveViewMode === 'grid' ? (
          <HomeHubGrid>
            {filteredTriggers.map((trigger) =>
              renderTriggerRow(trigger, 'grid')
            )}
          </HomeHubGrid>
        ) : (
          <HomeHubListTable kind="trigger">
            {filteredTriggers.map((trigger) =>
              renderTriggerRow(trigger, 'list')
            )}
          </HomeHubListTable>
        )}
      </div>
    </div>
  );
}
