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

import { ShellTerminal } from '@/components/Session/PreviewPanel/tabs/terminal/ShellTerminal';
import { HostProvider } from '@/host';
import '@/style/index.css';
import { Terminal } from '@xterm/xterm';
import { motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

type FixtureApi = Pick<
  Window['electronAPI'],
  | 'terminalCreate'
  | 'terminalInput'
  | 'terminalResize'
  | 'terminalDispose'
  | 'onTerminalData'
  | 'onTerminalExit'
>;
declare global {
  interface Window {
    terminalFixtureApi: FixtureApi;
    terminalTest: typeof driver;
  }
}
const terminals: Terminal[] = [];
const resizes: { index: number; cols: number; rows: number }[] = [];
const calls = {
  creates: [] as string[],
  disposes: [] as string[],
  inputs: [] as string[],
};
const open = Terminal.prototype.open;
Terminal.prototype.open = function (element) {
  terminals.push(this);
  this.onResize((size) =>
    resizes.push({ index: terminals.indexOf(this), ...size })
  );
  return open.call(this, element);
};
let receive: (event: { id: string; data: string }) => void;
let copied = '';
// Exercise the copy handler without changing the user's system clipboard.
Object.defineProperty(navigator, 'clipboard', {
  value: {
    writeText: async (text: string) => {
      copied = text;
    },
  },
});
const api: FixtureApi = {
  ...window.terminalFixtureApi,
  terminalCreate: (options) => {
    calls.creates.push(options.id);
    return window.terminalFixtureApi.terminalCreate(options);
  },
  terminalDispose: (id) => {
    calls.disposes.push(id);
    return window.terminalFixtureApi.terminalDispose(id);
  },
  terminalInput: (id, data) => {
    calls.inputs.push(data);
    return window.terminalFixtureApi.terminalInput(id, data);
  },
  onTerminalData: (callback) => {
    receive = callback;
    return window.terminalFixtureApi.onTerminalData(callback);
  },
};
const host = { electronAPI: api, ipcRenderer: null };
function snapshot(index: number) {
  const terminal = terminals[index];
  if (!terminal) return null;
  const buffer = terminal.buffer.active;
  return {
    cols: terminal.cols,
    rows: terminal.rows,
    baseY: buffer.baseY,
    viewportY: buffer.viewportY,
    cursorX: buffer.cursorX,
    cursorY: buffer.cursorY,
    lines: Array.from({ length: buffer.length }, (_, i) =>
      buffer.getLine(i)!.translateToString(true)
    ),
  };
}
const driver = {
  snapshot,
  resizes,
  calls,
  count: () => terminals.length,
  command: (id: string, command: string) =>
    api.terminalInput(id, command + '\r'),
  flush: () =>
    Promise.all(
      terminals.map(
        (terminal) =>
          new Promise<void>((resolve) => terminal.write('', resolve))
      )
    ),
  emit: (id: string, data: string) => receive({ id, data }),
  scroll: (line: number) => terminals[0].scrollToLine(line),
  copyLine: (text: string) => {
    const line = snapshot(0)!.lines.indexOf(text);
    if (line < 0) throw new Error('Missing selection line');
    terminals[0].select(0, line, text.length);
  },
  copied: () => copied,
  ansiColor: () => {
    const index = snapshot(0)!.lines.indexOf('ANSI-100%');
    return terminals[0].buffer.active.getLine(index)?.getCell(5)?.getFgColor();
  },
};
window.terminalTest = driver;
function Entrance({ session, animate }: { session: string; animate: boolean }) {
  const [started, setStarted] = useState(!animate);
  const [settled, setSettled] = useState(!animate);
  useEffect(() => {
    // Hold the initial entrance frame so the baseline always measures the
    // same transient width, independent of machine/render scheduling speed.
    const start = setTimeout(() => setStarted(true), 50);
    const finish = setTimeout(() => setSettled(true), 570);
    return () => {
      clearTimeout(start);
      clearTimeout(finish);
    };
  }, []);
  return (
    <motion.div
      initial={{ flexGrow: animate ? 0 : 1 }}
      animate={{ flexGrow: started ? 1 : 0 }}
      transition={{ type: 'spring', duration: 0.5, bounce: 0.2 }}
      className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
      data-settled={settled}
    >
      <ShellTerminal shellId={session} viewportSettled={settled} />
    </motion.div>
  );
}
function Fixture() {
  const [session, setSession] = useState('session-a');
  const [animate, setAnimate] = useState(true);
  return (
    <HostProvider host={host}>
      <button onClick={() => setSession('session-a')}>Session A</button>
      <button onClick={() => setSession('session-b')}>Session B</button>
      <label>
        <input
          type="checkbox"
          checked={animate}
          onChange={(event) => setAnimate(event.target.checked)}
        />
        Animate display
      </label>
      <input aria-label="Other input" />
      <div style={{ width: 1000, height: 650, display: 'flex' }}>
        <div style={{ width: 200, flexShrink: 0 }} />
        <Entrance key={session} session={session} animate={animate} />
      </div>
    </HostProvider>
  );
}
createRoot(document.getElementById('root')!).render(<Fixture />);
