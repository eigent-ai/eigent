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
// Licensed under the Apache License, Version 2.0 (the "License");

import { TeachAnnotationCard } from '@/components/TeachMode/TeachAnnotationCard';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import { useHost } from '@/host';
import {
  isTeachAnnotationRequest,
  TEACH_ANNOTATION_REQUEST_CHANNEL,
  TEACH_MODE_ENABLED_CHANNEL,
  type TeachAnnotationRequest,
} from '@/shared/teachAnnotation';
import { getSessionPreviewSlice, usePageTabStore } from '@/store/pageTabStore';
import { useProjectRuntimeStore } from '@/store/projectRuntimeStore';
import { useSpaceStore } from '@/store/spaceStore';
import {
  type TeachFeedbackSourceType,
  type TeachFeedbackTarget,
  type TeachFileReference,
  useTeachModeStore,
} from '@/store/teachModeStore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type FloatingAnnotation = {
  kind: 'menu' | 'quick';
  target: TeachFeedbackTarget;
  x: number;
  y: number;
};

const SOURCE_SELECTOR = [
  '[data-teach-feedback-source]',
  '[data-detailed-trace-row]',
  '[data-narrative-event-motion-id]',
  '[data-run-id]',
].join(',');

function sourceTypeFor(id: string): TeachFeedbackSourceType {
  if (id.startsWith('artifact:')) return 'artifact';
  if (id.startsWith('file:')) return 'file';
  if (id.startsWith('browser:')) return 'browser';
  if (id.startsWith('review:')) return 'review';
  if (id.startsWith('terminal:')) return 'terminal';
  if (id.startsWith('run:')) return 'run';
  if (id.startsWith('work-log:') || id.startsWith('agent-')) return 'agent-log';
  return 'agent-log';
}

function sourceAt(element: Element | null) {
  const marker = element?.closest<HTMLElement>(SOURCE_SELECTOR);
  const sourceId =
    marker?.dataset.teachFeedbackSource ||
    marker?.dataset.detailedTraceRow ||
    marker?.dataset.narrativeEventMotionId ||
    marker?.dataset.runId;
  return { marker, sourceId };
}

function selectedTextFromPage(): string {
  return window.getSelection()?.toString().trim().slice(0, 10000) ?? '';
}

