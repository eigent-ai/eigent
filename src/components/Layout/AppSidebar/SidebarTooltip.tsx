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
  TooltipSimple,
  tooltipOpenDelayMs,
  tooltipSurfaceProps,
  type TooltipVariant,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { motion, useReducedMotion } from 'framer-motion';
import {
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/** Fixed gap between the hovered tab's right edge and the tooltip. */
export const SIDEBAR_TOOLTIP_GAP_PX = 2;
/** Keeps the tooltip this far inside the window's bottom edge. */
const VIEWPORT_MARGIN_PX = 8;
/** Grace period so moving between rows doesn't close and reopen the shell. */
const HIDE_GRACE_MS = 80;

interface SidebarTooltipRequest {
  /** The row's own id, so only it can close what it opened. */
  owner: string;
  anchor: HTMLElement;
  content: ReactNode;
  className?: string;
  variant: TooltipVariant;
}

interface SidebarTooltipApi {
  show: (request: SidebarTooltipRequest) => void;
  hide: (owner?: string) => void;
}

const SidebarTooltipContext = createContext<SidebarTooltipApi | null>(null);

interface ShellState {
  owner: string;
  content: ReactNode;
  className?: string;
  /** Row top and bottom in viewport coordinates. */
  top: number;
  bottom: number;
  left: number;
  /** False on the first frame after opening, so it appears in place. */
  moving: boolean;
}

/**
 * One tooltip for a whole sidebar. It sits a fixed gap past the hovered tab's
 * right edge, lines up with the top of the hovered row, and slides to the
 * next row instead of closing and reopening; only its text changes. Near the
 * window's bottom it lines up with the row's bottom instead.
 */
export function SidebarTooltipProvider({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const [shell, setShell] = useState<ShellState | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const shellOpen = useRef(false);
  const showTimer = useRef<ReturnType<typeof setTimeout>>();
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  const [shellHeight, setShellHeight] = useState(0);
  useLayoutEffect(() => {
    shellOpen.current = shell !== null;
  }, [shell]);

  const clearTimers = () => {
    clearTimeout(showTimer.current);
    clearTimeout(hideTimer.current);
  };

  const show = useCallback(
    ({ owner, anchor, content, className, variant }: SidebarTooltipRequest) => {
      clearTimers();
      const place = () => {
        const row = anchor.getBoundingClientRect();
        setShell({
          owner,
          content,
          className,
          top: row.top,
          bottom: row.bottom,
          left: row.right + SIDEBAR_TOOLTIP_GAP_PX,
          moving: shellOpen.current,
        });
      };
      // An open shell moves at once; a closed one waits for the variant's delay.
      if (shellOpen.current) place();
      else showTimer.current = setTimeout(place, tooltipOpenDelayMs(variant));
    },
    []
  );

  const hide = useCallback((owner?: string) => {
    clearTimeout(showTimer.current);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setShell((current) =>
        !owner || current?.owner === owner ? null : current
      );
    }, HIDE_GRACE_MS);
  }, []);

  // Scrolling, clicking or resizing moves rows away from the tooltip.
  useEffect(() => {
    if (!shell) return;
    const close = () => {
      clearTimers();
      setShell(null);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('resize', close);
    };
  }, [shell]);

  useEffect(() => clearTimers, []);

  useLayoutEffect(() => {
    if (shellRef.current) setShellHeight(shellRef.current.offsetHeight);
  }, [shell?.content]);

  const api = useMemo(() => ({ show, hide }), [show, hide]);
  const surface = tooltipSurfaceProps(shell?.className);
  const fitsBelowTop =
    !shell ||
    shell.top + shellHeight <= window.innerHeight - VIEWPORT_MARGIN_PX;
  const top = shell
    ? fitsBelowTop
      ? shell.top
      : shell.bottom - shellHeight
    : 0;

  return (
    <SidebarTooltipContext.Provider value={api}>
      {children}
      {shell
        ? createPortal(
            <motion.div
              ref={shellRef}
              role="tooltip"
              aria-hidden
              data-sidebar-tooltip
              className={cn(surface.className, 'pointer-events-none fixed')}
              style={{ ...surface.style, left: shell.left, top: 0 }}
              initial={false}
              animate={{ y: top }}
              transition={
                shell.moving && !reduceMotion
                  ? { type: 'tween', duration: 0.14, ease: [0.23, 1, 0.32, 1] }
                  : { duration: 0 }
              }
            >
              {shell.content}
            </motion.div>,
            document.body
          )
        : null}
    </SidebarTooltipContext.Provider>
  );
}

interface SidebarRowTooltipProps {
  content: ReactNode;
  children: ReactElement;
  enabled?: boolean;
  variant?: TooltipVariant;
  className?: string;
  /** The row the tooltip lines up with; defaults to the trigger itself. */
  rowSelector?: string;
}

function isFocusVisible(target: EventTarget): boolean {
  try {
    return target instanceof Element && target.matches(':focus-visible');
  } catch {
    return false;
  }
}

type TriggerHandlers = {
  onPointerEnter?: (event: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (event: PointerEvent<HTMLElement>) => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
};

/**
 * A sidebar row's tooltip. Inside a sidebar shell it uses the shared,
 * moving tooltip; anywhere else it falls back to a normal tooltip.
 */
export function SidebarRowTooltip({
  content,
  children,
  enabled = true,
  variant = 'instant',
  className,
  rowSelector,
}: SidebarRowTooltipProps) {
  const api = useContext(SidebarTooltipContext);
  const owner = useId();

  // A row that turns its tooltip off (an open menu, a fold) drops it.
  useEffect(() => {
    if (!enabled) api?.hide(owner);
  }, [api, enabled, owner]);

  if (!api || !isValidElement(children)) {
    return (
      <TooltipSimple
        content={content}
        side="right"
        align="start"
        enabled={enabled}
        variant={variant}
        className={className}
      >
        {children}
      </TooltipSimple>
    );
  }

  const child = children as ReactElement<TriggerHandlers>;
  const anchorFor = (element: HTMLElement) =>
    rowSelector
      ? (element.closest<HTMLElement>(rowSelector) ?? element)
      : element;
  const open = (element: HTMLElement) => {
    if (!enabled || content == null || content === '') return;
    api.show({
      owner,
      anchor: anchorFor(element),
      content,
      className,
      variant,
    });
  };

  return cloneElement(child, {
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      child.props.onPointerEnter?.(event);
      if (event.pointerType !== 'touch') open(event.currentTarget);
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      child.props.onPointerLeave?.(event);
      api.hide(owner);
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      child.props.onFocus?.(event);
      // Keyboard focus only: a click also focuses, and shows on hover anyway.
      if (isFocusVisible(event.target)) open(event.currentTarget);
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      child.props.onBlur?.(event);
      api.hide(owner);
    },
  });
}
