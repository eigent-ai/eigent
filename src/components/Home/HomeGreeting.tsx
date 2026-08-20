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
import WordCarousel from '@/components/ui/WordCarousel';
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
    <div className="flex min-w-0 items-center gap-3">
      <div
        aria-hidden
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-solid border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default text-ds-icon-neutral-default-default"
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <span className="block truncate !text-label-xs font-semibold uppercase tracking-wide text-ds-text-neutral-muted-default">
          {label}
        </span>
        <span className="mt-1 block truncate !text-body-md font-semibold text-ds-text-neutral-default-default">
          {value}
        </span>
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
      className="grid w-full gap-8 xl:grid-cols-[minmax(240px,0.8fr)_minmax(600px,1.4fr)]"
    >
      <div className="min-w-0 pt-1">
        <h1 className="m-0 flex flex-col items-start">
          <WordCarousel
            words={[t(timeGreetingKey)]}
            className="history-welcome-headline text-heading-xl font-bold not-italic tracking-tight"
            rotateIntervalMs={100}
            sweepDurationMs={2000}
            sweepOnce
            gradient="linear-gradient(90deg, var(--ds-text-brand-subtle-default) 0%, var(--ds-text-brand-muted-default) 100%)"
          />
          {welcomeName ? (
            <span className="history-welcome-headline block text-heading-xl font-bold italic tracking-tight text-ds-text-brand-default-default">
              {`${welcomeName}!`}
            </span>
          ) : null}
        </h1>
        <p className="mt-2 max-w-md !text-body-sm text-ds-text-neutral-muted-default">
          Manage your Spaces and connected workspace resources.
        </p>
      </div>

      <div className="grid h-fit min-w-0 grid-cols-2 items-center gap-x-6 gap-y-5 self-center">
        <OverviewStat
          icon={Folder}
          label="Spaces"
          value={sectionCounts.spaces}
        />
        <OverviewStat
          icon={Cable}
          label="Connectors"
          value={connectorCount ?? '—'}
        />
        <OverviewStat icon={WandSparkles} label="Skills" value={skillCount} />
        <OverviewStat
          icon={Brain}
          label="Memory left"
          value={
            memoryRemaining == null
              ? '—'
              : new Intl.NumberFormat().format(memoryRemaining)
          }
        />
      </div>
    </section>
  );
}
