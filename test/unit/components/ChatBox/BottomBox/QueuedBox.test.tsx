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

import { QueuedBox } from '@/components/ChatBox/BottomBox/QueuedBox';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const motionPreferences = vi.hoisted(() => ({ reduced: false }));
vi.mock('framer-motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('framer-motion')>()),
  useReducedMotion: () => motionPreferences.reduced,
}));
afterEach(() => {
  motionPreferences.reduced = false;
});

function rowOffset(row: HTMLElement) {
  return Number(
    row.style.transform.match(/translate3d\(0, ([-.\d]+)px/)?.[1] ?? 0
  );
}
function mockQueueGeometry() {
  const rect = (top: number, height: number) => ({
    top,
    bottom: top + height,
    left: 0,
    right: 400,
    width: 400,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  });
  const list = screen.getByRole('list');
  vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(rect(0, 108));
  Object.defineProperty(list, 'clientHeight', {
    configurable: true,
    value: 108,
  });
  screen.getAllByRole('listitem').forEach((row) => {
    vi.spyOn(row, 'getBoundingClientRect').mockImplementation(() =>
      rect(Array.from(list.children).indexOf(row) * 36 + rowOffset(row), 36)
    );
  });
  screen.getAllByRole('button', { name: /Reorder task:/ }).forEach((button) => {
    button.setPointerCapture = vi.fn();
  });
  return list;
}

const messages = [{ id: 'follow-1', content: 'Use the new attachment' }];
const busy = { sessionId: 'session-1', activeTaskId: 'run-1', busy: true };
async function openMenu() {
  await userEvent.click(
    screen.getAllByRole('button', { name: 'More task actions' })[0]
  );
  return screen.findByRole('menu');
}
async function openConfirmation() {
  await userEvent.click(
    within(await openMenu()).getByRole('menuitem', {
      name: 'Stop and start this',
    })
  );
  return waitFor(() => {
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeVisible();
    return dialog;
  });
}

describe('QueuedBox Quiet layout', () => {
  it('shows compact task rows with trash and more controls, without a disclosure or inline start action', () => {
    render(
      <QueuedBox
        queuedMessages={[
          ...messages,
          { id: 'follow-2', content: 'Prepare the final summary' },
        ]}
        queueContext={busy}
      />
    );
    expect(
      screen.getByRole('region', { name: 'Queued tasks (2)' })
    ).toBeVisible();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(
      screen.getAllByRole('button', { name: 'More task actions' })
    ).toHaveLength(2);
    expect(
      screen.queryByRole('button', { name: 'Stop and start this' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Queued tasks' })).toBeNull();
    expect(
      screen.queryByText('Tasks start automatically, one at a time.')
    ).toBeNull();
    expect(screen.queryByText('Resume')).toBeNull();
  });
  it('retains confirmation, safe initial focus, Escape and the exact captured task ID', async () => {
    const send = vi.fn();
    render(
      <QueuedBox
        queuedMessages={messages}
        queueContext={busy}
        onSendQueuedMessageNow={send}
      />
    );
    const dialog = await openConfirmation();
    expect(
      within(dialog).getByText(/will not continue automatically/)
    ).toBeVisible();
    expect(
      within(dialog).getByRole('button', { name: 'Keep queued' })
    ).toHaveFocus();
    expect(send).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(
      screen.getByRole('button', { name: 'More task actions' })
    ).toHaveFocus();
    expect(send).not.toHaveBeenCalled();
    await userEvent.click(
      within(await openConfirmation()).getByRole('button', {
        name: 'Stop and start this',
      })
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('follow-1', 'run-1');
  });
  it('starts next from the menu without confirmation while idle', async () => {
    const send = vi.fn();
    render(
      <QueuedBox queuedMessages={messages} onSendQueuedMessageNow={send} />
    );
    await userEvent.click(
      within(await openMenu()).getByRole('menuitem', { name: 'Start next' })
    );
    expect(send).toHaveBeenCalledWith('follow-1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('does not permit stopping a replacement task and closes on session navigation', async () => {
    const send = vi.fn();
    const { rerender } = render(
      <QueuedBox
        queuedMessages={messages}
        queueContext={busy}
        onSendQueuedMessageNow={send}
      />
    );
    await openConfirmation();
    rerender(
      <QueuedBox
        queuedMessages={messages}
        queueContext={{ ...busy, activeTaskId: 'run-2' }}
        onSendQueuedMessageNow={send}
      />
    );
    expect(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Stop and start this',
      })
    ).toBeDisabled();
    rerender(
      <QueuedBox
        queuedMessages={messages}
        queueContext={{ ...busy, sessionId: 'session-2' }}
        onSendQueuedMessageNow={send}
      />
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });
  it('uses idle admission if the current task finishes during confirmation', async () => {
    const send = vi.fn();
    const { rerender } = render(
      <QueuedBox
        queuedMessages={messages}
        queueContext={busy}
        onSendQueuedMessageNow={send}
      />
    );
    await openConfirmation();
    rerender(
      <QueuedBox
        queuedMessages={messages}
        queueContext={{ ...busy, busy: false }}
        onSendQueuedMessageNow={send}
      />
    );
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: 'Start next',
      })
    );
    expect(send).toHaveBeenCalledWith('follow-1', 'run-1');
  });
  it('locks both row controls while stopping', () => {
    render(
      <QueuedBox
        queuedMessages={[{ ...messages[0], stopping: true }]}
        queueContext={{ ...busy, locked: true }}
      />
    );
    expect(screen.getByText('Stopping current task…')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'More task actions' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /Remove queued message/i })
    ).toBeDisabled();
  });
  it('preserves source restrictions and exposes the full message through the menu', async () => {
    render(
      <QueuedBox
        queuedMessages={[{ ...messages[0], canSendNow: false }]}
        queueContext={{ waitingReason: 'Waiting for your response.' }}
      />
    );
    expect(screen.getByText('Waiting for your response.')).toBeVisible();
    const menu = await openMenu();
    expect(
      within(menu).queryByRole('menuitem', { name: 'Start next' })
    ).toBeNull();
    await userEvent.click(
      within(menu).getByRole('menuitem', { name: 'View full task' })
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole('dialog')).getByText(messages[0].content)
      ).toBeVisible()
    );
    await userEvent.keyboard('{Escape}');
    expect(
      screen.getByRole('button', { name: 'More task actions' })
    ).toHaveFocus();
  });
  it('keeps a pending cancellation visible and prevents duplicate removal', async () => {
    let finish!: () => void;
    const remove = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    render(
      <QueuedBox queuedMessages={messages} onRemoveQueuedMessage={remove} />
    );
    const button = screen.getByRole('button', {
      name: /Remove queued message/i,
    });
    await userEvent.click(button);
    expect(button).toBeDisabled();
    expect(screen.getByText(messages[0].content)).toBeVisible();
    await userEvent.click(button);
    expect(remove).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });
});

