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

/**
 * One line shape for every row in the Narrative task log.
 *
 * A line is an icon (or avatar), a title that truncates, and an optional
 * description that does not. A line that has detail becomes a trigger: the
 * same line inside a button, with a trailing chevron. A line with nothing to
 * reveal stays plain text, so the reader never opens an empty row.
 *
 * Status belongs to the line. `running` lets the title shimmer and `error`
 * turns the whole line to the error tone. Color is never the only signal:
 * callers put the status in words in the title or the description.
 */

import { DsIcon, type DsIconProps } from '@/components/ui/ds-icon';
import { DS_FOCUS_RING } from '@/components/ui/semanticProps';
import ShinyText from '@/components/ui/ShinyText/ShinyText';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react';

import { disclosureMotion } from './shared';

export type TaskLogStatus = 'running' | 'error';

/** `row` is one action; `section` heads a whole Run's work log. */
export type TaskLogVariant = 'row' | 'section';

/** Derived rows read as `subtle`; actor and Run headers as `muted`. */
export type TaskLogEmphasis = 'subtle' | 'muted';

interface TaskLogLineAxes {
  status?: TaskLogStatus;
  variant?: TaskLogVariant;
  emphasis?: TaskLogEmphasis;
}

function lineClassName({
  status,
  variant = 'row',
  emphasis = 'subtle',
}: TaskLogLineAxes): string {
  return cn(
    'group min-w-0 items-center gap-ds-6 text-left',
    variant === 'row'
      ? 'inline-flex max-w-full self-start rounded-ds-compact-control px-0 py-ds-2'
      : 'flex w-full border-x-0 border-t-0 border-b border-solid border-ds-hairline-subtle-default px-0 py-ds-4',
    status === 'error'
      ? 'text-ds-text-status-error-default-default'
      : emphasis === 'muted'
        ? 'text-ds-ink-muted-default'
        : 'text-ds-ink-subtle-default'
  );
}

/**
 * Who decides whether a row is open.
 *
 * `auto` is the row's own opinion (for example: open while it waits for the
 * user). Each time that opinion changes the row follows it; between changes
 * the reader's last click wins. `initialOpen` restores a click from before a
 * remount, such as a call moving into a repeated-call group.
 */
export function useTaskLogOpenState(
  auto: boolean,
  initialOpen?: boolean
): [boolean, (open: boolean) => void] {
  const [state, setState] = useState<{
    auto: boolean;
    manual: boolean | null;
  }>(() => ({ auto, manual: initialOpen ?? null }));
  let current = state;
  if (state.auto !== auto) {
    current = { auto, manual: null };
    setState(current);
  }
  const setOpen = useCallback(
    (open: boolean) => setState((value) => ({ ...value, manual: open })),
    []
  );
  return [current.manual ?? auto, setOpen];
}

interface TaskLogCollapsibleContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  contentId: string;
  reducedMotion: boolean;
}

const TaskLogCollapsibleContext =
  createContext<TaskLogCollapsibleContextValue | null>(null);

function useTaskLogCollapsible(part: string): TaskLogCollapsibleContextValue {
  const value = useContext(TaskLogCollapsibleContext);
  if (!value) {
    throw new Error(`${part} must be rendered inside TaskLogCollapsible`);
  }
  return value;
}

export function TaskLogCollapsible({
  open,
  onOpenChange,
  reducedMotion,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reducedMotion: boolean;
}) {
  const contentId = useId();
  return (
    <TaskLogCollapsibleContext.Provider
      value={{ open, setOpen: onOpenChange, contentId, reducedMotion }}
    >
      <div
        className={cn('flex w-full min-w-0 flex-col items-start', className)}
        {...props}
      >
        {children}
      </div>
    </TaskLogCollapsibleContext.Provider>
  );
}

