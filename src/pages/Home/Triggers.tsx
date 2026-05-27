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
  proxyFetchTriggers,
} from '@/service/triggerApi';
import { Trigger, TriggerStatus, TriggerType } from '@/types';
import { Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import HomeHubCard from './components/HomeHubCard';
import HomeHubListItem from './components/HomeHubListItem';
import SectionHeader from './components/SectionHeader';
import { useHomeHub } from './context';
import { useHomeHubNavigation } from './hooks/useHomeHubNavigation';
import { useSpaceLabel } from './hooks/useSpaceLabel';
import { capitalizeLabel, matchesHubNameSearch } from './utils';

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
  viewMode: 'grid' | 'list';
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

  return viewMode === 'grid' ? (
    <HomeHubCard {...sharedProps} />
  ) : (
    <HomeHubListItem {...sharedProps} />
  );
}

export default function Triggers() {
  const { t } = useTranslation();
  const { viewMode, searchQuery } = useHomeHub();
  const { openTrigger } = useHomeHubNavigation();
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTriggers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await proxyFetchTriggers(undefined, undefined, 1, 100);
      setTriggers(response?.items ?? response ?? []);
    } catch (error) {
      console.error('Failed to load triggers:', error);
      setTriggers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTriggers();
  }, [loadTriggers]);

  const filteredTriggers = useMemo(() => {
    if (!searchQuery.trim()) return triggers;
    return triggers.filter((trigger) =>
      matchesHubNameSearch(searchQuery, trigger.name)
    );
  }, [triggers, searchQuery]);

  const handleEditTrigger = useCallback(
    (trigger: Trigger) => {
      void openTrigger(trigger);
    },
    [openTrigger]
  );

  const handleToggleActive = async (trigger: Trigger) => {
    try {
      if (trigger.status === TriggerStatus.Active) {
        await proxyDeactivateTrigger(trigger.id);
      } else {
        await proxyActivateTrigger(trigger.id);
      }
      void loadTriggers();
    } catch (error) {
      console.error('Failed to toggle trigger:', error);
    }
  };

  const handleDelete = async (trigger: Trigger) => {
    try {
      await proxyDeleteTrigger(trigger.id);
      void loadTriggers();
    } catch (error) {
      console.error('Failed to delete trigger:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-w-0 flex w-full flex-col">
        <SectionHeader
          title={capitalizeLabel(t('layout.triggers'))}
          searchPlaceholder={t('layout.search-triggers')}
        />
        <div className="pb-12 text-body-sm text-ds-text-neutral-muted-default">
          {t('layout.loading')}
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 flex w-full flex-col">
      <SectionHeader
        title={capitalizeLabel(t('layout.triggers'))}
        searchPlaceholder={t('layout.search-triggers')}
      />

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
        ) : viewMode === 'grid' ? (
          <div className="gap-4 sm:grid-cols-2 grid auto-rows-fr grid-cols-1">
            {filteredTriggers.map((trigger) => (
              <TriggerRow
                key={trigger.id}
                trigger={trigger}
                viewMode={viewMode}
                onEdit={handleEditTrigger}
                onDelete={handleDelete}
                onToggleActive={handleToggleActive}
              />
            ))}
          </div>
        ) : (
          <div className="gap-3 flex flex-col">
            {filteredTriggers.map((trigger) => (
              <TriggerRow
                key={trigger.id}
                trigger={trigger}
                viewMode={viewMode}
                onEdit={handleEditTrigger}
                onDelete={handleDelete}
                onToggleActive={handleToggleActive}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
