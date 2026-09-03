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

import { fetchConnectedProviders } from '@/api/connectors';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { listMemoryEntries } from '@/service/memoryApi';
import { useAuthStore } from '@/store/authStore';
import { useSkillsStore } from '@/store/skillsStore';
import {
  Brain,
  Cable,
  Folder,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHomeHub } from './context';

function formatWelcomeName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const local = trimmed.includes('@') ? trimmed.split('@')[0] : trimmed;
  const pretty = local.replace(/[._-]+/g, ' ').trim();
  if (!pretty) return trimmed;
  return pretty
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function OverviewStat({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <DsIcon icon={Icon} className="text-ds-ink-muted-default" />
      <div className="min-w-0">
        <DsText
          as="dt"
          role="meta"
          className="truncate text-ds-ink-muted-default"
        >
          {label}
        </DsText>
        <DsText
          as="dd"
          role="base"
          weight="semibold"
          className="truncate text-ds-ink-default-default tabular-nums"
        >
          {value}
        </DsText>
      </div>
    </div>
  );
}

export default function HomeGreeting() {
  const { t } = useTranslation();
  const { username, email, user_id: userId } = useAuthStore();
  const { sectionCounts } = useHomeHub();
  const skillCount = useSkillsStore((state) => state.skills.length);
  const [connectorCount, setConnectorCount] = useState<number | null>(null);
  const [memoryRemaining, setMemoryRemaining] = useState<number | null>(null);
  const welcomeName = formatWelcomeName(username || email || '');
  const hour = new Date().getHours();
  const timeGreetingKey =
    hour >= 5 && hour < 12
      ? 'layout.greeting-morning'
      : hour >= 12 && hour < 17
        ? 'layout.greeting-afternoon'
        : 'layout.greeting-evening';

  useEffect(() => {
    let cancelled = false;

    if (!email) {
      setConnectorCount(0);
    } else {
      void fetchConnectedProviders()
        .then((providers) => {
          if (!cancelled) setConnectorCount(providers.length);
        })
        .catch(() => {
          if (!cancelled) setConnectorCount(null);
        });
    }

    if (userId == null) {
      setMemoryRemaining(null);
    } else {
      void listMemoryEntries('user', String(userId))
        .then(({ scope_state: scopeState }) => {
          if (!cancelled) {
            setMemoryRemaining(
              Math.max(
                0,
                scopeState.token_limit - scopeState.current_token_count
              )
            );
          }
        })
        .catch(() => {
          if (!cancelled) setMemoryRemaining(null);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [email, userId]);

  return (
    <section
      data-home-spaces-overview
      className="grid w-full gap-4 rounded-ds-card border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default px-ds-16 py-ds-12 lg:grid-cols-[minmax(220px,0.8fr)_minmax(520px,1.4fr)] lg:items-center"
    >
      <div className="min-w-0">
        <DsText role="body-large" weight="semibold">
          {t(timeGreetingKey)}
          {welcomeName
            ? ` ${t('layout.welcome-name', {
                name: welcomeName,
                defaultValue: '{{name}}!',
              })}`
            : null}
        </DsText>
        <DsText role="meta" className="mt-1 text-ds-ink-muted-default">
          {t('layout.home-spaces-description', {
            defaultValue:
              'Manage your Spaces and connected workspace resources.',
          })}
        </DsText>
      </div>

      <dl className="m-0 grid h-fit min-w-0 grid-cols-2 items-center gap-x-ds-24 gap-y-ds-12 self-center sm:grid-cols-4">
        <OverviewStat
          icon={Folder}
          label={t('layout.spaces', { defaultValue: 'Spaces' })}
          value={sectionCounts.spaces}
        />
        <OverviewStat
          icon={Cable}
          label={t('setting.connectors', { defaultValue: 'Connectors' })}
          value={connectorCount ?? '—'}
        />
        <OverviewStat
          icon={WandSparkles}
          label={t('agents.skills', { defaultValue: 'Skills' })}
          value={skillCount}
        />
        <OverviewStat
          icon={Brain}
          label={t('layout.memory-left', { defaultValue: 'Memory left' })}
          value={
            memoryRemaining == null
              ? '—'
              : new Intl.NumberFormat().format(memoryRemaining)
          }
        />
      </dl>
    </section>
  );
}
