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
import { DsText } from '@/components/ui/ds-text';
import { useSessionPageTabStore } from '@/hooks/useSessionPageTabStore';
import type { CanonicalProjectEvent } from '@/lib/projector';
import {
  ReplayController,
  type ReplaySpeed,
  type ReplayState,
} from '@/lib/sessionReplay/replayController';
import { buildReplayMarkers } from '@/lib/sessionReplay/replayMarkers';
import {
  loadSessionReplayData,
  type SessionReplayData,
} from '@/service/sessionReplayEvents';
import { useSessionReplayStore } from '@/store/sessionReplayStore';
import { DEFAULT_CHAT_TIMELINE_DETAIL_LEVEL } from '@/types/chatTimeline';
import type { SessionModeType } from '@/types/constants';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ReplayTimeline } from './ReplayTimeline';
import { ReplayToolbar } from './ReplayToolbar';

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: SessionReplayData };

function useReplayController(
  events: readonly CanonicalProjectEvent[]
): [ReplayController<CanonicalProjectEvent>, ReplayState] {
  const controller = useMemo(() => new ReplayController(events), [events]);
  const [state, setState] = useState(() => controller.getState());
  useEffect(() => {
    setState(controller.getState());
    const unsubscribe = controller.subscribe(setState);
    // Start playing as soon as the replay opens.
    controller.play();
    return () => {
      unsubscribe();
      controller.dispose();
    };
  }, [controller]);
  return [controller, state];
}

const EMPTY_EVENTS: readonly CanonicalProjectEvent[] = [];

/**
 * Read-only replay of a Session's finished Runs. Shown in place of the live
 * chat, without the composer; nothing is sent while it is open.
 */
export function SessionReplay({
  projectId,
  sessionMode,
}: {
  projectId: string;
  sessionMode?: SessionModeType;
}) {
  const { t } = useTranslation();
  const exitReplay = useSessionReplayStore((state) => state.exitReplay);
  const detailLevel = useSessionPageTabStore(
    (s) => s.chatTimelineDetailLevel ?? DEFAULT_CHAT_TIMELINE_DETAIL_LEVEL
  );
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: 'loading' });
    loadSessionReplayData(projectId, { signal: controller.signal }).then(
      (data) => {
        if (!controller.signal.aborted) setLoad({ status: 'ready', data });
      },
      () => {
        if (!controller.signal.aborted) setLoad({ status: 'error' });
      }
    );
    return () => controller.abort();
  }, [projectId, attempt]);

  const events = load.status === 'ready' ? load.data.events : EMPTY_EVENTS;
  const [controller, state] = useReplayController(events);
  const markers = useMemo(() => buildReplayMarkers(events), [events]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Follow the newest event while playing, like the live timeline does.
  useEffect(() => {
    if (!state.playing) return;
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [state.playing, state.position]);

  const exit = () => exitReplay(projectId);

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      aria-label={t('chat.session-replay.region-label')}
      data-session-replay
    >
      <div
        ref={scrollRef}
        className="scrollbar-always-visible min-h-0 flex-1 overflow-y-auto"
      >
        {load.status === 'loading' ? (
          <ReplayMessage>{t('chat.session-replay.loading')}</ReplayMessage>
        ) : load.status === 'error' ? (
          <ReplayMessage
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setAttempt((value) => value + 1)}
              >
                {t('chat.session-replay.retry')}
              </Button>
            }
          >
            {t('chat.session-replay.load-failed')}
          </ReplayMessage>
        ) : events.length === 0 ? (
          <ReplayMessage>{t('chat.session-replay.empty')}</ReplayMessage>
        ) : (
          <>
            {load.data.unfinishedRunCount > 0 || load.data.truncated ? (
              <DsText
                as="p"
                role="meta"
                className="px-ds-page-gutter pt-ds-12 text-ds-ink-muted-default"
              >
                {load.data.truncated
                  ? t('chat.session-replay.truncated')
                  : t('chat.session-replay.unfinished-left-out', {
                      count: load.data.unfinishedRunCount,
                    })}
              </DsText>
            ) : null}
            <ReplayTimeline
              projectId={projectId}
              events={events}
              position={state.position}
              detailLevel={detailLevel}
              sessionMode={sessionMode}
              paused={!state.playing}
            />
          </>
        )}
      </div>
      <ReplayToolbar
        state={state}
        markers={markers}
        disabled={events.length === 0}
        onToggle={() => controller.toggle()}
        onStepBack={() => controller.stepBack()}
        onStepForward={() => controller.stepForward()}
        onSeek={(position) => controller.seek(position)}
        onSpeedChange={(speed: ReplaySpeed) => controller.setSpeed(speed)}
        onExit={exit}
      />
    </section>
  );
}

function ReplayMessage({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-ds-stack-related p-ds-panel-inset text-center">
      <DsText as="p" role="base" className="text-ds-ink-muted-default">
        {children}
      </DsText>
      {action}
    </div>
  );
}
