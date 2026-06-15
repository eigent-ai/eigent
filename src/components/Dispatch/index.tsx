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

import larkIcon from '@/assets/icon/lark.png';
import telegramIcon from '@/assets/icon/telegram.svg';
import whatsappIcon from '@/assets/icon/whatsapp.svg';
import { isDesktop } from '@/client/platform';
import { SESSION_SIDE_PANEL_CONTENT_WIDTH_CLASS } from '@/components/Session/sessionSidePanelLayout';
import { Button } from '@/components/ui/button';
import {
  createRemoteControlSession,
  getRemoteControlDesktopInstanceId,
  revokeRemoteControlSession,
  waitForRemoteControlBridgeConnected,
} from '@/lib/remoteControl';
import { cn } from '@/lib/utils';
import { getConnectionConfig } from '@/store/connectionStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import {
  useTriggerStore,
  type RemoteControlLogEntry,
  type RemoteControlLogStatus,
  type RemoteControlSession,
} from '@/store/triggerStore';
import { AnimatePresence, motion } from 'framer-motion';
import { Copy, Loader2, MonitorSmartphone, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

interface BentoCardProps {
  session: RemoteControlSession;
  logs: RemoteControlLogEntry[];
  stopping: boolean;
  onCopy: () => void;
  onStop: () => void;
}

interface BentoSessionGridProps {
  sessions: RemoteControlSession[];
  logs: RemoteControlLogEntry[];
  stoppingSessionId: string | null;
  onCopy: (url: string) => void;
  onStop: (sessionId: string) => void;
}

function BentoSessionGrid({
  sessions,
  logs,
  stoppingSessionId,
  onCopy,
  onStop,
}: BentoSessionGridProps) {
  const renderCard = (session: RemoteControlSession) => (
    <BentoCard
      session={session}
      logs={logs}
      stopping={stoppingSessionId === session.sessionId}
      onCopy={() => onCopy(session.url)}
      onStop={() => onStop(session.sessionId)}
    />
  );

  const count = sessions.length;

  if (count === 1) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col">
        <div className="h-1/2 min-h-0 w-full">{renderCard(sessions[0])}</div>
      </div>
    );
  }

  if (count === 2) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col gap-3">
        {sessions.map((session) => (
          <div key={session.sessionId} className="min-h-0 flex-1">
            {renderCard(session)}
          </div>
        ))}
      </div>
    );
  }

  const gridClassName =
    count === 3 || count === 4
      ? 'gap-3 grid h-full min-h-0 w-full grid-cols-2 grid-rows-2'
      : 'gap-3 grid h-full min-h-0 w-full auto-rows-fr grid-cols-2';

  return (
    <div className={gridClassName}>
      {sessions.map((session) => (
        <div key={session.sessionId} className="h-full min-h-0">
          {renderCard(session)}
        </div>
      ))}
    </div>
  );
}

function BentoCard({
  session,
  logs,
  stopping,
  onCopy,
  onStop,
}: BentoCardProps) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 rounded-2xl border border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default p-3">
      {/* Header */}
      <div className="flex min-w-0 items-center gap-2">
        <MonitorSmartphone
          className="h-4 w-4 shrink-0 text-ds-text-neutral-muted-default"
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-ds-text-neutral-default-default">
          {session.title}
        </span>
        <Button
          type="button"
          variant="primary"
          size="xs"
          buttonContent="text"
          className="no-drag shrink-0 gap-1.5"
          onClick={onCopy}
        >
          <Copy className="h-3 w-3" aria-hidden />
          {t('layout.dispatch-copy-link', { defaultValue: 'Copy link' })}
        </Button>
        <Button
          type="button"
          variant="primary"
          tone="error"
          size="xs"
          buttonContent="text"
          className="no-drag shrink-0 gap-1"
          disabled={stopping}
          onClick={onStop}
        >
          {stopping ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <Square className="h-3 w-3" aria-hidden />
          )}
          {t('layout.dispatch-revoke-link', { defaultValue: 'Revoke link' })}
        </Button>
      </div>

      {/* Log */}
      <div className="min-h-0 flex-1 border-t border-ds-border-neutral-subtle-default pt-2">
        <LogPanel logs={logs} />
      </div>
    </div>
  );
}

interface ChannelRowProps {
  name: string;
  icon?: React.ReactNode;
  imgSrc?: string;
  disabled?: boolean;
  comingSoon?: boolean;
  hasActiveSessions?: boolean;
  loading?: boolean;
  onStart?: () => void;
}

