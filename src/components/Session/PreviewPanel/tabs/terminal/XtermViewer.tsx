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

import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';
import './previewTerminal.css';
import {
  TERMINAL_BASE_THEME,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_LINE_HEIGHT,
  TERMINAL_SCREEN_BACKGROUND,
} from './terminalTheme';

const TERMINAL_THEME = {
  ...TERMINAL_BASE_THEME,
  // Read-only viewer: paint the cursor in the background color so it vanishes.
  cursor: TERMINAL_SCREEN_BACKGROUND,
  cursorAccent: TERMINAL_SCREEN_BACKGROUND,
};

/** ANSI: hide the cursor (re-sent after every reset). */
const HIDE_CURSOR = '\x1b[?25l';

export interface XtermViewerProps {
  /** Stream identity; changing it resets the buffer before writing. */
  sourceId: string;
  /**
   * Append-only log lines. The array is mutated in place upstream, so writes
   * are tracked by count — a shrink (or a new sourceId) resets the buffer.
   */
  lines: string[];
  /** Invoked with the URL when a link in the output is clicked. */
  onOpenLink?: (url: string) => void;
}

/**
 * Read-only xterm surface for agent terminal output. Handles ANSI colors,
 * container-resize refitting, scrollback, selection copy (Cmd/Ctrl+C), and
 * incremental appends without re-writing the whole buffer.
 */
export function XtermViewer({ sourceId, lines, onOpenLink }: XtermViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const writtenRef = useRef<{ sourceId: string | null; count: number }>({
    sourceId: null,
    count: 0,
  });
  const onOpenLinkRef = useRef(onOpenLink);
  useEffect(() => {
    onOpenLinkRef.current = onOpenLink;
  }, [onOpenLink]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      disableStdin: true,
      convertEol: true,
      cursorBlink: false,
      fontSize: TERMINAL_FONT_SIZE,
      lineHeight: TERMINAL_LINE_HEIGHT,
      fontFamily: TERMINAL_FONT_FAMILY,
      scrollback: 5000,
      theme: TERMINAL_THEME,
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
    terminal.write(HIDE_CURSOR);
    // xterm swallows key events, so wire the standard copy shortcut to the
    // viewer's selection. Everything else falls through (stdin is disabled).
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

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    writtenRef.current = { sourceId: null, count: 0 };

    const safeFit = () => {
      // fit() throws on a zero-sized container (panel mid-animation).
      if (!container.clientWidth || !container.clientHeight) return;
      try {
        fitAddonRef.current?.fit();
      } catch {
        // Ignore: the next resize will refit.
      }
    };

    // Fit once layout settles, then follow container resizes.
    let frame = requestAnimationFrame(safeFit);
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(safeFit);
    });
    observer.observe(container);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const written = writtenRef.current;

    if (written.sourceId !== sourceId || lines.length < written.count) {
      terminal.reset();
      terminal.write(HIDE_CURSOR);
      written.sourceId = sourceId;
      written.count = 0;
    }
    if (lines.length > written.count) {
      for (const entry of lines.slice(written.count)) {
        // Entries may carry a trailing newline; writeln adds its own.
        terminal.writeln(entry.replace(/\r?\n$/, ''));
      }
      written.count = lines.length;
    }
    // `lines` mutates in place upstream, so depend on its length too.
  }, [sourceId, lines, lines.length]);

  return (
    <div
      className="preview-terminal-screen h-full w-full"
      style={{ backgroundColor: TERMINAL_SCREEN_BACKGROUND }}
    >
      <div ref={containerRef} className="h-full w-full p-3" />
    </div>
  );
}

export default XtermViewer;