describe('queue reordering', () => {
  const queue = [
    { id: 'a', content: 'First task' },
    { id: 'b', content: 'Second task' },
    { id: 'c', content: 'Third task' },
  ];
  it('moves by keyboard, announces the destination, and preserves the focused handle', async () => {
    const move = vi.fn();
    const { rerender } = render(
      <QueuedBox queuedMessages={queue} onReorderQueuedMessage={move} />
    );
    const handle = screen.getByRole('button', {
      name: 'Reorder task: First task',
    });
    handle.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(move).toHaveBeenCalledWith('a', 'b');
    rerender(
      <QueuedBox
        queuedMessages={[queue[1], queue[0], queue[2]]}
        onReorderQueuedMessage={move}
      />
    );
    expect(handle).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent(
      'First task moved to position 2 of 3.'
    );
  });
  it('disables reorder for admitted, prioritized, locked and externally managed tasks', () => {
    const move = vi.fn();
    const { rerender } = render(
      <QueuedBox
        queuedMessages={[queue[0], { ...queue[1], processing: true }]}
        onReorderQueuedMessage={move}
      />
    );
    expect(
      screen
        .getAllByRole('button', { name: /Reorder task:/ })
        .every((button) => button.hasAttribute('disabled'))
    ).toBe(true);
    rerender(
      <QueuedBox
        queuedMessages={[queue[0], { ...queue[1], next: true }]}
        onReorderQueuedMessage={move}
      />
    );
    expect(
      screen
        .getAllByRole('button', { name: /Reorder task:/ })
        .every((button) => button.hasAttribute('disabled'))
    ).toBe(true);
    rerender(
      <QueuedBox
        queuedMessages={queue}
        queueContext={{ locked: true }}
        onReorderQueuedMessage={move}
      />
    );
    expect(
      screen
        .getAllByRole('button', { name: /Reorder task:/ })
        .every((button) => button.hasAttribute('disabled'))
    ).toBe(true);
    rerender(
      <QueuedBox
        queuedMessages={[
          queue[0],
          { ...queue[1], canReorder: false },
          queue[2],
        ]}
        onReorderQueuedMessage={move}
      />
    );
    expect(
      screen.getByRole('button', { name: 'Reorder task: Second task' })
    ).toBeDisabled();
  });
  it('commits pointer movement only on release and cancels on Escape or queue replacement', () => {
    motionPreferences.reduced = true;
    const move = vi.fn();
    const originalPointer = window.PointerEvent;
    window.PointerEvent = MouseEvent as typeof PointerEvent;
    const { rerender } = render(
      <QueuedBox
        queuedMessages={queue}
        queueContext={{ sessionId: 's' }}
        onReorderQueuedMessage={move}
      />
    );
    mockQueueGeometry();
    const handle = screen.getByRole('button', {
      name: 'Reorder task: First task',
    });
    handle.setPointerCapture = vi.fn();
    const start = () => {
      fireEvent.pointerDown(handle, {
        button: 0,
        clientX: 20,
        clientY: handle.closest('li')!.getBoundingClientRect().top + 18,
      });
      fireEvent.pointerMove(handle, { clientX: 20, clientY: 90 });
    };
    try {
      start();
      expect(move).not.toHaveBeenCalled();
      fireEvent.keyDown(handle, { key: 'Escape' });
      fireEvent.pointerUp(handle, { clientX: 20, clientY: 90 });
      expect(move).not.toHaveBeenCalled();
      start();
      fireEvent.pointerUp(handle, { clientX: 500, clientY: 90 });
      expect(move).not.toHaveBeenCalled();
      start();
      fireEvent.pointerUp(handle, { clientX: 20, clientY: 90 });
      expect(move).toHaveBeenCalledWith('a', 'c');
      move.mockClear();
      start();
      rerender(
        <QueuedBox
          queuedMessages={[queue[0], queue[1]]}
          queueContext={{ sessionId: 's' }}
          onReorderQueuedMessage={move}
        />
      );
      fireEvent.pointerUp(handle, { clientX: 20, clientY: 90 });
      expect(move).not.toHaveBeenCalled();
    } finally {
      window.PointerEvent = originalPointer;
    }
  });
});