function ChannelRow({
  name,
  icon,
  imgSrc,
  disabled,
  comingSoon,
  hasActiveSessions,
  loading,
  onStart,
}: ChannelRowProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        'group/row flex h-[44px] w-full cursor-default select-none items-center gap-3 rounded-xl',
        'border border-transparent bg-ds-bg-neutral-default-default px-3',
        'transition-colors duration-150',
        !disabled && 'hover:border-ds-border-neutral-subtle-default',
        hasActiveSessions && 'border-ds-border-neutral-subtle-default',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      <div className="flex shrink-0 items-center">
        {icon}
        {imgSrc && (
          <img
            src={imgSrc}
            alt=""
            className="h-4 w-4 shrink-0 object-contain"
            aria-hidden
          />
        )}
      </div>
      <span className="flex-1 truncate text-body-sm font-medium text-ds-text-neutral-default-default">
        {name}
      </span>

      {/* Right slot — always the same reserved width so all rows stay the same height */}
      <div className="flex h-6 w-[72px] shrink-0 items-center justify-end">
        {comingSoon && (
          <span className="shrink-0 rounded-full bg-ds-bg-neutral-muted-default px-2 py-0.5 text-label-xs text-ds-text-neutral-muted-default">
            {t('layout.dispatch-coming-soon', { defaultValue: 'Coming soon' })}
          </span>
        )}

        {!disabled && !comingSoon && hasActiveSessions && (
          <span className="shrink-0 rounded-full bg-ds-bg-success-subtle-default px-2 py-0.5 text-label-xs text-ds-text-success-strong-default">
            {t('layout.dispatch-connected', { defaultValue: 'Connected' })}
          </span>
        )}

        {!disabled && !comingSoon && !hasActiveSessions && (
          <Button
            type="button"
            variant="secondary"
            size="xs"
            buttonContent="text"
            className="no-drag shrink-0 gap-1"
            disabled={loading}
            onClick={onStart}
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : null}
            {t('layout.dispatch-start', { defaultValue: 'Start' })}
          </Button>
        )}
      </div>
    </div>
  );
}

const LOG_STATUS_STYLE: Record<RemoteControlLogStatus, string> = {
  created: 'text-ds-text-status-completed-strong-default',
  stopped: 'text-ds-text-status-error-strong-default',
  expired: 'text-ds-text-status-pending-strong-default',
};

function formatLogTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function LogPanel({ logs }: { logs: RemoteControlLogEntry[] }) {
  const { t } = useTranslation();

  if (logs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-label-xs text-ds-text-neutral-muted-default">
          {t('layout.dispatch-no-logs', { defaultValue: 'No activity yet' })}
        </span>
      </div>
    );
  }

  return (
    <div className="scrollbar-always-visible flex h-full flex-col overflow-y-scroll">
      {[...logs].reverse().map((entry) => (
        <div
          key={entry.id}
          className="flex min-w-0 items-center gap-3 px-1 py-1.5 text-label-xs"
        >
          <span className="w-[72px] shrink-0 tabular-nums text-ds-text-neutral-muted-default">
            {formatLogTime(entry.time)}
          </span>
          <span className="min-w-0 flex-1 truncate text-ds-text-neutral-default-default">
            {entry.name}
          </span>
          <span
            className={`shrink-0 capitalize ${LOG_STATUS_STYLE[entry.status]}`}
          >
            {t(`layout.dispatch-log-status-${entry.status}`, {
              defaultValue: entry.status,
            })}
          </span>
        </div>
      ))}
    </div>
  );
}

const REMOTE_CONTROL_TITLE_MAX_LENGTH = 80;

function buildRemoteControlTitle(spaceName?: string | null): string {
  const base = spaceName?.trim() || 'Eigent Remote Control';
  const text = base.replace(/\s+/g, ' ').trim();
  if (text.length <= REMOTE_CONTROL_TITLE_MAX_LENGTH) return text;
  return `${text.slice(0, REMOTE_CONTROL_TITLE_MAX_LENGTH - 3).trimEnd()}...`;
}

const PANEL_SPRING = {
  type: 'spring',
  stiffness: 380,
  damping: 36,
  mass: 1,
} as const;

