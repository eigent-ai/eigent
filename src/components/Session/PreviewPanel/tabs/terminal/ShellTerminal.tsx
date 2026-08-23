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
import { useHost } from '@/host';
import {
  ensureShellSession,
  getShellBuffer,
  getShellSessionState,
  resetShellSession,
  resizeShell,
  subscribeShellData,
  subscribeShellState,
  writeToShell,
  type ShellSessionState,
} from '@/lib/shellSessions';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './previewTerminal.css';
import {
  TERMINAL_BASE_THEME,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_LINE_HEIGHT,
  TERMINAL_SCREEN_BACKGROUND,
} from './terminalTheme';

export interface ShellTerminalProps {
  /** Stable PTY id (from the tab); the shell survives tab switches under it. */
  shellId: string;
  /** Directory the shell starts in; falls back to the home directory. */
  cwd?: string;
  /** Called with the URL when a link in the output is clicked. */
  onOpenLink?: (url: string) => void;
}

/**
 * A real interactive terminal — xterm in front, a main-process PTY running
 * the user's login shell behind. Feels like the desktop terminal: native
 * prompt, arrow keys, colors, Ctrl+C, full-screen programs. Scrollback is
 * replayed from the session registry when the tab remounts.
 */
export function ShellTerminal({
  shellId,
  cwd,
  onOpenLink,
}: ShellTerminalProps) {
  const { t } = useTranslation();
  const host = useHost();
  const electronAPI = host?.electronAPI;
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [session, setSession] = useState<ShellSessionState>(() =>
    getShellSessionState(shellId)
  );
  const onOpenLinkRef = useRef(onOpenLink);
  useEffect(() => {
    onOpenLinkRef.current = onOpenLink;
  }, [onOpenLink]);
  // Bump to re-run the mount effect after "Restart shell".
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    const api = electronAPI;
    if (!container || !api?.terminalCreate) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: TERMINAL_FONT_SIZE,
      lineHeight: TERMINAL_LINE_HEIGHT,
      fontFamily: TERMINAL_FONT_FAMILY,
      scrollback: 5000,
      theme: {
        ...TERMINAL_BASE_THEME,
        cursor: TERMINAL_BASE_THEME.foreground,
        cursorAccent: TERMINAL_SCREEN_BACKGROUND,
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(
      new WebLinksAddon((event, uri) => {
        event.preventDefault();
        onOpenLinkRef.current?.(uri);
      })
    );
    terminal.open(container);
    terminalRef.current = terminal;

    // Cmd/Ctrl+C copies when there is a selection (otherwise it stays the
    // shell interrupt); Cmd/Ctrl+V pastes through xterm's textarea natively.
    terminal.attachCustomKeyEventHandler((event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key === 'c' &&
        terminal.hasSelection()
      ) {
        void navigator.clipboard?.writeText(terminal.getSelection());
        return false;
      }
      return true;
    });

    // Replay buffered scrollback, then attach to the live stream.
    const buffered = getShellBuffer(shellId);
    if (buffered) terminal.write(buffered);
    const unsubscribeData = subscribeShellData(shellId, (chunk) =>
      terminal.write(chunk)
    );
    const unsubscribeState = subscribeShellState(shellId, () =>
      setSession(getShellSessionState(shellId))
    );

    const inputDisposable = terminal.onData((data) =>
      writeToShell(api, shellId, data)
    );

    const safeFit = () => {
      if (!container.clientWidth || !container.clientHeight) return;
      try {
        fitAddon.fit();
        resizeShell(api, shellId, terminal.cols, terminal.rows);
      } catch {
        // Ignore: the next resize will refit.
      }
    };

    // Fit once layout settles, spawn the shell at that size, then track
    // container resizes (panel drag, window resize, side panel fold).
    let frame = requestAnimationFrame(() => {
      safeFit();
      void ensureShellSession(api, {
        id: shellId,
        cwd,
        cols: terminal.cols,
        rows: terminal.rows,
      }).then(setSession);
      terminal.focus();
    });
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(safeFit);
    });
    observer.observe(container);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      inputDisposable.dispose();
      unsubscribeData();
      unsubscribeState();
      terminal.dispose();
      terminalRef.current = null;
    };
    // cwd only matters at spawn time; a change never restarts a live shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shellId, runId, electronAPI]);

  const handleRestart = async () => {
    if (!electronAPI) return;
    const disposed = await resetShellSession(electronAPI, shellId);
    if (!disposed) return;
    setSession(getShellSessionState(shellId));
    setRunId((id) => id + 1);
  };

  const notice = session.error
    ? t('layout.terminal-error', {
        defaultValue: 'Could not start the shell: {{error}}',
        error: session.error,
      })
    : session.exited
      ? t('layout.terminal-exited', {
          defaultValue: 'The shell session has ended.',
        })
      : null;

  return (
    <div
      className="preview-terminal-screen relative h-full w-full"
      style={{ backgroundColor: TERMINAL_SCREEN_BACKGROUND }}
    >
      <div ref={containerRef} className="h-full w-full p-3" />
      {notice ? (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-ds-neutral-strong-default px-3 py-2">
          <span className="truncate text-xs text-ds-neutral-on-strong">
            {notice}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="xs"
            onClick={() => void handleRestart()}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            {t('layout.terminal-restart', { defaultValue: 'Restart shell' })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default ShellTerminal;
