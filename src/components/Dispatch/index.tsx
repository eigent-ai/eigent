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
import ContentHeader, {
  CONTENT_HEADER_TITLE_CLASS,
} from '@/components/Layout/ContentHeader';
import { RIGHT_RAIL_STACKED_CONTENT_WIDTH_CLASS } from '@/components/Layout/rightRail';
import { Button } from '@/components/ui/button';
import { DsIcon } from '@/components/ui/ds-icon';
import { DsText } from '@/components/ui/ds-text';
import { Tag } from '@/components/ui/tag';
import { formatAppDate } from '@/lib/appDate';
import {
  createRemoteControlSession,
  getRemoteControlBridgeError,
  getRemoteControlDesktopInstanceId,
  isRemoteControlAlreadyGoneError,
  parseRemoteControlLinkToken,
  revokeRemoteControlSession,
  waitForRemoteControlBridgeConnected,
} from '@/lib/remoteControl';
import { canUseRemoteControlInSpace } from '@/lib/spaceLabel';
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
import { Copy, Loader2, MonitorSmartphone, Square } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

// Rail rows follow the Automations list item recipe.
const CHANNEL_ROW_CLASS =
  'flex w-full min-w-0 items-center gap-ds-8 rounded-ds-card border border-x border-y border-solid p-ds-12 text-left';

// Sections in the main panel share the Automations dashboard card shell.
const SECTION_CARD_CLASS =
  'flex flex-col rounded-ds-card border border-x border-y border-solid border-ds-hairline-subtle-default bg-ds-neutral-default-default';

interface ChannelListItemProps {
  name: string;
  leading: ReactNode;
  status?: { text: string; tone: 'success' | 'neutral' };
  isSelected?: boolean;
  comingSoon?: boolean;
}

// Remote control is the only available channel, so it is always the one
// shown; rows become selectable when a second channel ships.
function ChannelListItem({
  name,
  leading,
  status,
  isSelected = false,
  comingSoon = false,
}: ChannelListItemProps) {
  const { t } = useTranslation();
  const tag = comingSoon
    ? {
        text: t('layout.dispatch-coming-soon', { defaultValue: 'Coming soon' }),
        tone: 'neutral' as const,
      }
    : status;

  return (
    <div
      aria-current={isSelected ? 'true' : undefined}
      aria-disabled={comingSoon || undefined}
      className={cn(
        CHANNEL_ROW_CLASS,
        isSelected
          ? 'border-ds-hairline-strong-default bg-ds-neutral-default-default'
          : 'border-transparent',
        comingSoon && 'opacity-50 select-none'
      )}
    >
      <span className="flex shrink-0 items-center text-ds-ink-muted-default">
        {leading}
      </span>
      <DsText
        as="span"
        role="base"
        weight="semibold"
        className="min-w-0 flex-1 truncate"
        title={name}
      >
        {name}
      </DsText>
      {tag ? (
        <Tag
          size="xs"
          variant="primary"
          tone={tag.tone}
          emphasis="subtle"
          text={tag.text}
          className="shrink-0"
        />
      ) : null}
    </div>
  );
}

interface RemoteControlLinkRowProps {
  session: RemoteControlSession;
  stopping: boolean;
  onCopy: () => void;
  onStop: () => void;
}

