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

import BottomBox from '@/components/ChatBox/BottomBox';
import useChatStoreAdapter from '@/hooks/useChatStoreAdapter';
import { inferSessionModeFromTask } from '@/lib/sessionMode';
import { usePageTabStore } from '@/store/pageTabStore';
import { SessionMode, type SessionModeType } from '@/types/constants';
import { WebTaskMessageList } from '@web/components/dispatch/WebTaskMessageList';
import { useWebTaskChatSend } from '@web/hooks/useWebTaskChatSend';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

const CHAT_SCROLL_BOTTOM_MIN_PX = 128;
const CHAT_SCROLL_BOTTOM_GAP_PX = 8;
/** Matches `.scrollbar-always-visible` track width in desktop styles. */
const CHAT_SCROLLBAR_GUTTER_PX = 8;
const CHAT_SCROLL_CLASS =
  'scrollbar-always-visible min-h-0 min-w-0 flex-1 overflow-y-scroll overflow-x-hidden pl-2';
const CHAT_COLUMN_CLASS =
  'mx-auto flex min-h-full w-full max-w-[600px] flex-col';
const EMPTY_STATE_SHELL_CLASS =
  'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden';
const EMPTY_STATE_SECTION_CLASS =
  'mx-auto flex w-full max-w-[600px] flex-col items-center px-2';
const BOTTOM_BOX_OVERLAY_SHELL_CLASS =
  'pointer-events-auto mx-auto w-full max-w-[600px]';
const BOTTOM_BOX_OVERLAY_CLASS =
  'pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center';

type ChatHorizontalInsets = {
  left: number;
  right: number;
};

const DEFAULT_CHAT_HORIZONTAL_INSETS: ChatHorizontalInsets = {
  left: CHAT_SCROLLBAR_GUTTER_PX,
  right: CHAT_SCROLLBAR_GUTTER_PX,
};