it('tracks the actual row immediately, moves neighbors, and settles after a downward drop', async () => {
  const pointer = window.PointerEvent;
  window.PointerEvent = MouseEvent as typeof PointerEvent;
  const queue = [
    { id: 'a', content: 'First task' },
    { id: 'b', content: 'Second task' },
    { id: 'c', content: 'Third task' },
  ];
  const move = vi.fn();
  const { rerender } = render(
    <QueuedBox queuedMessages={queue} onReorderQueuedMessage={move} />
  );
  mockQueueGeometry();
  const row = screen.getAllByRole('listitem')[0];
  const neighbor = screen.getAllByRole('listitem')[1];
  const handle = within(row).getByRole('button', {
    name: 'Reorder task: First task',
  });
  try {
    fireEvent.pointerDown(handle, { button: 0, clientX: 20, clientY: 18 });
    fireEvent.pointerMove(handle, { clientX: 20, clientY: 66 });
    expect(rowOffset(row)).toBe(48);
    expect(row).toHaveAttribute('data-lifted', 'true');
    expect(move).not.toHaveBeenCalled();
    await waitFor(() => expect(rowOffset(neighbor)).toBeLessThan(-1));
    fireEvent.pointerMove(handle, { clientX: 20, clientY: 82 });
    expect(rowOffset(row)).toBe(64);
    fireEvent.pointerUp(handle, { clientX: 20, clientY: 82 });
    expect(move).toHaveBeenCalledWith('a', 'c');
    rerender(
      <QueuedBox
        queuedMessages={[queue[1], queue[2], queue[0]]}
        onReorderQueuedMessage={move}
      />
    );
    expect(handle).toHaveFocus();
    expect(row.getBoundingClientRect().top).toBeCloseTo(64, 1);
    const caughtTop = row.getBoundingClientRect().top;
    fireEvent.pointerDown(handle, {
      button: 0,
      clientX: 20,
      clientY: caughtTop + 18,
    });
    fireEvent.pointerMove(handle, { clientX: 20, clientY: caughtTop + 8 });
    expect(row.getBoundingClientRect().top).toBeCloseTo(caughtTop - 10, 1);
    fireEvent.keyDown(handle, { key: 'Escape' });
    expect(move).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(Math.abs(rowOffset(row))).toBeLessThan(0.1));
    await waitFor(() => expect(row).not.toHaveAttribute('data-lifted'));
  } finally {
    window.PointerEvent = pointer;
  }
});

it('keeps direct pointer tracking with reduced motion and cancels an upward drag immediately', () => {
  motionPreferences.reduced = true;
  const pointer = window.PointerEvent;
  window.PointerEvent = MouseEvent as typeof PointerEvent;
  const move = vi.fn();
  render(
    <QueuedBox
      queuedMessages={[
        { id: 'a', content: 'First task' },
        { id: 'b', content: 'Second task' },
        { id: 'c', content: 'Third task' },
      ]}
      onReorderQueuedMessage={move}
    />
  );
  mockQueueGeometry();
  const rows = screen.getAllByRole('listitem');
  const handle = within(rows[2]).getByRole('button', {
    name: 'Reorder task: Third task',
  });
  try {
    fireEvent.pointerDown(handle, { button: 0, clientX: 20, clientY: 90 });
    fireEvent.pointerMove(handle, { clientX: 20, clientY: 18 });
    expect(rowOffset(rows[2])).toBe(-72);
    expect(rowOffset(rows[0])).toBe(36);
    expect(rowOffset(rows[1])).toBe(36);
    fireEvent.keyDown(handle, { key: 'Escape' });
    expect(rows.map(rowOffset)).toEqual([0, 0, 0]);
    expect(move).not.toHaveBeenCalled();
    expect(handle).toHaveFocus();
  } finally {
    window.PointerEvent = pointer;
  }
});