function RemoteControlLinkRow({
  session,
  stopping,
  onCopy,
  onStop,
}: RemoteControlLinkRowProps) {
  const { t } = useTranslation();
  const expiresAt = session.expiresAt ? new Date(session.expiresAt) : null;
  const expiresLabel =
    expiresAt && !Number.isNaN(expiresAt.getTime())
      ? t('layout.dispatch-link-expires', {
          time: formatAppDate(expiresAt, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }),
          defaultValue: 'Expires {{time}}',
        })
      : null;

  return (
    <li className="flex min-w-0 items-center gap-ds-12 border-x-0 border-t border-b-0 border-solid border-ds-hairline-subtle-default px-ds-16 py-ds-12 first:border-x-0 first:border-y-0">
      <div className="flex min-w-0 flex-1 flex-col gap-ds-2">
        <DsText
          as="span"
          role="base"
          weight="medium"
          className="truncate"
          title={session.title}
        >
          {session.title}
        </DsText>
        {expiresLabel && (
          <DsText
            as="span"
            role="meta"
            className="truncate text-ds-ink-muted-default"
          >
            {expiresLabel}
          </DsText>
        )}
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="no-drag shrink-0"
        onClick={onCopy}
      >
        <DsIcon icon={Copy} aria-hidden />
        {t('layout.dispatch-copy-link', { defaultValue: 'Copy link' })}
      </Button>
      <Button
        type="button"
        variant="secondary"
        tone="error"
        size="sm"
        className="no-drag shrink-0"
        disabled={stopping}
        onClick={onStop}
      >
        {stopping ? (
          <DsIcon icon={Loader2} className="animate-spin" aria-hidden />
        ) : (
          <DsIcon icon={Square} aria-hidden />
        )}
        {t('layout.dispatch-revoke-link', { defaultValue: 'Revoke link' })}
      </Button>
    </li>
  );
}

const LOG_STATUS_STYLE: Record<RemoteControlLogStatus, string> = {
  created: 'text-ds-text-status-completed-strong-default',
  stopped: 'text-ds-text-status-error-strong-default',
  expired: 'text-ds-text-status-pending-strong-default',
};

