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
  proxyActivateTrigger,
  proxyDeactivateTrigger,
  proxyDeleteTrigger,
} from '@/service/triggerApi';
import { Trigger, TriggerStatus, TriggerType } from '@/types';
import { Zap } from 'lucide-react';
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

export default function Triggers() {
  const { t } = useTranslation();
  const {
    viewMode,
    searchQuery,
    sortBy,
    sortDirection,
    triggers,
    triggersLoading,
    reloadTriggers,
  } = useHomeHub();
  const { openTrigger } = useHomeHubNavigation();

  const filteredTriggers = useMemo(() => {
    const filtered = !searchQuery.trim()
      ? triggers
      : triggers.filter((trigger) =>
          matchesHubNameSearch(searchQuery, trigger.name)
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
  }, [triggers, searchQuery, sortBy, sortDirection]);

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
    return (
      <div className="min-w-0 flex w-full flex-col">
        <div className="pb-12 text-body-sm text-ds-text-neutral-muted-default">
          {t('layout.loading')}
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 flex w-full flex-col">
      <div className="mb-12 min-w-0 w-full">
        {triggers.length === 0 ? (
          <div className="p-8 flex flex-col items-center justify-center text-center">
            <Zap className="mb-4 h-12 w-12 text-ds-icon-neutral-muted-default" />
            <div className="text-sm text-ds-text-neutral-muted-default">
              {t('triggers.no-triggers') || t('layout.triggers')}
            </div>
          </div>
        ) : filteredTriggers.length === 0 ? (
          <div className="p-8 flex flex-col items-center justify-center text-center">
            <div className="text-sm text-ds-text-neutral-muted-default">
              {t('layout.search-no-results')}
            </div>
          </div>
        ) : viewMode === 'board' ? (
          <HomeHubBoard columns={boardColumns} />
        ) : viewMode === 'grid' ? (
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