export function WebTaskChatBox() {
  const { chatStore } = useChatStoreAdapter();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [message, setMessage] = useState('');
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bottomBoxOverlayRef = useRef<HTMLDivElement>(null);
  const [scrollBottomInsetPx, setScrollBottomInsetPx] = useState(
    CHAT_SCROLL_BOTTOM_MIN_PX
  );
  const [chatHorizontalInsets, setChatHorizontalInsets] = useState(
    DEFAULT_CHAT_HORIZONTAL_INSETS
  );

  const scrollToBottom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    window.setTimeout(() => {
      container.scrollTo({
        top: container.scrollHeight + 20,
        behavior: 'smooth',
      });
    }, 200);
  }, []);

  const {
    textareaRef,
    isInputDisabled,
    handleSend,
    handleFileSelect,
    hasModel,
  } = useWebTaskChatSend({
    message,
    setMessage,
    onSent: scrollToBottom,
  });

  const sessionSidePanelMode = usePageTabStore(
    (state) => state.sessionSidePanelMode ?? SessionMode.SINGLE_AGENT
  );
  const setSessionSidePanelMode = usePageTabStore(
    (state) => state.setSessionSidePanelMode
  );

  const activeTask = chatStore?.activeTaskId
    ? chatStore.tasks[chatStore.activeTaskId]
    : null;
  const hasAnyMessages = Boolean(activeTask?.messages?.length);
  const inferredSessionMode = inferSessionModeFromTask(activeTask, null);
  const effectiveSessionMode = inferredSessionMode ?? sessionSidePanelMode;
  const sessionModeSelectInteractive = !hasAnyMessages;
  const coworkModeLabel =
    effectiveSessionMode === SessionMode.SINGLE_AGENT
      ? t('layout.workspace-session-single-agent', {
          defaultValue: 'Single Agent',
        })
      : t('layout.workspace-session-workforce', {
          defaultValue: 'Workforce',
        });

  const handleSessionModeChange = useCallback(
    (mode: SessionModeType) => {
      setSessionSidePanelMode(mode);
      if (chatStore?.activeTaskId) {
        chatStore.setTaskSessionMode(chatStore.activeTaskId, mode);
      }
    },
    [chatStore, setSessionSidePanelMode]
  );

  const bottomInputProps = useMemo(
    () => ({
      value: message,
      onChange: setMessage,
      onSend: () => void handleSend(),
      files:
        chatStore?.activeTaskId &&
        chatStore.tasks[chatStore.activeTaskId]?.attaches?.map((file) => ({
          fileName: file.fileName,
          filePath: file.filePath,
        })),
      onFilesChange: (files: { fileName: string; filePath: string }[]) => {
        if (!chatStore?.activeTaskId) return;
        chatStore.setAttaches(chatStore.activeTaskId, files as File[]);
      },
      onAddFile: () => void handleFileSelect(),
      disabled: isInputDisabled,
      textareaRef,
      allowDragDrop: true,
      placeholder: hasAnyMessages ? t('chat.follow-up-placeholder') : undefined,
      sessionMode: effectiveSessionMode,
      onSessionModeChange: handleSessionModeChange,
      sessionModeSelectInteractive,
    }),
    [
      chatStore,
      handleFileSelect,
      handleSend,
      handleSessionModeChange,
      hasAnyMessages,
      isInputDisabled,
      message,
      effectiveSessionMode,
      sessionModeSelectInteractive,
      t,
      textareaRef,
    ]
  );

  const bottomBox = (
    <BottomBox
      state="input"
      noModelOverlay={!hasModel}
      onSelectModel={() => navigate('/profile')}
      inputProps={bottomInputProps}
    />
  );

  useLayoutEffect(() => {
    if (!hasAnyMessages) {
      setScrollBottomInsetPx(CHAT_SCROLL_BOTTOM_MIN_PX);
      return;
    }

    const scroll = scrollContainerRef.current;
    if (!scroll) return;

    const updateHorizontalInsets = () => {
      const left =
        parseFloat(getComputedStyle(scroll).paddingLeft) ||
        DEFAULT_CHAT_HORIZONTAL_INSETS.left;
      const measuredScrollbar = scroll.offsetWidth - scroll.clientWidth;
      setChatHorizontalInsets({
        left,
        right: Math.max(CHAT_SCROLLBAR_GUTTER_PX, measuredScrollbar),
      });
    };

    updateHorizontalInsets();
    const scrollObserver = new ResizeObserver(updateHorizontalInsets);
    scrollObserver.observe(scroll);
    return () => scrollObserver.disconnect();
  }, [chatStore?.activeTaskId, hasAnyMessages]);

  useLayoutEffect(() => {
    if (!hasAnyMessages) {
      setScrollBottomInsetPx(CHAT_SCROLL_BOTTOM_MIN_PX);
      return;
    }

    const overlay = bottomBoxOverlayRef.current;
    if (!overlay) {
      setScrollBottomInsetPx(CHAT_SCROLL_BOTTOM_MIN_PX);
      return;
    }

    const updateInset = () => {
      const height = overlay.getBoundingClientRect().height;
      setScrollBottomInsetPx(
        Math.max(CHAT_SCROLL_BOTTOM_MIN_PX, height + CHAT_SCROLL_BOTTOM_GAP_PX)
      );
    };

    updateInset();
    const observer = new ResizeObserver(updateInset);
    observer.observe(overlay);
    return () => observer.disconnect();
  }, [chatStore?.activeTaskId, hasAnyMessages]);

  useEffect(() => {
    if (!hasAnyMessages) return;
    scrollToBottom();
  }, [
    activeTask?.messages.length,
    activeTask?.status,
    hasAnyMessages,
    scrollToBottom,
  ]);

  if (!chatStore?.activeTaskId) {
    return null;
  }

  return (
    <div className="min-h-0 relative flex h-full w-full flex-1 flex-col overflow-hidden">
      {hasAnyMessages ? (
        <>
          <div
            ref={scrollContainerRef}
            className={CHAT_SCROLL_CLASS}
            style={{ paddingBottom: scrollBottomInsetPx }}
          >
            <div className={CHAT_COLUMN_CLASS}>
              <div className="pt-4 flex flex-col justify-start">
                <WebTaskMessageList task={activeTask} />
              </div>
            </div>
          </div>

          <div
            ref={bottomBoxOverlayRef}
            data-bottom-box-overlay
            className={BOTTOM_BOX_OVERLAY_CLASS}
            style={{
              paddingLeft: chatHorizontalInsets.left,
              paddingRight: chatHorizontalInsets.right,
            }}
          >
            <div className={BOTTOM_BOX_OVERLAY_SHELL_CLASS}>{bottomBox}</div>
          </div>
        </>
      ) : (
        <div className={EMPTY_STATE_SHELL_CLASS}>
          <div
            className={`${EMPTY_STATE_SECTION_CLASS} min-h-0 pb-4 flex-[2] justify-end`}
          >
            <h1 className="text-heading-lg font-bold text-ds-text-neutral-default-default w-full text-center">
              <span className="block">
                {t('layout.workspace-cowork-with', {
                  defaultValue: 'Cowork with',
                })}
              </span>
              <span className="block">{coworkModeLabel}</span>
            </h1>
          </div>

          <div className={`${EMPTY_STATE_SECTION_CLASS} shrink-0`}>
            {bottomBox}
          </div>

          <div
            className="min-h-0 flex-[3]"
            data-empty-state-prompt-slot
            aria-hidden
          />
        </div>
      )}
    </div>
  );
}
