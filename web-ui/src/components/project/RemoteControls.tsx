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
import { controlTask } from '@web/api/brain';
import type { TaskControlAction, WebSession } from '@web/types';
import { Pause, Play, Square } from 'lucide-react';
import { useState } from 'react';

export function RemoteControls({
  session,
  onAction,
}: {
  session: WebSession | null;
  onAction?: () => void;
}) {
  const [busy, setBusy] = useState<TaskControlAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!session || session.status !== 'ongoing') {
    return null;
  }

  const runAction = async (action: TaskControlAction) => {
    setBusy(action);
    setError(null);
    try {
      await controlTask(session.projectId, action);
      onAction?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Control action failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        buttonContent="text"
        disabled={!!busy}
        onClick={() => void runAction('pause')}
      >
        <Pause />
        Pause
      </Button>
      <Button
        variant="outline"
        size="sm"
        buttonContent="text"
        disabled={!!busy}
        onClick={() => void runAction('resume')}
      >
        <Play />
        Resume
      </Button>
      <Button
        variant="primary"
        tone="error"
        size="sm"
        buttonContent="text"
        disabled={!!busy}
        onClick={() => void runAction('stop')}
      >
        <Square />
        Stop
      </Button>
      {error ? (
        <span className="text-body-sm text-ds-text-error-default-default">
          {error}
        </span>
      ) : null}
    </div>
  );
}
