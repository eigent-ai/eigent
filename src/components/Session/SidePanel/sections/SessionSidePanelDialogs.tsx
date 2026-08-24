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
  Dialog,
  DialogContent,
  DialogContentSection,
  DialogHeader,
} from '@/components/ui/dialog';
import { MarkDown } from '@/components/WorkFlow/MarkDown';
import { AgentAvatar } from '@/components/Workspace/AgentAvatar';
import { getToolkitIcon } from '@/lib/toolkitIcons';
import { useTranslation } from 'react-i18next';
import type {
  SessionAgentItem,
  SessionContextItem,
} from './buildProjectSessionPanelData';

/** Dialogs opened from SidePanel list items. */
export function AgentInformationDialog({
  agent,
  onOpenChange,
}: {
  agent: SessionAgentItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const agentName =
    agent?.name ||
    (agent?.subagent
      ? t('layout.session-panel-remote-subagent', {
          defaultValue: 'Remote subagent',
        })
      : t('layout.session-panel-agent', { defaultValue: 'Agent' }));
  const agentDescription =
    agent?.description ||
    (agent?.subagent
      ? t('layout.session-panel-subagent-description', {
          defaultValue:
            'A delegated agent used for a bounded part of this session.',
        })
      : t('layout.session-panel-agent-description', {
          defaultValue:
            'A general-purpose agent that plans and completes work in this session using the available tools.',
        }));

  return (
    <Dialog open={agent != null} onOpenChange={onOpenChange}>
      <DialogContent size="sm" overlayVariant="dimmed">
        <DialogHeader
          title={agentName}
          subtitle={
            agent?.subagent
              ? t('layout.session-panel-subagent', {
                  defaultValue: 'Subagent',
                })
              : t('layout.session-panel-agent', { defaultValue: 'Agent' })
          }
        />
        <DialogContentSection className="scrollbar-always-visible overflow-y-auto">
          {agent ? (
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 overflow-hidden rounded-lg bg-ds-neutral-muted-default">
                  <AgentAvatar
                    agentType={agent.type}
                    agentName={agent.name}
                    provider={agent.provider}
                    model={agent.model}
                    avatarSeed={agent.avatarSeed}
                    fullBleed
                  />
                </span>
                <p className="m-0 text-ds-text-base text-ds-ink-default-default">
                  {agentDescription}
                </p>
              </div>
              {agent.tools.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <span className="text-ds-text-meta font-semibold tracking-wide text-ds-ink-muted-default uppercase">
                    {t('layout.capabilities')}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {agent.tools.map((tool) => (
                      <span
                        key={tool}
                        className="rounded-md bg-ds-neutral-muted-default px-2 py-1 text-ds-text-meta text-ds-ink-default-default"
                      >
                        {tool}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContentSection>
      </DialogContent>
    </Dialog>
  );
}

export function ToolCallsDialog({
  item,
  onOpenChange,
}: {
  item: SessionContextItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={item != null} onOpenChange={onOpenChange}>
      <DialogContent size="lg" overlayVariant="dimmed">
        <DialogHeader
          title={
            item?.label ??
            t('layout.session-panel-tool-calls', {
              defaultValue: 'Tool calls',
            })
          }
          subtitle={t('layout.session-panel-tool-history', {
            defaultValue: 'Request and response history',
          })}
        />
        <DialogContentSection className="scrollbar min-h-0 overflow-y-auto">
          {item?.calls.length ? (
            <div className="flex min-w-0 flex-col gap-3">
              {item.calls.map((call, index) => (
                <div
                  key={call.id}
                  className="flex min-w-0 flex-col gap-2 rounded-xl border border-x border-y border-solid border-ds-hairline-subtle-disabled bg-ds-neutral-default-default p-3"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex shrink-0 items-center">
                      {getToolkitIcon(call.toolkitName)}
                    </span>
                    <span className="min-w-0 truncate text-ds-text-base font-semibold text-ds-ink-default-default">
                      {call.method ||
                        t('layout.session-panel-call', {
                          defaultValue: '{{name}} call {{number}}',
                          name: item.label,
                          number: index + 1,
                        })}
                    </span>
                  </div>
                  {call.input ? (
                    <div className="min-w-0 rounded-lg bg-ds-neutral-muted-default p-3">
                      <div className="mb-1 text-ds-text-meta font-medium tracking-wide text-ds-ink-muted-default uppercase">
                        {t('layout.session-panel-request', {
                          defaultValue: 'Request',
                        })}
                      </div>
                      <MarkDown
                        content={call.input}
                        enableTypewriter={false}
                        pTextSize="text-ds-text-meta text-ds-ink-default-default"
                      />
                    </div>
                  ) : null}
                  {call.output ? (
                    <div className="min-w-0 rounded-lg bg-ds-neutral-muted-default p-3">
                      <div className="mb-1 text-ds-text-meta font-medium tracking-wide text-ds-ink-muted-default uppercase">
                        {t('layout.session-panel-response', {
                          defaultValue: 'Response',
                        })}
                      </div>
                      <MarkDown
                        content={call.output}
                        enableTypewriter={false}
                        pTextSize="text-ds-text-meta text-ds-ink-default-default"
                      />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="m-0 text-ds-text-base text-ds-ink-muted-default">
              {t('layout.session-panel-no-call-details', {
                defaultValue:
                  'No stored request or response details are available.',
              })}
            </p>
          )}
        </DialogContentSection>
      </DialogContent>
    </Dialog>
  );
}
