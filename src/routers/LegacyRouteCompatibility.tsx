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

import { isDesktop } from '@/client/platform';
import NewSpaceDialog from '@/components/Home/NewSpaceDialog';
import { useNewSpaceCreation } from '@/components/Home/hooks/useNewSpaceCreation';
import { useSpaceStore } from '@/store/spaceStore';
import { useCallback } from 'react';
import {
  Navigate,
  useLocation,
  useSearchParams,
  type Location,
} from 'react-router-dom';

export const LEGACY_WORKFLOW_QUERY_KEY = 'legacyWorkflow';

export type LegacyRouteKind =
  | 'history'
  | 'workspace-bundle-install'
  | 'agent-plugin-import'
  | 'workspace-configuration';

type LegacyWorkflow = 'workspace-bundle' | 'agent-plugin';

const AGENT_SETTINGS_SECTIONS = new Set([
  'models',
  'skills',
  'sub-agents',
  'memory',
]);

const BROWSER_SECTION_MAP: Record<string, string> = {
  cdp: 'browser-connections',
  extension: 'browser-plugins',
  cookies: 'cookies',
};

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function stateValue(
  state: Location['state'],
  keys: readonly string[]
): string | null {
  if (!state || typeof state !== 'object') return null;
  const record = state as Record<string, unknown>;
  for (const key of keys) {
    const value = nonEmpty(record[key]);
    if (value) return value;
  }
  return null;
}

function mapHistorySearch(searchParams: URLSearchParams): void {
  const legacyTab = searchParams.get('tab');
  const legacySection = searchParams.get('section');

  searchParams.delete('tab');

  switch (legacyTab) {
    case 'agents':
      searchParams.set('section', 'settings');
      searchParams.set(
        'tab',
        legacySection && AGENT_SETTINGS_SECTIONS.has(legacySection)
          ? legacySection
          : 'models'
      );
      return;
    case 'channels':
      searchParams.set('section', 'settings');
      searchParams.set('tab', 'channels');
      return;
    case 'connectors':
    case 'mcp_tools':
      searchParams.set('section', 'settings');
      searchParams.set('tab', 'connectors');
      return;
    case 'browser': {
      const browserSection = searchParams.get('browserSection') || 'cdp';
      searchParams.delete('browserSection');
      searchParams.set('section', 'settings');
      searchParams.set(
        'tab',
        BROWSER_SECTION_MAP[browserSection] || 'browser-connections'
      );
      return;
    }
    case 'settings':
      searchParams.set('section', 'settings');
      searchParams.set('tab', 'settings');
      return;
    case 'home':
    case 'projects':
    case 'spaces':
    default:
      // Global Projects no longer has its own page. Spaces is the nearest
      // management surface and exposes each Space's Projects tab.
      searchParams.set('section', 'spaces');
  }
}

export function legacyRouteDestination(
  kind: LegacyRouteKind,
  location: Pick<Location, 'search' | 'state'>,
  activeSpaceId: string | null
): { pathname: '/home'; search: string } {
  const searchParams = new URLSearchParams(location.search);

  switch (kind) {
    case 'history':
      mapHistorySearch(searchParams);
      break;
    case 'workspace-bundle-install':
      searchParams.set('section', 'spaces');
      searchParams.set(LEGACY_WORKFLOW_QUERY_KEY, 'workspace-bundle');
      break;
    case 'agent-plugin-import':
      searchParams.set('section', 'spaces');
      searchParams.set(LEGACY_WORKFLOW_QUERY_KEY, 'agent-plugin');
      break;
    case 'workspace-configuration': {
      const targetSpaceId =
        nonEmpty(searchParams.get('spaceId')) ||
        nonEmpty(searchParams.get('space_id')) ||
        nonEmpty(searchParams.get('target_space_id')) ||
        stateValue(location.state, [
          'spaceId',
          'space_id',
          'targetSpaceId',
          'target_space_id',
        ]) ||
        nonEmpty(activeSpaceId);

      searchParams.set('section', 'spaces');
      if (targetSpaceId) {
        searchParams.set('spaceId', targetSpaceId);
        searchParams.set('spaceTab', 'workspace-profile');
      } else {
        searchParams.delete('spaceId');
        searchParams.delete('spaceTab');
      }
      break;
    }
  }

  return {
    pathname: '/home',
    search: searchParams.toString(),
  };
}

/** Redirect a removed frontend route into its current Home management surface. */
export function LegacyRouteRedirect({ kind }: { kind: LegacyRouteKind }) {
  const location = useLocation();
  const activeSpaceId = useSpaceStore((state) => state.activeSpaceId);

  if (kind === 'agent-plugin-import' && !isDesktop()) {
    return <Navigate to="/" replace />;
  }

  const destination = legacyRouteDestination(kind, location, activeSpaceId);

  return <Navigate to={destination} replace state={location.state} />;
}

function workflowFromSearch(
  searchParams: URLSearchParams
): LegacyWorkflow | null {
  const value = searchParams.get(LEGACY_WORKFLOW_QUERY_KEY);
  return value === 'workspace-bundle' || value === 'agent-plugin'
    ? value
    : null;
}

/**
 * Mount the current dialog workflow for links redirected from the retired
 * standalone bundle/plugin pages.
 */
export function LegacyRouteWorkflowDialog() {
  const [searchParams] = useSearchParams();
  const workflow = workflowFromSearch(searchParams);

  return workflow ? <LegacyWorkflowDialogContent workflow={workflow} /> : null;
}

function LegacyWorkflowDialogContent({
  workflow,
}: {
  workflow: LegacyWorkflow;
}) {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { createBlankSpace, createSpaceFromFolder } = useNewSpaceCreation(
    'legacy_route_compatibility'
  );
  const initialHandle =
    nonEmpty(searchParams.get('handle')) ||
    stateValue(location.state, ['handle']);
  const initialProposalId =
    nonEmpty(searchParams.get('proposal')) ||
    stateValue(location.state, ['proposal', 'proposalId']);
  const initialTargetSpaceId =
    nonEmpty(searchParams.get('target_space_id')) ||
    nonEmpty(searchParams.get('targetSpaceId')) ||
    stateValue(location.state, [
      'target_space_id',
      'targetSpaceId',
      'space_id',
      'spaceId',
    ]);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) return;
      const next = new URLSearchParams(searchParams);
      next.delete(LEGACY_WORKFLOW_QUERY_KEY);
      setSearchParams(next, { replace: true, state: location.state });
    },
    [location.state, searchParams, setSearchParams]
  );

  return (
    <NewSpaceDialog
      open
      onOpenChange={handleOpenChange}
      onStartFromScratch={createBlankSpace}
      onUseLocalFolder={createSpaceFromFolder}
      initialPage={workflow}
      initialWorkspaceBundleHandle={initialHandle || undefined}
      initialWorkspaceBundleProposalId={initialProposalId || undefined}
      initialAgentPluginTargetSpaceId={initialTargetSpaceId}
      agentPluginTargetMode="existing"
    />
  );
}