export function WorkspaceDispatch() {
  const { t } = useTranslation();
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId);
  const activeSpace = useSpaceStore((s) =>
    s.activeSpaceId ? s.spaces[s.activeSpaceId] : null
  );
  const activeProjectId = useProjectRuntimeStore((s) => s.activeProjectId);

  const activeSessions = useTriggerStore((s) => s.activeRemoteControlSessions);
  const logs = useTriggerStore((s) => s.remoteControlLogs);
  const addRemoteControlSession = useTriggerStore(
    (s) => s.addRemoteControlSession
  );
  const removeRemoteControlSession = useTriggerStore(
    (s) => s.removeRemoteControlSession
  );
  const clearRemoteControlSessions = useTriggerStore(
    (s) => s.clearRemoteControlSessions
  );
  const addRemoteControlLog = useTriggerStore((s) => s.addRemoteControlLog);

  const [remoteControlLoading, setRemoteControlLoading] = useState(false);

  // Expiry timers — fire when a session's expiresAt passes
  const expiryTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  );
  useEffect(() => {
    const timers = expiryTimersRef.current;

    // Start a timer for any session that doesn't have one yet
    activeSessions.forEach((session) => {
      if (!session.expiresAt) return;
      const existing = timers.get(session.sessionId);
      const msUntilExpiry = new Date(session.expiresAt).getTime() - Date.now();

      // Already expired (e.g. app was closed and reopened)
      if (msUntilExpiry <= 0) {
        if (existing) {
          clearTimeout(existing);
          timers.delete(session.sessionId);
        }
        addRemoteControlLog({ name: session.title, status: 'expired' });
        removeRemoteControlSession(session.sessionId);
        return;
      }

      if (existing) return;

      const timer = setTimeout(() => {
        timers.delete(session.sessionId);
        useTriggerStore
          .getState()
          .addRemoteControlLog({ name: session.title, status: 'expired' });
        useTriggerStore
          .getState()
          .removeRemoteControlSession(session.sessionId);
      }, msUntilExpiry);
      timers.set(session.sessionId, timer);
    });

    // Cancel timers whose sessions were removed (e.g. manually stopped)
    timers.forEach((timer, sessionId) => {
      if (!activeSessions.find((s) => s.sessionId === sessionId)) {
        clearTimeout(timer);
        timers.delete(sessionId);
      }
    });
  }, [activeSessions, addRemoteControlLog, removeRemoteControlSession]);

  // Cleanup all timers on unmount
  useEffect(() => {
    return () => {
      expiryTimersRef.current.forEach((t) => clearTimeout(t));
      expiryTimersRef.current.clear();
    };
  }, []);
  const [stoppingSessionId, setStoppingSessionId] = useState<string | null>(
    null
  );

  const hasActiveRemoteControl = activeSessions.length > 0;
  const hasSessions = activeSessions.length > 0;

  const handleCreateRemoteControl = useCallback(async () => {
    const brainSessionId = getConnectionConfig().sessionId;
    if (!isDesktop()) {
      toast.error('Remote control must be started from the desktop app.');
      return;
    }
    if (!activeSpaceId) {
      toast.error('Open a Space before starting remote control.');
      return;
    }

    setRemoteControlLoading(true);
    try {
      const bridgeReady = await waitForRemoteControlBridgeConnected();
      if (!bridgeReady) {
        toast.error('Remote control is still connecting.', {
          description:
            'Keep Eigent Desktop open and try again in a few seconds.',
        });
        return;
      }

      const title = buildRemoteControlTitle(activeSpace?.name);
      const res = await createRemoteControlSession({
        desktop_instance_id: getRemoteControlDesktopInstanceId(),
        space_id: activeSpaceId,
        ...(activeProjectId ? { project_id: activeProjectId } : {}),
        ...(activeProjectId && brainSessionId
          ? { brain_session_id: brainSessionId }
          : {}),
        title,
      });

      addRemoteControlSession({
        sessionId: res.session_id,
        url: res.url,
        title,
        expiresAt: res.expires_at,
      });
      addRemoteControlLog({ name: title, status: 'created' });

      try {
        await navigator.clipboard.writeText(res.url);
        toast.success('Remote control link copied', {
          description: res.url,
          duration: 10000,
        });
      } catch {
        toast.success('Remote control link created', {
          description: res.url,
          duration: 10000,
        });
      }
    } catch (err: any) {
      const code =
        err?.response?.data?.detail?.code ||
        err?.response?.data?.code ||
        err?.code;
      if (code === 'BRIDGE_OFFLINE') {
        toast.error('Remote control bridge is offline.', {
          description:
            'Keep Eigent Desktop open and wait for the bridge to reconnect, then try again.',
        });
      } else {
        toast.error(err?.message || 'Failed to create remote control link.');
      }
    } finally {
      setRemoteControlLoading(false);
    }
  }, [
    activeProjectId,
    activeSpace?.name,
    activeSpaceId,
    addRemoteControlSession,
    addRemoteControlLog,
  ]);

  const handleStopSession = useCallback(
    async (sessionId: string) => {
      const session = useTriggerStore
        .getState()
        .activeRemoteControlSessions.find((s) => s.sessionId === sessionId);
      setStoppingSessionId(sessionId);
      try {
        await revokeRemoteControlSession(sessionId);
      } catch {
        /* best-effort */
      } finally {
        removeRemoteControlSession(sessionId);
        if (session)
          addRemoteControlLog({ name: session.title, status: 'stopped' });
        setStoppingSessionId(null);
      }
    },
    [removeRemoteControlSession, addRemoteControlLog]
  );

  const handleStopAllRemoteControl = useCallback(async () => {
    const toStop = activeSessions.map((s) => ({
      id: s.sessionId,
      title: s.title,
    }));
    if (toStop.length === 0) return;
    setStoppingSessionId(toStop[0].id);
    await Promise.allSettled(
      toStop.map(({ id }) => revokeRemoteControlSession(id))
    );
    toStop.forEach(({ title }) =>
      addRemoteControlLog({ name: title, status: 'stopped' })
    );
    clearRemoteControlSessions();
    setStoppingSessionId(null);
  }, [activeSessions, clearRemoteControlSessions, addRemoteControlLog]);

  const handleCopySession = useCallback(
    (url: string) => {
      navigator.clipboard.writeText(url).then(
        () =>
          toast.success(
            t('layout.dispatch-link-copied', { defaultValue: 'Link copied' })
          ),
        () =>
          toast.error(
            t('layout.dispatch-copy-failed', { defaultValue: 'Failed to copy' })
          )
      );
    },
    [t]
  );

  const channelList = (
    <div className="flex w-full flex-col gap-1">
      <ChannelRow
        name={t('layout.workspace-work-with-remote-control', {
          defaultValue: 'Remote Control',
        })}
        icon={
          <MonitorSmartphone
            className="h-4 w-4 shrink-0 text-ds-text-neutral-muted-default"
            aria-hidden
          />
        }
        hasActiveSessions={hasActiveRemoteControl}
        loading={remoteControlLoading}
        onStart={() => void handleCreateRemoteControl()}
      />

      <div className="mx-1 border-t border-ds-border-neutral-subtle-default" />

      <ChannelRow
        name={t('layout.channels-telegram', { defaultValue: 'Telegram' })}
        imgSrc={telegramIcon}
        disabled
        comingSoon
      />
      <ChannelRow
        name={t('layout.channels-lark', { defaultValue: 'Lark' })}
        imgSrc={larkIcon}
        disabled
        comingSoon
      />
      <ChannelRow
        name={t('layout.channels-whatsapp', { defaultValue: 'WhatsApp' })}
        imgSrc={whatsappIcon}
        disabled
        comingSoon
      />
    </div>
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b-1 box-border flex h-[45.5px] w-full shrink-0 items-center gap-2 border-x-0 border-t-0 border-solid border-ds-border-neutral-subtle-default px-3">
        <span className="text-body-md font-bold text-ds-text-neutral-muted-default">
          {t('layout.workspace-work-with-title', { defaultValue: 'Work with' })}
        </span>
      </div>

      {/* Body */}
      <div className="relative flex min-h-0 w-full flex-1 overflow-hidden">
        {/* Centered default state */}
        <AnimatePresence initial={false}>
          {!hasSessions && (
            <motion.div
              key="centered"
              className="absolute inset-0 flex items-start justify-center overflow-y-auto p-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              transition={{ duration: 0.2 }}
            >
              <div className="w-full max-w-xl">{channelList}</div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Active state: bento grid + right panel */}
        <AnimatePresence initial={false}>
          {hasSessions && (
            <motion.div
              key="split"
              className="absolute inset-0 flex overflow-hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              transition={{ duration: 0.2 }}
            >
              {/* Left column: dynamic bento layout by session count */}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
                <BentoSessionGrid
                  sessions={activeSessions}
                  logs={logs}
                  stoppingSessionId={stoppingSessionId}
                  onCopy={handleCopySession}
                  onStop={(sessionId) => void handleStopSession(sessionId)}
                />
              </div>

              {/* Right panel — same width as session side panel */}
              <motion.div
                className={cn(
                  'flex shrink-0 flex-col gap-1 overflow-y-auto border-l border-ds-border-neutral-subtle-default p-3',
                  SESSION_SIDE_PANEL_CONTENT_WIDTH_CLASS
                )}
                initial={{ x: 40, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={PANEL_SPRING}
              >
                {channelList}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
