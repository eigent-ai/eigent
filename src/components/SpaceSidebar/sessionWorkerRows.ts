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

import type {
  SessionWorker,
  SessionWorkerStatus,
} from '@/lib/projector/chat/workerView';
import {
  presentationForKind,
  type SessionNavLeadKind,
} from '@/lib/sessionNavLead';
import type { ProjectMode } from '@/store/projectStore';
import { resolveWorkerRowsExpanded } from '@/store/sessionWorkerViewStore';
import type { SessionNavChildRows, SessionNavItem } from './SessionNavListRows';

const LEAD_KIND_BY_STATUS: Record<SessionWorkerStatus, SessionNavLeadKind> = {
  idle: 'idle',
  running: 'running',
  waiting: 'hitl',
  completed: 'finished',
  failed: 'error',
  cancelled: 'idle',
};

/** A Session nests its workers only when it ran in Workforce mode. */
export function sessionHasWorkerRows(
  mode: ProjectMode | null | undefined,
  workers: readonly SessionWorker[]
): boolean {
  if (workers.length === 0) return false;
  if (mode) return mode === 'workforce';
  // Mode unknown (older Sessions): more than one agent means Workforce.
  return workers.length > 1;
}

export function workerNavItem(worker: SessionWorker): SessionNavItem {
  const kind = LEAD_KIND_BY_STATUS[worker.status];
  return {
    id: worker.key,
    title: worker.currentTask || worker.name,
    sessionLead: presentationForKind(kind),
  };
}

export function buildWorkerChildRows(options: {
  mode: ProjectMode | null | undefined;
  workers: readonly SessionWorker[];
  explicitExpanded: boolean | undefined;
  /** Open worker of this Session, when the Session is the one shown. */
  activeWorkerKey: string | null;
  label: string;
  onExpandedChange: (expanded: boolean) => void;
  onWorkerClick: (workerKey: string) => void;
}): SessionNavChildRows | undefined {
  const { workers } = options;
  if (!sessionHasWorkerRows(options.mode, workers)) return undefined;
  return {
    rows: workers.map(workerNavItem),
    expanded: resolveWorkerRowsExpanded(
      options.explicitExpanded,
      workers.some((worker) => worker.status === 'waiting')
    ),
    onExpandedChange: options.onExpandedChange,
    activeRowId: options.activeWorkerKey,
    onRowClick: options.onWorkerClick,
    label: options.label,
  };
}
