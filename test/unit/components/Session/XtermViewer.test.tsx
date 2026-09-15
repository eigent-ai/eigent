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

import { XtermViewer } from '@/components/Session/PreviewPanel/tabs/terminal/XtermViewer';
import { render } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const terminal = vi.hoisted(() => ({ reset: vi.fn(), write: vi.fn() }));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    reset = terminal.reset;
    write = terminal.write;
    loadAddon() {}
    open() {}
    attachCustomKeyEventHandler() {}
    dispose() {}
  },
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }));

beforeEach(() => {
  terminal.reset.mockClear();
  terminal.write.mockClear();
});

it('appends across a rolling output-window shift without resetting scrollback', () => {
  const initial = 'x'.repeat(131_072);
  const view = render(
    <XtermViewer sourceId="process" lines={[]} text={initial} offset={0} />
  );
  terminal.reset.mockClear();
  terminal.write.mockClear();

  view.rerender(
    <XtermViewer
      sourceId="process"
      lines={[]}
      text={`${initial.slice(1)}y`}
      offset={1}
    />
  );

  expect(terminal.reset).not.toHaveBeenCalled();
  expect(terminal.write).toHaveBeenCalledOnce();
  expect(terminal.write).toHaveBeenCalledWith('y');
});
