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

import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useHost } from '@/host';
import {
  getShellRegistryRevision,
  getShellSessionState,
  stopShellSession,
  subscribeShellRegistry,
} from '@/lib/shellSessions';
import { openTerminalProcessPreview } from '@/lib/terminalPreview';
import { usePageTabStore, type SessionPreviewTab } from '@/store/pageTabStore';
import { useTerminalProcessStore } from '@/store/terminalProcessStore';
import { Globe, Square, SquareTerminal } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useSessionTerminalSources } from '../../PreviewPanel/tabs/terminal/useSessionTerminalSources';
import { useTerminalProcesses } from '../../PreviewPanel/tabs/terminal/useTerminalProcesses';
import { SidePanelListRow } from '../sections/primitives';

const EMPTY_TABS: SessionPreviewTab[] = [];
export function useTerminalProcessRows(projectId: string | null) {
  const { t } = useTranslation();
  const host = useHost();
  const processes = useTerminalProcesses(projectId);
  const legacySources = useSessionTerminalSources({ trackOutput: false });
  useSyncExternalStore(subscribeShellRegistry, getShellRegistryRevision);
  const tabs = usePageTabStore((state) =>
    projectId
      ? (state.sessionPreviewByProject[projectId]?.tabs ?? EMPTY_TABS)
      : EMPTY_TABS
  );
  const shells = tabs.filter((tab) => tab.type === 'terminal' && tab.shellId);
  const rows = [
    ...legacySources
      .filter(
        (source) => !processes.some((p) => source.id.split(':')[1] === p.run_id)
      )
      .map((source) => ({
        id: source.id,
        label: `${source.agentName} · ${source.taskLabel}`,
        status: source.status === 'running' ? 'unavailable' : 'completed',
        url: null,
        canStop: false,
        error: null,
        open: () => {
          const store = usePageTabStore.getState();
          if (store.sessionPreviewProjectId === projectId)
            store.openAgentTerminalPreview(source.id, source.agentName);
        },
        stop: async () => {},
      })),
    ...processes.map((process) => ({
      id: process.id,
      label: process.label,
      status: process.status,
      url: process.url,
      canStop: process.can_stop,
      error: process.stop_error,
      open: () => openTerminalProcessPreview(process),
      stop: () =>
        useTerminalProcessStore.getState().stop(process.project_id, process.id),
    })),
    ...shells.flatMap((tab) => {
      if (tab.type !== 'terminal' || !tab.shellId) return [];
      const shellId = tab.shellId;
      const state = getShellSessionState(shellId);
      if (!state.created && !state.exited) return [];
      return [
        {
          id: shellId,
          label: tab.title || t('layout.terminal-process-local-shell'),
          status: state.stopping
            ? 'stopping'
            : state.exited
              ? 'stopped'
              : 'running',
          url: state.url,
          canStop: !state.exited,
          error: state.stopError ?? state.error,
          open: () => {
            const store = usePageTabStore.getState();
            if (store.sessionPreviewProjectId !== projectId) return;
            if (state.url && !state.exited) store.openBrowserPreview(state.url);
            else {
              if (!store.sessionPreviewByProject[projectId!]?.open)
                store.toggleSessionPreview();
              store.selectSessionPreviewTab(tab.id);
            }
          },
          stop: async () => {
            if (host?.electronAPI)
              await stopShellSession(host.electronAPI, shellId);
          },
        },
      ];
    }),
  ];
  return rows;
}

export function TerminalProcessRows({
  projectId,
}: {
  projectId: string | null;
}) {
  const rows = useTerminalProcessRows(projectId);
  return <TerminalProcessList rows={rows} />;
}

export function TerminalProcessList({
  rows,
}: {
  rows: ReturnType<typeof useTerminalProcessRows>;
}) {
  const { t } = useTranslation();
  return (
    <>
      {rows.map((row) => {
        const stopLabel = t('layout.terminal-process-stop', {
          name: row.label,
        });
        return (
          <div key={row.id} data-terminal-process={row.id}>
            <div className="flex min-w-0 items-center gap-ds-2">
              <SidePanelListRow
                leading={<DsIcon icon={row.url ? Globe : SquareTerminal} />}
                onClick={row.open}
                trailing={
                  <DsText role="meta" className="text-ds-ink-muted-default">
                    {t(`layout.terminal-process-${row.status}`)}
                  </DsText>
                }
              >
                <span title={row.label}>{row.label}</span>
              </SidePanelListRow>
              {row.canStop && (
                <TooltipSimple content={stopLabel}>
                  <Button
                    variant="ghost"
                    tone="error"
                    size="sm"
                    buttonContent="icon-only"
                    aria-label={stopLabel}
                    disabled={row.status === 'stopping'}
                    onClick={() => void row.stop()}
                  >
                    <Square aria-hidden />
                  </Button>
                </TooltipSimple>
              )}
            </div>
            {row.error && (
              <DsText
                as="p"
                role="meta"
                className="text-ds-text-error-default-default"
                aria-live="polite"
              >
                {t('layout.terminal-process-stop-failed')}
              </DsText>
            )}
          </div>
        );
      })}
    </>
  );
}
