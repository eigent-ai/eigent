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

import ContentHeader, {
  CONTENT_HEADER_TITLE_CLASS,
} from '@/components/Layout/ContentHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DsText } from '@/components/ui/ds-text';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSkillsLibrary } from '../SkillsProvider';
import SkillAccessMenu from './SkillAccessMenu';
import SkillAccessTag from './SkillAccessTag';
import SkillActions from './SkillActions';
import SkillFiles from './SkillFiles';
import SkillSourceTag from './SkillSourceTag';

export default function SkillDetail({ skillId }: { skillId: string }) {
  const { t } = useTranslation();
  const {
    entries,
    loading,
    updateGlobal,
    pendingIds,
    refresh,
    refreshKey,
    previewGeneration,
  } = useSkillsLibrary();
  const entry = entries.find((item) => item.id === skillId);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [entry?.id]);
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col" data-skill-detail>
      <ContentHeader
        className="gap-ds-12 px-ds-16"
        titleAsChild
        title={
          <h1
            ref={heading}
            tabIndex={-1}
            title={entry?.name}
            className={cn(CONTENT_HEADER_TITLE_CLASS, 'm-0 outline-none')}
          >
            {entry?.name || t('agents.library-title')}
          </h1>
        }
        actions={
          entry && (
            <>
              {entry.kind !== 'space' && (
                <label className="flex items-center gap-ds-8 whitespace-nowrap">
                  <DsText as="span" role="meta">
                    {t(
                      entry.skill.enabled
                        ? 'agents.library-enabled'
                        : 'agents.library-disabled'
                    )}
                  </DsText>
                  <Switch
                    checked={entry.skill.enabled}
                    disabled={loading || pendingIds.has(entry.skill.id)}
                    aria-label={t('agents.library-enable', {
                      name: entry.name,
                    })}
                    onCheckedChange={(enabled) =>
                      void updateGlobal(entry.skill, { enabled })
                    }
                  />
                </label>
              )}
              <SkillActions entry={entry} />
            </>
          )
        }
      />
      {entry ? (
        <>
          <div className="flex min-w-0 flex-wrap items-center gap-ds-8 px-ds-16 py-ds-8">
            <SkillSourceTag kind={entry.kind} />
            {entry.kind === 'space' ? (
              <>
                <SkillAccessTag
                  allAgents={!entry.assignTo.length}
                  agentCount={new Set(entry.assignTo).size}
                  title={entry.assignTo.join(', ')}
                />
                <Badge variant="secondary">
                  {t('agents.library-status-profile')}
                </Badge>
                <DsText
                  as="p"
                  role="meta"
                  className="m-0 w-full break-words text-ds-ink-muted-default"
                >
                  <span className="font-medium">{entry.spaceName}</span>
                  {' · '}
                  {t('agents.library-profile-note')}
                </DsText>
              </>
            ) : (
              <>
                <SkillAccessMenu skill={entry.skill} />
                {entry.description && (
                  <DsText
                    as="p"
                    role="meta"
                    className="m-0 w-full break-words text-ds-ink-muted-default"
                  >
                    {entry.description}
                  </DsText>
                )}
              </>
            )}
          </div>
          <SkillFiles
            key={`${entry.id}:${refreshKey}:${previewGeneration}`}
            entry={entry}
            revision={`${refreshKey}:${previewGeneration}`}
          />
        </>
      ) : (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-ds-12 p-ds-24"
          role="status"
        >
          <DsText>
            {t(loading ? 'agents.library-loading' : 'agents.library-not-found')}
          </DsText>
          {!loading && (
            <Button
              variant="secondary"
              disabled={pendingIds.size > 0}
              onClick={refresh}
            >
              {t('agents.library-retry')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
