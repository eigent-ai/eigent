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

import { fetchGet } from '@/api/http';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DsIcon } from '@/components/ui/ds-icon';
import { TooltipSimple } from '@/components/ui/tooltip';
import { useRecording, useRecordingStore } from '@/hooks/useRecording';
import { useSessionPageTabStore } from '@/hooks/useSessionPageTabStore';
import { useHost } from '@/host';
import { startRecording } from '@/service/recordingApi';
import { Film, Video } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

export function SessionRecordingControl({
  sessionId,
  compact = false,
}: {
  sessionId: string;
  compact?: boolean;
}) {
  const host = useHost();
  const { active, recordings, capabilities, connected } = useRecording();
  const openFilePreview = useSessionPageTabStore(
    (state) => state.openFilePreview
  );
  const { t, i18n } = useTranslation();
  const [pending, setPending] = useState(false);
  const clips = recordings
    .filter((item) => item.project_id === sessionId)
    .flatMap((item) =>
      item.clips.map((clip) => ({ ...clip, created_at: item.created_at }))
    );
  const available = Boolean(
    host?.recording && capabilities?.available && connected
  );
  const record = async () => {
    if (!host?.recording || pending) return;
    setPending(true);
    try {
      const response = (await fetchGet('/runs', {
        project_id: sessionId,
        limit: 100,
      })) as { runs: { run_id: string; status: string }[] };
      const run = response.runs.find((item) =>
        ['running', 'waiting_for_user', 'pending'].includes(item.status)
      );
      if (!run) {
        toast.info(t('layout.recording-task-required'));
        return;
      }
      const grant = await host.recording.authorize(run.run_id);
      if (!grant) return;
      const recording = await startRecording(
        run.run_id,
        grant.grant_id,
        crypto.randomUUID()
      );
      useRecordingStore.getState().receive(recording);
    } catch {
      toast.error(t('layout.recording-start-failed'));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="flex items-center gap-ds-control-gap">
      <TooltipSimple
        content={
          available
            ? t('layout.recording-record')
            : t('layout.recording-unavailable')
        }
        side="bottom"
        variant="instant"
      >
        <span className="inline-flex">
          <Button
            variant="ghost"
            size="sm"
            buttonContent={compact ? 'icon-only' : 'text'}
            disabled={!available || Boolean(active) || pending}
            onClick={() => void record()}
            aria-label={t('layout.recording-record')}
          >
            <DsIcon icon={Video} />
            {!compact ? t('layout.recording-record') : null}
          </Button>
        </span>
      </TooltipSimple>
      {clips.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              buttonContent="icon-only"
              aria-label={t('layout.recording-label')}
            >
              <DsIcon icon={Film} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {clips.map((clip) => (
              <DropdownMenuItem
                key={clip.id}
                onSelect={() =>
                  openFilePreview(
                    {
                      name: 'clip_001.mp4',
                      path: clip.local_path,
                      type: 'mp4',
                      size: clip.bytes,
                      relativePath: clip.relative_path,
                      project_id: sessionId,
                      mimeType: clip.mime,
                      localPathAvailable: true,
                      uploadPolicy: 'metadata_only',
                    },
                    sessionId
                  )
                }
              >
                <DsIcon icon={Film} />
                {new Date(clip.created_at * 1000).toLocaleString(
                  i18n.language
                )}{' '}
                ·{' '}
                {new Intl.NumberFormat(i18n.language, {
                  style: 'unit',
                  unit: 'second',
                  unitDisplay: 'short',
                }).format(Math.round(clip.duration))}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