export function TeachAnnotationLayer() {
  const { t } = useTranslation();
  const host = useHost();
  const enabled = useTeachModeStore((state) => state.enabled);
  const addAnnotation = useTeachModeStore((state) => state.addAnnotation);
  const setPendingAnnotation = useTeachModeStore(
    (state) => state.setPendingAnnotation
  );
  const [floating, setFloating] = useState<FloatingAnnotation | null>(null);
  const [comment, setComment] = useState('');
  const [references, setReferences] = useState<TeachFileReference[]>([]);
  const terminalSelection = useRef('');

  const makeTarget = useCallback(
    (element: Element | null, selectionText: string, pageUrl?: string) => {
      const spaceId = useSpaceStore.getState().activeSpaceId;
      const pageTabs = usePageTabStore.getState();
      const projectId =
        pageTabs.sessionPreviewProjectId ??
        useProjectRuntimeStore.getState().activeProjectId ??
        '';
      if (!spaceId) return null;

      if (pageUrl) {
        const slice = getSessionPreviewSlice(pageTabs);
        const browser = slice.tabs.find(
          (tab) => tab.type === 'browser' && tab.id === slice.activeTabId
        );
        return {
          spaceId,
          projectId,
          sourceType: 'browser' as const,
          sourceId: browser ? `browser:${browser.id}` : `browser:${pageUrl}`,
          contextLabel:
            browser?.title ||
            t('chat.teach-browser', { defaultValue: 'Browser' }),
          contextDetail: pageUrl,
          selectedText: selectionText,
        };
      }

      const { marker, sourceId } = sourceAt(element);
      const resolvedId = sourceId || `session:${projectId}`;
      const sourceType = marker?.dataset.teachAnnotationSourceType
        ? (marker.dataset.teachAnnotationSourceType as TeachFeedbackSourceType)
        : marker?.dataset.runId
          ? 'run'
          : marker?.dataset.detailedTraceRow ||
              marker?.dataset.narrativeEventMotionId
            ? 'agent-log'
            : sourceId
              ? sourceTypeFor(sourceId)
              : 'session';
      const runId =
        element?.closest<HTMLElement>('[data-run-id]')?.dataset.runId;
      const isSpecificLog = Boolean(
        marker?.matches(
          '[data-detailed-trace-row], [data-narrative-event-motion-id]'
        )
      );
      const label =
        marker?.dataset.teachAnnotationLabel ||
        marker?.getAttribute('aria-label') ||
        marker?.getAttribute('title') ||
        (sourceType === 'terminal'
          ? t('chat.teach-terminal', { defaultValue: 'Terminal' })
          : sourceType === 'session'
            ? t('chat.teach-session', { defaultValue: 'Session' })
            : marker?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80)) ||
        resolvedId;
      const sourceText =
        selectionText ||
        (sourceType === 'agent-log' ||
        sourceType === 'run' ||
        sourceType === 'artifact'
          ? marker?.innerText.trim().slice(0, 10000)
          : '');
      return {
        spaceId,
        projectId,
        runId,
        sourceType,
        sourceId: resolvedId,
        contextLabel: label,
        contextDetail:
          marker?.dataset.teachAnnotationDetail ||
          (isSpecificLog
            ? t('chat.teach-agent-log', { defaultValue: 'Agent log' })
            : undefined),
        selectedText: sourceText,
      };
    },
    [t]
  );

  const openAnnotationTab = useCallback(
    (
      target: TeachFeedbackTarget,
      x = window.innerWidth / 2,
      y = window.innerHeight / 3
    ) => {
      if (
        usePageTabStore.getState().sessionPreviewProjectId !== target.projectId
      ) {
        setComment('');
        setReferences([]);
        setFloating({ kind: 'quick', target, x, y });
        return;
      }
      setFloating(null);
      setPendingAnnotation(target);
      usePageTabStore.getState().openPreviewTab('feedback');
    },
    [setPendingAnnotation]
  );

  const openRequest = useCallback(
    (request: TeachAnnotationRequest, element?: Element | null) => {
      const browserViewport =
        request.surfaceKind === 'preview-guest'
          ? usePageTabStore.getState().previewBrowserViewport
          : null;
      const x =
        browserViewport && request.x !== undefined
          ? browserViewport.x + request.x
          : (request.x ??
            (browserViewport
              ? browserViewport.x + browserViewport.width / 2
              : window.innerWidth / 2));
      const y =
        browserViewport && request.y !== undefined
          ? browserViewport.y + request.y
          : (request.y ??
            (browserViewport
              ? browserViewport.y + browserViewport.height / 3
              : window.innerHeight / 3));
      const sourceElement =
        element ??
        (request.surfaceKind === 'main-renderer' && request.x !== undefined
          ? document.elementFromPoint(x, y)
          : document.activeElement);
      const selectionText = (
        request.selectionText ||
        (sourceElement?.closest('[data-teach-feedback-source^="terminal:"]')
          ? terminalSelection.current
          : selectedTextFromPage())
      )
        .trim()
        .slice(0, 10000);
      const target = makeTarget(sourceElement, selectionText, request.pageUrl);
      if (!target) return;
      if (request.action === 'annotate') {
        openAnnotationTab(target, x, y);
      } else {
        setComment('');
        setReferences([]);
        setFloating({
          kind: 'quick',
          target,
          x: Math.min(x, window.innerWidth - 32),
          y: Math.min(y, window.innerHeight - 32),
        });
      }
    },
    [makeTarget, openAnnotationTab]
  );

  useEffect(() => {
    host?.ipcRenderer?.send(TEACH_MODE_ENABLED_CHANNEL, enabled);
    if (!enabled) setFloating(null);
    return () => host?.ipcRenderer?.send(TEACH_MODE_ENABLED_CHANNEL, false);
  }, [enabled, host]);

  useEffect(() => {
    if (!enabled) return;
    const onNativeRequest = (_event: unknown, payload: unknown) => {
      if (isTeachAnnotationRequest(payload)) openRequest(payload);
    };
    host?.ipcRenderer?.on(TEACH_ANNOTATION_REQUEST_CHANNEL, onNativeRequest);
    return () => {
      host?.ipcRenderer?.off(TEACH_ANNOTATION_REQUEST_CHANNEL, onNativeRequest);
    };
  }, [enabled, host, openRequest]);

  useEffect(() => {
    if (!enabled) return;
    const onContextMenu = (event: MouseEvent) => {
      if (host?.electronAPI) return;
      const target = makeTarget(
        event.target as Element,
        selectedTextFromPage()
      );
      if (!target) return;
      event.preventDefault();
      setComment('');
      setReferences([]);
      setFloating({ kind: 'menu', target, x: event.clientX, y: event.clientY });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== 'a' ||
        !event.shiftKey ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.repeat
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest('[data-teach-feedback-source^="terminal:"]')
      )
        return;
      event.preventDefault();
      const selection = window.getSelection();
      const selectedText = selectedTextFromPage();
      const anchorNode = selectedText ? selection?.anchorNode : null;
      const element =
        (anchorNode instanceof Element
          ? anchorNode
          : anchorNode?.parentElement) ?? document.activeElement;
      const rect = selection?.rangeCount
        ? selection.getRangeAt(0).getBoundingClientRect()
        : element?.getBoundingClientRect();
      openRequest(
        {
          action: 'quick',
          surfaceKind: 'main-renderer',
          selectionText: selectedText,
          x: rect?.left,
          y: rect?.bottom,
        },
        element
      );
    };
    const onTerminalSelection = (event: Event) => {
      terminalSelection.current = (event as CustomEvent<string>).detail;
    };
    const onTerminalShortcut = (event: Event) => {
      const selectionText = (event as CustomEvent<string>).detail;
      const element = document.activeElement;
      const rect = element?.getBoundingClientRect();
      openRequest(
        {
          action: 'quick',
          surfaceKind: 'main-renderer',
          selectionText,
          x: rect?.left,
          y: rect?.bottom,
        },
        element
      );
    };
    window.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('teach-terminal-selection', onTerminalSelection);
    window.addEventListener('teach-terminal-shortcut', onTerminalShortcut);
    return () => {
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener(
        'teach-terminal-selection',
        onTerminalSelection
      );
      window.removeEventListener('teach-terminal-shortcut', onTerminalShortcut);
    };
  }, [enabled, host, makeTarget, openRequest]);

  if (!enabled || !floating) return null;

  const close = () => setFloating(null);
  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <PopoverAnchor asChild>
        <span
          aria-hidden
          className="pointer-events-none fixed size-px"
          style={{ left: floating.x, top: floating.y }}
        />
      </PopoverAnchor>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={8}
        className={
          floating.kind === 'menu'
            ? '!w-[min(360px,calc(100vw-24px))] p-ds-control-inline'
            : 'scrollbar-always-visible max-h-[var(--radix-popover-content-available-height)] !w-[min(360px,calc(100vw-24px))] overflow-y-auto p-0'
        }
      >
        {floating.kind === 'menu' ? (
          <div className="flex flex-col gap-1">
            <Button
              variant="text"
              size="sm"
              onClick={() => setFloating({ ...floating, kind: 'quick' })}
            >
              {t('chat.teach-quick-annotate', {
                defaultValue: 'Quick annotate',
              })}
            </Button>
            <Button
              variant="text"
              size="sm"
              onClick={() =>
                openAnnotationTab(floating.target, floating.x, floating.y)
              }
            >
              {t('chat.teach-annotate', { defaultValue: 'Annotate' })}
            </Button>
          </div>
        ) : (
          <TeachAnnotationCard
            target={floating.target}
            comment={comment}
            onCommentChange={setComment}
            references={references}
            onReferencesChange={setReferences}
            onSave={() => {
              addAnnotation(floating.target, comment, references);
              close();
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