function formatLogTime(iso: string): string {
  const d = new Date(iso);
  return formatAppDate(d, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const REMOTE_CONTROL_TITLE_MAX_LENGTH = 80;

function buildRemoteControlTitle(spaceName?: string | null): string {
  const base = spaceName?.trim() || 'Eigent Remote Control';
  const text = base.replace(/\s+/g, ' ').trim();
  if (text.length <= REMOTE_CONTROL_TITLE_MAX_LENGTH) return text;
  return `${text.slice(0, REMOTE_CONTROL_TITLE_MAX_LENGTH - 3).trimEnd()}...`;
}

const COMING_SOON_CHANNELS = [
  {
    id: 'telegram',
    labelKey: 'layout.channels-telegram',
    label: 'Telegram',
    icon: telegramIcon,
  },
  {
    id: 'lark',
    labelKey: 'layout.channels-lark',
    label: 'Lark',
    icon: larkIcon,
  },
  {
    id: 'whatsapp',
    labelKey: 'layout.channels-whatsapp',
    label: 'WhatsApp',
    icon: whatsappIcon,
  },
] as const;

function ActivityLog({ logs }: { logs: RemoteControlLogEntry[] }) {
  const { t } = useTranslation();

  if (logs.length === 0) {
    return (
      <DsText
        as="p"
        role="base"
        className="px-ds-16 py-ds-24 text-center text-ds-ink-muted-default"
      >
        {t('layout.dispatch-no-logs', { defaultValue: 'No activity yet' })}
      </DsText>
    );
  }

  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {[...logs].reverse().map((entry) => (
        <li
          key={entry.id}
          className="flex min-w-0 items-center gap-ds-12 px-ds-16 py-ds-8"
        >
          <DsText
            as="span"
            role="meta"
            className="shrink-0 text-ds-ink-muted-default tabular-nums"
          >
            {formatLogTime(entry.time)}
          </DsText>
          <DsText
            as="span"
            role="base"
            className="min-w-0 flex-1 truncate"
            title={entry.name}
          >
            {entry.name}
          </DsText>
          <DsText
            as="span"
            role="meta"
            className={cn(
              'shrink-0 capitalize',
              LOG_STATUS_STYLE[entry.status]
            )}
          >
            {t(`layout.dispatch-log-status-${entry.status}`, {
              defaultValue: entry.status,
            })}
          </DsText>
        </li>
      ))}
    </ul>
  );
}

export function WorkspaceDispatch() {
  const { t } = useTranslation();
  const activeSpaceId = useSpaceStore((s) => s.activeSpaceId);
  const activeSpace = useSpaceStore((s) =>
    s.activeSpaceId ? s.spaces[s.activeSpaceId] : null
  );
  const activeProjectId = useProjectRuntimeStore((s) => s.activeProjectId);
  const remoteControlUnsupportedForSpace =
    activeSpace !== null && !canUseRemoteControlInSpace(activeSpace);

  const activeSessions = useTriggerStore((s) => s.activeRemoteControlSessions);
  const logs = useTriggerStore((s) => s.remoteControlLogs);
  const addRemoteControlSession = useTriggerStore(
    (s) => s.addRemoteControlSession
  );
  const removeRemoteControlSession = useTriggerStore(
    (s) => s.removeRemoteControlSession
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
    const timers = expiryTimersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
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
      toast.error(
        t('layout.remote-control-desktop-required', {
          defaultValue: 'Remote control must be started from the desktop app.',
        })
      );
      return;
    }
    if (!activeSpaceId) {
      toast.error(
        t('layout.remote-control-open-space-first', {
          defaultValue: 'Open a Space before starting remote control.',
        })
      );
      return;
    }
    if (!activeSpace || !canUseRemoteControlInSpace(activeSpace)) {
      toast.error(
        t('layout.remote-control-legacy-space-unsupported', {
          defaultValue: 'Legacy Spaces do not support remote control.',
        })
      );
      return;
    }

    setRemoteControlLoading(true);
    try {
      const bridgeReady = await waitForRemoteControlBridgeConnected();
      if (!bridgeReady) {
        const bridgeError = getRemoteControlBridgeError();
        toast.error(
          bridgeError?.retryable === false
            ? t('layout.remote-control-needs-attention', {
                defaultValue: 'Remote control needs attention.',
              })
            : t('layout.remote-control-still-connecting', {
                defaultValue: 'Remote control is still connecting.',
              }),
          {
            description:
              bridgeError?.code === 'device_owner_mismatch'
                ? t('layout.remote-control-device-owner-mismatch', {
                    defaultValue:
                      'This Desktop is registered to another Eigent account. Sign in with that account or explicitly reset/transfer the Desktop device registration.',
                  })
                : bridgeError?.message ||
                  t('layout.remote-control-keep-desktop-open', {
                    defaultValue:
                      'Keep Eigent Desktop open and try again in a few seconds.',
                  }),
          }
        );
        return;
      }

      const title = buildRemoteControlTitle(activeSpace?.name);
      const res = await createRemoteControlSession({
        desktop_instance_id: await getRemoteControlDesktopInstanceId(),
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
        linkToken: parseRemoteControlLinkToken(res.url),
      });
      addRemoteControlLog({ name: title, status: 'created' });

      try {
        await navigator.clipboard.writeText(res.url);
        toast.success(
          t('layout.remote-control-link-copied', {
            defaultValue: 'Remote control link copied',
          }),
          {
            description: res.url,
            duration: 10000,
          }
        );
      } catch {
        toast.success(
          t('layout.remote-control-link-created', {
            defaultValue: 'Remote control link created',
          }),
          {
            description: res.url,
            duration: 10000,
          }
        );
      }
    } catch (err: any) {
      const code =
        err?.response?.data?.detail?.code ||
        err?.response?.data?.code ||
        err?.code;
      if (code === 'BRIDGE_OFFLINE') {
        toast.error(
          t('layout.remote-control-bridge-offline', {
            defaultValue: 'Remote control bridge is offline.',
          }),
          {
            description: t('layout.remote-control-bridge-offline-description', {
              defaultValue:
                'Keep Eigent Desktop open and wait for the bridge to reconnect, then try again.',
            }),
          }
        );
      } else {
        toast.error(
          err?.message ||
            t('layout.remote-control-link-create-failed', {
              defaultValue: 'Failed to create remote control link.',
            })
        );
      }
    } finally {
      setRemoteControlLoading(false);
    }
  }, [
    activeProjectId,
    activeSpace,
    activeSpaceId,
    addRemoteControlSession,
    addRemoteControlLog,
    t,
  ]);

  const handleStopSession = useCallback(
    async (sessionId: string) => {
      const session = useTriggerStore
        .getState()
        .activeRemoteControlSessions.find((s) => s.sessionId === sessionId);
      setStoppingSessionId(sessionId);
      try {
        const linkToken =
          session?.linkToken ||
          (session ? parseRemoteControlLinkToken(session.url) : '');
        if (!linkToken) {
          throw new Error(
            t('layout.remote-control-link-token-missing', {
              defaultValue: 'Remote control link token is missing.',
            })
          );
        }
        await revokeRemoteControlSession(sessionId, linkToken);
        removeRemoteControlSession(sessionId);
        if (session)
          addRemoteControlLog({ name: session.title, status: 'stopped' });
        toast.success(
          t('layout.remote-control-link-revoked', {
            defaultValue: 'Remote control link revoked',
          })
        );
      } catch (err: any) {
        // The link is already revoked or expired server-side; the goal is
        // achieved, so clean up locally instead of stranding the entry.
        if (isRemoteControlAlreadyGoneError(err)) {
          removeRemoteControlSession(sessionId);
          if (session)
            addRemoteControlLog({ name: session.title, status: 'stopped' });
          toast.success(
            t('layout.remote-control-link-revoked', {
              defaultValue: 'Remote control link revoked',
            })
          );
        } else {
          toast.error(
            err?.message ||
              t('layout.remote-control-link-revoke-failed', {
                defaultValue: 'Failed to revoke remote control link.',
              })
          );
        }
      } finally {
        setStoppingSessionId(null);
      }
    },
    [removeRemoteControlSession, addRemoteControlLog, t]
  );

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

  const remoteControlName = t('layout.workspace-work-with-remote-control', {
    defaultValue: 'Remote control',
  });
  const remoteControlStatus = hasActiveRemoteControl
    ? {
        text: t('layout.dispatch-connected', { defaultValue: 'Connected' }),
        tone: 'success' as const,
      }
    : remoteControlUnsupportedForSpace
      ? {
          text: t('layout.dispatch-unavailable', {
            defaultValue: 'Unavailable',
          }),
          tone: 'neutral' as const,
        }
      : undefined;

  const activitySection = (
    <section
      aria-labelledby="dispatch-activity-title"
      className="flex flex-col gap-ds-8"
    >
      <DsText
        as="h2"
        id="dispatch-activity-title"
        role="base"
        weight="semibold"
      >
        {t('layout.session-panel-activity', { defaultValue: 'Activity' })}
      </DsText>
      <div className={SECTION_CARD_CLASS}>
        <ActivityLog logs={logs} />
      </div>
    </section>
  );

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col lg:flex-row">
      <section
        aria-label={remoteControlName}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <ContentHeader
          border={false}
          inset="none"
          className="px-ds-16"
          titleAsChild
          title={
            hasSessions ? (
              <DsText as="h1" className={CONTENT_HEADER_TITLE_CLASS}>
                {remoteControlName}
              </DsText>
            ) : undefined
          }
        />
        <div className="scrollbar-always-visible min-h-0 flex-1 overflow-y-auto px-ds-24 xl:px-ds-page-gutter">
          {hasSessions ? (
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-ds-24 py-ds-24">
              <section
                aria-labelledby="dispatch-active-links-title"
                className="flex flex-col gap-ds-8"
              >
                <DsText
                  as="h2"
                  id="dispatch-active-links-title"
                  role="base"
                  weight="semibold"
                >
                  {t('layout.dispatch-active-links', {
                    defaultValue: 'Active links',
                  })}
                  <span className="ml-ds-6 font-medium text-ds-ink-subtle-default">
                    {activeSessions.length}
                  </span>
                </DsText>
                <ul className={cn(SECTION_CARD_CLASS, 'm-0 list-none p-0')}>
                  {activeSessions.map((session) => (
                    <RemoteControlLinkRow
                      key={session.sessionId}
                      session={session}
                      stopping={stoppingSessionId === session.sessionId}
                      onCopy={() => handleCopySession(session.url)}
                      onStop={() => void handleStopSession(session.sessionId)}
                    />
                  ))}
                </ul>
              </section>
              {activitySection}
            </div>
          ) : (
            <div className="mx-auto flex min-h-full w-full max-w-2xl flex-col justify-center gap-ds-24 py-ds-24">
              <div className="flex flex-col items-center gap-ds-8 text-center">
                <DsIcon
                  icon={MonitorSmartphone}
                  recipe="illustration"
                  illustrationSize={40}
                  className="text-ds-ink-muted-default"
                  aria-hidden
                />
                <DsText as="h1" role="page" weight="semibold">
                  {remoteControlName}
                </DsText>
                <DsText
                  as="p"
                  role="body-large"
                  className="text-ds-ink-muted-default"
                >
                  {remoteControlUnsupportedForSpace
                    ? t('layout.remote-control-legacy-space-unsupported', {
                        defaultValue:
                          'Legacy Spaces do not support remote control.',
                      })
                    : t('layout.dispatch-remote-control-description', {
                        defaultValue:
                          'Follow and steer the tasks in this Space from your phone or another browser with a private link. The tasks keep running on this desktop.',
                      })}
                </DsText>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  className="no-drag mt-ds-8"
                  disabled={
                    remoteControlUnsupportedForSpace || remoteControlLoading
                  }
                  onClick={() => void handleCreateRemoteControl()}
                >
                  {remoteControlLoading ? (
                    <DsIcon
                      icon={Loader2}
                      className="animate-spin"
                      aria-hidden
                    />
                  ) : null}
                  {t('layout.dispatch-start', { defaultValue: 'Start' })}
                </Button>
              </div>
              {logs.length > 0 ? activitySection : null}
            </div>
          )}
        </div>
      </section>

      <aside
        aria-labelledby="dispatch-channels-title"
        className={cn(
          'flex max-h-[40%] min-h-0 shrink-0 flex-col border-x-0 border-t border-b-0 border-solid border-ds-hairline-subtle-default bg-ds-neutral-subtle-default lg:max-h-none lg:border-t-0 lg:border-r-0 lg:border-b-0 lg:border-l',
          RIGHT_RAIL_STACKED_CONTENT_WIDTH_CLASS
        )}
      >
        <ContentHeader border={false} inset="none" className="px-ds-16">
          <DsText
            as="h2"
            id="dispatch-channels-title"
            role="base"
            weight="semibold"
          >
            {t('layout.channels', { defaultValue: 'Channels' })}
          </DsText>
        </ContentHeader>
        <div className="scrollbar-always-visible min-h-0 flex-1 overflow-y-auto pr-0 pb-ds-16 pl-ds-8">
          <ul className="m-0 flex list-none flex-col gap-ds-2 p-0">
            <li>
              <ChannelListItem
                name={remoteControlName}
                leading={<DsIcon icon={MonitorSmartphone} aria-hidden />}
                status={remoteControlStatus}
                isSelected
              />
            </li>
            {COMING_SOON_CHANNELS.map((channel) => (
              <li key={channel.id}>
                <ChannelListItem
                  name={t(channel.labelKey, { defaultValue: channel.label })}
                  leading={
                    <img
                      src={channel.icon}
                      alt=""
                      className="size-4 shrink-0 object-contain"
                      aria-hidden
                    />
                  }
                  comingSoon
                />
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
