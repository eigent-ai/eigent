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

import AppShellLayout from '@/components/Layout/AppShellLayout';
import Session from '@/components/Session';
import { PreviewBrowserLayer } from '@/components/Session/PreviewPanel/tabs/browser/PreviewBrowserLayer';
import { SessionWindowNotice } from '@/components/SessionWindow/SessionWindowNotice';
import { SessionWindowTopBar } from '@/components/SessionWindow/SessionWindowTopBar';
import { Button } from '@/components/ui/button';
import { useInstallationSetup } from '@/hooks/useInstallationSetup';
import { useSessionWindowLink } from '@/hooks/useSessionWindows';
import { useHost } from '@/host';
import { ensureProjectRuntimeLoaded } from '@/lib/projectRuntimeHydration';
import { selectProjectWorkspaceRoot } from '@/lib/projectWorkspaceRoot';
import {
  returnSessionWindowToMain,
  type SessionWindowTarget,
} from '@/lib/sessionWindows';
import { getSessionMetaDisplayName } from '@/lib/spaceLabel';
import { useInstallationUI } from '@/store/installationStore';
import { usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import { ReactFlowProvider } from '@xyflow/react';
import { LoaderCircle, MessageCircleOff } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';

/**
 * One Session in its own window or browser tab. The main window keeps the
 * sidebar, the Space and all background work; this window only shows the
 * Session and works in it.
 */
export default function SessionWindowPage() {
  const params = useParams();
  const target = useMemo<SessionWindowTarget | null>(
    () =>
      params.spaceId && params.projectId
        ? { spaceId: params.spaceId, projectId: params.projectId }
        : null,
    [params.spaceId, params.projectId]
  );
  useSessionWindowLink(target);
  if (!target) return null;
  return <SessionWindowContent target={target} />;
}

function SessionWindowContent({ target }: { target: SessionWindowTarget }) {
  const { t } = useTranslation();
  const host = useHost();
  const { spaceId, projectId } = target;
  const { isBackendReady } = useInstallationUI();
  const meta = useSpaceStore((s) => s.getProjectMeta(projectId));
  const activeProjectId = useProjectRuntimeStore((s) => s.activeProjectId);
  const [selected, setSelected] = useState(false);
  const workspaceRoot = useSpaceStore((state) =>
    selectProjectWorkspaceRoot(state, projectId, spaceId)
  );

  // Reports readiness only; installation stays with the main window.
  useInstallationSetup();

  useEffect(() => {
    if (!isBackendReady || !meta) return;
    if (useSpaceStore.getState().activeSpaceId !== spaceId)
      useSpaceStore.getState().setActiveSpace(spaceId);
    const projectStore = useProjectRuntimeStore.getState();
    projectStore.setActiveProject(projectId);
    usePageTabStore.getState().setActiveWorkspaceTab('project');
    setSelected(true);
    void ensureProjectRuntimeLoaded(projectStore, projectId, {
      requireActiveSelection: true,
    });
    // Select once per window; later meta updates must not reselect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isBackendReady, Boolean(meta), projectId, spaceId]);

  // The Session's Space folder may be previewed from this window too.
  useEffect(() => {
    if (!host?.ipcRenderer?.invoke) return;
    void host.ipcRenderer
      .invoke(
        'set-local-file-preview-roots',
        workspaceRoot ? [workspaceRoot] : []
      )
      .catch((error: unknown) => {
        console.warn(
          '[SessionWindow] Failed to register the workspace preview root:',
          error
        );
      });
  }, [host, workspaceRoot]);

  const title = meta ? getSessionMetaDisplayName(meta, t) : null;
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  const openInMainWindow = () => void returnSessionWindowToMain(target);

  let content;
  if (!isBackendReady) {
    content = (
      <SessionWindowNotice
        icon={LoaderCircle}
        title={t('layout.session-window-loading', {
          defaultValue: 'Opening session…',
        })}
      />
    );
  } else if (!meta) {
    content = (
      <SessionWindowNotice
        icon={MessageCircleOff}
        title={t('layout.session-window-missing', {
          defaultValue: 'This session is no longer available',
        })}
        actions={
          <Button variant="secondary" size="sm" onClick={() => window.close()}>
            {t('layout.session-window-close', { defaultValue: 'Close window' })}
          </Button>
        }
      />
    );
  } else if (selected && activeProjectId === projectId) {
    content = <Session />;
  } else {
    content = null;
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-ds-neutral-strong-default">
      <SessionWindowTopBar
        spaceId={spaceId}
        onOpenInMainWindow={openInMainWindow}
      />
      <ReactFlowProvider>
        <AppShellLayout
          sidebar={null}
          sidebarHidden
          /* Hosts the Session's preview <webview> guests in this window. */
          overlay={<PreviewBrowserLayer />}
        >
          {content}
        </AppShellLayout>
      </ReactFlowProvider>
    </div>
  );
}
