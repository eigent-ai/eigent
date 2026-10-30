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

import {
  animate,
  motionValue,
  useReducedMotion,
  type MotionValue,
} from 'framer-motion';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { QueuedMessage } from './QueuedBox';

// Near-critical damping: responsive displacement and a restrained release.
const QUEUE_SPRING = {
  type: 'spring',
  stiffness: 550,
  damping: 42,
  mass: 0.8,
} as const;
type RowMotion = {
  node: HTMLElement;
  y: MotionValue<number>;
  unsubscribe: () => void;
  top: number;
  height: number;
  target: number;
  revision: number;
};
type Gesture = {
  id: string;
  targetId?: string;
  pointerId: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  grabOffset: number;
  moved: boolean;
};

/** Keep DOM/execution order unchanged during the gesture. Transforms preview the
 * new slots; a layout-effect compensation preserves continuity when it commits.
 * Geometry follows the existing animation-measured-values exception. */
export function useQueueReorder({
  messages,
  sessionId,
  disabled,
  listRef,
  onReorder,
}: {
  messages: QueuedMessage[];
  sessionId?: string;
  disabled: boolean;
  listRef: RefObject<HTMLUListElement>;
  onReorder?: (id: string, targetId: string) => void;
}) {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const instructionsId = useId();
  const [draggingId, setDraggingId] = useState<string>();
  const [liftedId, setLiftedId] = useState<string>();
  const [announcement, setAnnouncement] = useState('');
  const motions = useRef(new Map<string, RowMotion>());
  const gesture = useRef<Gesture>();
  const lifted = useRef<string>();
  const frame = useRef<number>();
  const releaseFrame = useRef<number>();
  const lastSession = useRef(sessionId);
  const keyboardCommit = useRef(false);
  const blocked =
    disabled ||
    !onReorder ||
    messages.length < 2 ||
    messages.some(
      (message) => message.processing || message.stopping || message.next
    );
  const canMove = (message: QueuedMessage) =>
    !blocked && message.canReorder !== false;
  const signature = JSON.stringify(messages.map((m) => [m.id, m.canReorder]));

  const clearLift = useCallback((id?: string) => {
    if (lifted.current !== id) return;
    lifted.current = undefined;
    setLiftedId(undefined);
  }, []);
  const moveTo = useCallback(
    (row: RowMotion, target: number, immediate = false, done?: () => void) => {
      row.target = target;
      const revision = ++row.revision;
      row.y.stop();
      if (immediate || reducedMotion || Math.abs(row.y.get() - target) < 0.1) {
        row.y.jump(target);
        done?.();
        return;
      }
      // Animating the existing MotionValue carries its current velocity into the
      // spring. The change subscription writes directly to this row, not React.
      void animate(row.y, target, QUEUE_SPRING).then(() => {
        if (row.revision === revision) done?.();
      });
    },
    [reducedMotion]
  );
  const settle = useCallback(
    (immediate = false) => {
      const id = lifted.current;
      for (const [rowId, row] of motions.current) {
        moveTo(
          row,
          0,
          immediate,
          rowId === id ? () => clearLift(id) : undefined
        );
      }
      if (!id || !motions.current.has(id)) clearLift(id);
    },
    [moveTo, clearLift]
  );
  const clearGesture = useCallback(() => {
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    gesture.current = undefined;
    setDraggingId(undefined);
  }, []);
  const cancel = () => {
    if (!gesture.current) return;
    clearGesture();
    settle();
  };

  const measureRows = useCallback(() => {
    const list = listRef.current;
    if (!list) return [];
    const bounds = list.getBoundingClientRect();
    return Array.from(
      list.querySelectorAll<HTMLElement>('[data-queue-id]')
    ).map((node) => {
      const id = node.dataset.queueId!;
      let row = motions.current.get(id);
      if (!row || row.node !== node) {
        row?.unsubscribe();
        row?.y.destroy();
        const y = motionValue(0);
        const render = (offset: number) => {
          node.style.transform = offset ? `translate3d(0, ${offset}px, 0)` : '';
        };
        row = {
          node,
          y,
          unsubscribe: y.on('change', render),
          top: 0,
          height: 0,
          target: 0,
          revision: 0,
        };
        motions.current.set(id, row);
      }
      const rect = node.getBoundingClientRect();
      return {
        id,
        row,
        top: rect.top - bounds.top + list.scrollTop - row.y.get(),
        height: rect.height,
      };
    });
  }, [listRef]);

  useLayoutEffect(() => {
    const sessionChanged = lastSession.current !== sessionId;
    lastSession.current = sessionId;
    clearGesture();
    const measured = measureRows();
    const present = new Set(measured.map(({ id }) => id));
    for (const [id, row] of motions.current) {
      if (!present.has(id)) {
        row.unsubscribe();
        row.y.destroy();
        motions.current.delete(id);
      }
    }
    for (const { row, top, height } of measured) {
      // FLIP: React has changed the DOM order. Offset it before paint so each
      // row stays at its last visible position, then settle into its new slot.
      const previous = row.y.get();
      const velocity = row.y.getVelocity();
      row.y.stop();
      const offset = previous + (row.height ? row.top - top : 0);
      row.y.setWithVelocity(offset - velocity / 60, offset, 1000 / 60);
      row.top = top;
      row.height = height;
    }
    settle(sessionChanged || keyboardCommit.current);
    keyboardCommit.current = false;
    // Membership/order/admission changes cancel gestures; content updates do not.
  }, [
    sessionId,
    signature,
    blocked,
    reducedMotion,
    clearGesture,
    measureRows,
    settle,
  ]);

  useEffect(
    () => () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      if (releaseFrame.current !== undefined)
        cancelAnimationFrame(releaseFrame.current);
      for (const row of motions.current.values()) {
        row.unsubscribe();
        row.y.destroy();
      }
      motions.current.clear();
    },
    []
  );

  const commit = (id: string, target: string) => {
    const item = messages.find((m) => m.id === id);
    const destination = messages.find((m) => m.id === target);
    if (
      !item ||
      !destination ||
      !canMove(item) ||
      !canMove(destination) ||
      id === target
    )
      return;
    onReorder?.(id, target);
    setAnnouncement(
      t('chat.queue-reordered', {
        task: item.content,
        position: messages.indexOf(destination) + 1,
        count: messages.length,
      })
    );
  };
  const track = () => {
    const drag = gesture.current;
    const list = listRef.current;
    const active = drag && motions.current.get(drag.id);
    if (!drag?.moved || !list || !active) return;
    const bounds = list.getBoundingClientRect();
    const rows = messages.map((m) => motions.current.get(m.id)!);
    const desiredTop = drag.y - drag.grabOffset - bounds.top + list.scrollTop;
    const last = rows[rows.length - 1];
    const maxTop = Math.max(0, last.top + last.height - active.height);
    const top =
      desiredTop < 0
        ? desiredTop * 0.2
        : desiredTop > maxTop
          ? maxTop + (desiredTop - maxTop) * 0.2
          : desiredTop;
    active.y.set(top - active.top);

    // Hit-test immutable slots, never the translated rectangles. Otherwise
    // moving a neighbor changes the hit area and oscillates the destination.
    const center = top + active.height / 2;
    const inside =
      drag.x >= bounds.left &&
      drag.x <= bounds.right &&
      drag.y >= bounds.top &&
      drag.y <= bounds.bottom;
    let closest = -1;
    let distance = Infinity;
    messages.forEach((message, index) => {
      if (!canMove(message)) return;
      const candidateDistance = Math.abs(
        center - (rows[index].top + rows[index].height / 2)
      );
      if (candidateDistance < distance) {
        closest = index;
        distance = candidateDistance;
      }
    });
    const targetId = inside && closest >= 0 ? messages[closest].id : undefined;
    if (drag.targetId === targetId) return;
    drag.targetId = targetId;
    const from = messages.findIndex((m) => m.id === drag.id);
    const order = messages.map((m) => m.id);
    if (targetId) order.splice(closest, 0, order.splice(from, 1)[0]);
    order.forEach((id, index) => {
      if (id === drag.id) return;
      const row = motions.current.get(id)!;
      const offset = rows[index].top - row.top;
      if (row.target !== offset) moveTo(row, offset);
    });
  };
  const autoScroll = () => {
    const drag = gesture.current;
    const list = listRef.current;
    if (!drag || !list) return;
    if (drag.moved) {
      const bounds = list.getBoundingClientRect();
      const rowHeight = motions.current.get(drag.id)?.height ?? 0;
      if (drag.x >= bounds.left && drag.x <= bounds.right) {
        const direction =
          drag.y < bounds.top + rowHeight
            ? -1
            : drag.y > bounds.bottom - rowHeight
              ? 1
              : 0;
        const last = motions.current.get(messages[messages.length - 1].id);
        const maxScroll = Math.max(
          0,
          (last ? last.top + last.height : 0) - list.clientHeight
        );
        list.scrollTop = Math.max(
          0,
          Math.min(maxScroll, list.scrollTop + (direction * rowHeight) / 6)
        );
      }
      track();
    }
    frame.current = requestAnimationFrame(autoScroll);
  };
  const handleProps = (message: QueuedMessage) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || gesture.current || !canMove(message)) return;
      if (releaseFrame.current !== undefined)
        cancelAnimationFrame(releaseFrame.current);
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      // Re-measure before grabbing, including a row caught mid-settle.
      for (const { row, top, height } of measureRows()) {
        row.top = top;
        row.height = height;
      }
      const row = motions.current.get(message.id)!;
      row.y.stop();
      ++row.revision;
      gesture.current = {
        id: message.id,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        grabOffset: event.clientY - row.node.getBoundingClientRect().top,
        moved: false,
      };
      frame.current = requestAnimationFrame(autoScroll);
    },
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
      const drag = gesture.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag.x = event.clientX;
      drag.y = event.clientY;
      if (
        !drag.moved &&
        Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 4
      ) {
        drag.moved = true;
        lifted.current = drag.id;
        setLiftedId(drag.id);
        setDraggingId(drag.id);
      }
      track();
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      const drag = gesture.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag.x = event.clientX;
      drag.y = event.clientY;
      track();
      clearGesture();
      if (drag.moved && drag.targetId && drag.targetId !== drag.id) {
        commit(drag.id, drag.targetId);
        // A stale guard may decline the commit. Still settle the visual preview.
        releaseFrame.current = requestAnimationFrame(() => {
          if (!gesture.current) settle();
        });
      } else settle();
    },
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Escape') {
        cancel();
        return;
      }
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      if (gesture.current || !canMove(message)) return;
      const movable = messages.filter(canMove);
      const index = movable.findIndex((m) => m.id === message.id);
      const target = movable[index + (event.key === 'ArrowUp' ? -1 : 1)];
      if (target) {
        keyboardCommit.current = true;
        settle(true);
        commit(message.id, target.id);
      }
      requestAnimationFrame(() =>
        motions.current
          .get(message.id)
          ?.node.scrollIntoView?.({ block: 'nearest' })
      );
    },
  });
  return {
    instructionsId,
    announcement,
    draggingId,
    liftedId,
    canMove,
    handleProps,
  };
}