/** A line with nothing to reveal. Read as text, never a tab stop. */
export function TaskLogLine({
  status,
  variant,
  emphasis,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & TaskLogLineAxes) {
  return (
    <div
      className={cn(lineClassName({ status, variant, emphasis }), className)}
      data-task-log-status={status}
      {...props}
    >
      {children}
    </div>
  );
}

type DataAttributes = { [key: `data-${string}`]: string | boolean | undefined };

/** The same line inside a button that toggles its `TaskLogContent`. */
export function TaskLogTrigger({
  status,
  variant,
  emphasis,
  chevronProps,
  className,
  children,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  TaskLogLineAxes & { chevronProps?: DataAttributes }) {
  const { open, setOpen, contentId } = useTaskLogCollapsible('TaskLogTrigger');
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={open ? contentId : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) setOpen(!open);
      }}
      className={cn(
        lineClassName({ status, variant, emphasis }),
        'transition-opacity hover:opacity-80',
        DS_FOCUS_RING,
        className
      )}
      data-task-log-status={status}
      {...props}
    >
      {children}
      <DsIcon
        icon={ChevronRight}
        className={cn(
          'transition-[opacity,transform] duration-200 motion-reduce:transition-none',
          open
            ? 'rotate-90 opacity-100'
            : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100'
        )}
        data-task-log-chevron
        {...chevronProps}
      />
    </button>
  );
}

/** Names the action. Takes the line's color. */
export function TaskLogIcon(props: Omit<DsIconProps, 'recipe'>) {
  return <DsIcon recipe="main" {...props} />;
}

const TITLE_CLASS =
  'min-w-0 shrink overflow-hidden !text-ds-text-base text-ellipsis whitespace-nowrap';

/**
 * The single-line sentence. It truncates; the full text must reappear in the
 * row's content or accessible name. `shimmer` marks the one live action.
 */
export function TaskLogTitle({
  children,
  shimmer = false,
  weight = 'normal',
  className,
  ...props
}: Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  children: string;
  shimmer?: boolean;
  weight?: 'normal' | 'medium';
}) {
  const weightClass = weight === 'medium' ? '!font-medium' : '!font-normal';
  if (shimmer) {
    return (
      <ShinyText
        speed={2.5}
        text={children}
        className={cn(TITLE_CLASS, weightClass, className)}
      />
    );
  }
  return (
    <span className={cn(TITLE_CLASS, weightClass, className)} {...props}>
      {children}
    </span>
  );
}

/**
 * Short facts after the title: a status word, a duration, a count. Unlike
 * the title it never truncates, so it stays readable on a narrow pane.
 */
export function TaskLogDescription({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'shrink-0 !text-ds-text-meta font-normal whitespace-nowrap tabular-nums',
        className
      )}
      data-task-log-description
      {...props}
    >
      {children}
    </span>
  );
}

/**
 * Detail for an open line. `indent` lines the content up under the title,
 * past the icon column, so nested rows read as children of the line above.
 */
export function TaskLogContent({
  indent = true,
  blockInset = 'top',
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  indent?: boolean;
  /**
   * `top` leaves a small gap under the trigger; `even` pads the content
   * equally above and below. Set here rather than through `className`,
   * which cannot override the default `ds` padding.
   */
  blockInset?: 'top' | 'even';
  children: ReactNode;
}) {
  const { open, contentId, reducedMotion } =
    useTaskLogCollapsible('TaskLogContent');
  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          key="task-log-content"
          id={contentId}
          {...disclosureMotion(reducedMotion)}
          className={cn(
            'w-full min-w-0 overflow-hidden',
            indent && 'grid grid-cols-[auto_minmax(0,1fr)] gap-x-ds-6'
          )}
        >
          {indent ? (
            <span aria-hidden className="w-ds-icon-main" data-task-log-indent />
          ) : null}
          <div
            className={cn(
              'flex w-full min-w-0 flex-col',
              blockInset === 'even' ? 'py-ds-8' : 'pt-ds-4',
              className
            )}
            {...props}
          >
            {children}
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
