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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DsText } from '@/components/ui/ds-text';
import {
  assertExecutionScope,
  fetchExecutionArtifacts,
  readExecutionArtifact,
  type ExecutionScope,
} from '@/service/executionApi';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

const Context = createContext<((runId: string, file: FileInfo) => void) | null>(
  null
);
export const useSessionArtifactPreview = () => useContext(Context);

export function SessionArtifactPreview({
  scope,
  children,
  enabled = true,
}: {
  scope: ExecutionScope;
  children: ReactNode;
  enabled?: boolean;
}) {
  const parent = useSessionArtifactPreview();
  const { t } = useTranslation();
  const request = useRef<AbortController | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [preview, setPreview] = useState<{
    name: string;
    text?: string;
    revision?: string;
    error?: boolean;
    truncated?: boolean;
  } | null>(null);
  useEffect(() => () => request.current?.abort(), [scope]);
  const open = async (runId: string, file: FileInfo) => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const captured = { ...scope, signal: controller.signal };
    setPreview({ name: file.name });
    try {
      if (!file.artifactId) throw new Error('Missing artifact');
      const manifest = await fetchExecutionArtifacts(captured, runId);
      const artifact = manifest.artifacts.find(
        (item) => item.artifact_id === file.artifactId
      );
      if (!artifact) throw new Error('Missing artifact');
      const blob = await readExecutionArtifact(
        captured,
        runId,
        artifact.artifact_id
      );
      const text = await blob.text();
      assertExecutionScope(captured);
      if (text.includes('\u0000')) throw new Error('Binary artifact');
      setPreview({
        name: artifact.filename,
        text,
        revision: artifact.checkpoint_revision,
        truncated: artifact.size > blob.size,
      });
    } catch {
      if (!controller.signal.aborted)
        setPreview({ name: file.name, error: true });
    }
  };
  if (!enabled || parent) return <>{children}</>;
  return (
    <Context.Provider
      value={(runId, file) => {
        void open(runId, file);
      }}
    >
      {children}
      <Dialog
        open={Boolean(preview)}
        onOpenChange={(visible) => {
          if (!visible) {
            request.current?.abort();
            setPreview(null);
          }
        }}
      >
        <DialogContent
          size="lg"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (returnFocus.current?.isConnected) returnFocus.current.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle className="break-all">{preview?.name}</DialogTitle>
            <DialogDescription className="break-all">
              {t('chat.parallel-artifact-revision', {
                revision: preview?.revision ?? '…',
              })}
            </DialogDescription>
          </DialogHeader>
          <div
            className="scrollbar-always-visible min-h-0 overflow-y-auto p-4"
            aria-live="polite"
          >
            {preview?.error ? (
              <DsText>{t('chat.parallel-artifact-error')}</DsText>
            ) : preview?.text === undefined ? (
              <DsText>{t('chat.parallel-loading')}</DsText>
            ) : (
              <>
                {preview.truncated && (
                  <DsText role="meta">
                    {t('chat.parallel-artifact-truncated')}
                  </DsText>
                )}
                <DsText
                  as="pre"
                  channel="code"
                  role="base"
                  className="break-all whitespace-pre-wrap"
                >
                  {preview.text || t('chat.parallel-artifact-empty')}
                </DsText>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Context.Provider>
  );
}
