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
import { cn } from '@/lib/utils';
import {
  isRemoteControlTargetReady,
  type RemoteControlSession,
  type RemoteControlTarget,
} from '@web/api/remoteControl';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Ban,
  Clock3,
  ShieldX,
  SkipForward,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

const PANEL_TRANSITION = {
  type: 'spring',
  stiffness: 380,
  damping: 38,
  mass: 0.85,
} as const;

function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function remoteStateLabel(
  session: RemoteControlSession | null,
  target: RemoteControlTarget | null
): string {
  if (!session) return '';
  if (session.status !== 'active') return 'Remote link inactive';
  if (session.bridge_status !== 'online') return 'Desktop offline';
  if (!isRemoteControlTargetReady(target)) return 'No active project';
  return 'Desktop online';
}

interface RemoteSettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: RemoteControlSession | null;
  target: RemoteControlTarget | null;
  controlLoading: string | null;
  onSkip: () => void;
  onStop: () => void;
  onExtend: () => void;
  onRevoke: () => void;
  ready: boolean;
  bridgeOnline: boolean;
}

export function RemoteSettingsPanel({
  open,
  onOpenChange,
  session,
  target,
  controlLoading,
  onSkip,
  onStop,
  onExtend,
  onRevoke,
  ready,
  bridgeOnline,
}: RemoteSettingsPanelProps) {
  const reduceMotion = useReducedMotion();
  const panelTransition = reduceMotion ? { duration: 0 } : PANEL_TRANSITION;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  const panel = (
    <>
      {open && (
        <div
          className="inset-0 fixed z-40"
          aria-hidden
          onClick={() => onOpenChange(false)}
        />
      )}
      <AnimatePresence initial={false}>
        {open ? (
          <motion.aside
            key="remote-settings-panel"
            role="dialog"
            aria-modal="false"
            aria-labelledby="remote-settings-panel-title"
            className="border-ds-border-neutral-subtle-default bg-ds-bg-neutral-default-default shadow-2xl right-2 top-2 bottom-2 w-72 max-w-72 rounded-3xl fixed z-50 flex flex-col overflow-hidden border border-solid"
            initial={reduceMotion ? false : { x: '100%' }}
            animate={{ x: 0 }}
            exit={reduceMotion ? undefined : { x: '100%' }}
            transition={panelTransition}
          >
            <h2 id="remote-settings-panel-title" className="sr-only">
              Remote control settings
            </h2>

            <div className="min-h-0 flex h-full flex-col overflow-hidden">
              {/* Header */}
              <header className="h-14 px-4 flex shrink-0 items-center justify-between">
                <span className="text-base font-semibold text-ds-text-neutral-default-default">
                  Settings
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  buttonContent="icon-only"
                  buttonRadius="full"
                  aria-label="Close settings panel"
                  onClick={() => onOpenChange(false)}
                >
                  <X className="h-4 w-4" aria-hidden />
                </Button>
              </header>

              <div className="px-4 pb-4 gap-5 flex flex-col overflow-y-auto">
                {/* Status card */}
                <div className="rounded-2xl border-ds-border-neutral-subtle-default bg-ds-bg-neutral-subtle-default p-5 gap-3 flex flex-col items-center border border-solid text-center">
                  <span
                    className={cn(
                      'h-14 w-14 rounded-2xl flex items-center justify-center',
                      bridgeOnline
                        ? 'bg-ds-bg-status-completed-subtle-default text-ds-text-status-completed-default-default'
                        : 'bg-ds-bg-neutral-default-default text-ds-icon-neutral-muted-default'
                    )}
                  >
                    {bridgeOnline ? (
                      <Wifi className="h-6 w-6" />
                    ) : (
                      <WifiOff className="h-6 w-6" />
                    )}
                  </span>
                  <div className="gap-1 flex flex-col">
                    <span className="text-base font-semibold text-ds-text-neutral-default-default">
                      {remoteStateLabel(session, target)}
                    </span>
                    {session?.expires_at && (
                      <span className="text-body-sm text-ds-text-neutral-muted-default">
                        Expires {formatDate(session.expires_at)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Control buttons */}
                <div className="gap-2 flex flex-col">
                  <Button
                    variant="outline"
                    tone="neutral"
                    size="md"
                    buttonContent="text"
                    buttonRadius="full"
                    className="w-full !shadow-none"
                    disabled={!ready || !!controlLoading}
                    onClick={onSkip}
                  >
                    <SkipForward className="h-4 w-4" />
                    <span className="remote-btn-label">Skip</span>
                  </Button>
                  <Button
                    variant="outline"
                    tone="error"
                    size="md"
                    buttonContent="text"
                    buttonRadius="full"
                    className="w-full !shadow-none"
                    disabled={!ready || !!controlLoading}
                    onClick={onStop}
                  >
                    <Ban className="h-4 w-4" />
                    <span className="remote-btn-label">Stop</span>
                  </Button>
                  <Button
                    variant="outline"
                    tone="information"
                    size="md"
                    buttonContent="text"
                    buttonRadius="full"
                    className="w-full !shadow-none"
                    disabled={!!controlLoading || session?.status !== 'active'}
                    onClick={onExtend}
                  >
                    <Clock3 className="h-4 w-4" />
                    <span className="remote-btn-label">Extend</span>
                  </Button>
                  <Button
                    variant="outline"
                    tone="warning"
                    size="md"
                    buttonContent="text"
                    buttonRadius="full"
                    className="w-full !shadow-none"
                    disabled={!!controlLoading || session?.status !== 'active'}
                    onClick={onRevoke}
                  >
                    <ShieldX className="h-4 w-4" />
                    <span className="remote-btn-label">Revoke</span>
                  </Button>
                </div>
              </div>
            </div>
          </motion.aside>
        ) : null}
      </AnimatePresence>
    </>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(panel, document.body);
}
