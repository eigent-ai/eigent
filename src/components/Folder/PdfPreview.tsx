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

import { Button } from '@/components/ui/button';
import { DsText } from '@/components/ui/ds-text';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { PreviewFailure } from './PreviewRecovery';

/** One page at a time bounds canvas memory for long documents. The component
 * is keyed by file identity by its owner, so stale renders never cross files. */
export function PdfPreview({
  url,
  size,
  toolbarContainer,
  onRetry,
}: {
  url: string;
  size: number;
  toolbarContainer: HTMLElement | null;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [status, setStatus] = useState<
    'loading' | 'ready' | 'failed' | 'password'
  >('loading');
  const [pageText, setPageText] = useState('');
  const [width, setWidth] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cancelRef = useRef<() => void>(() => {});

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.floor(entry.contentRect.width))
    );
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    let task:
      ReturnType<typeof import('@/lib/pdfPreview').openPdfPreview> | undefined;
    setStatus('loading');
    setDocument(null);
    setPageNumber(1);
    const fail = (error?: unknown) => {
      if (cancelled) return;
      console.error(
        'Failed to load PDF preview:',
        error instanceof Error ? error.message : JSON.stringify(error)
      );
      setStatus(
        error instanceof Error && error.name === 'PasswordException'
          ? 'password'
          : 'failed'
      );
      cancel();
    };
    const timeout = setTimeout(fail, 30_000);
    const cancel = () => {
      cancelled = true;
      clearTimeout(timeout);
      void task?.destroy().catch(() => {});
    };
    cancelRef.current = cancel;
    void import('@/lib/pdfPreview')
      .then(({ openPdfPreview }) => {
        if (cancelled) return;
        task = openPdfPreview(url, size, fail);
        return task.promise.then((pdf) => {
          if (!cancelled) {
            clearTimeout(timeout);
            setDocument(pdf);
          }
        });
      })
      .catch(fail);
    return cancel;
  }, [url, size, attempt]);

  useEffect(() => {
    if (!document || !width || !canvasRef.current) return;
    let cancelled = false;
    let renderTask: RenderTask | undefined;
    setStatus('loading');
    setPageText('');
    const canvas = canvasRef.current;
    const fail = (error?: unknown) => {
      if (cancelled) return;
      console.error('Failed to render PDF preview:', error);
      setStatus('failed');
      setDocument(null);
      renderTask?.cancel();
      cancelRef.current();
    };
    const timeout = setTimeout(fail, 30_000);
    void document
      .getPage(pageNumber)
      .then(async (page) => {
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(width / base.width, 2);
        const viewport = page.getViewport({ scale });
        // media-frames exception: page geometry and a bounded HiDPI canvas.
        const ratio = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(16_000_000 / (viewport.width * viewport.height))
        );
        canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
        canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        renderTask = page.render({
          canvas,
          viewport,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        await renderTask.promise;
        if (cancelled) return;
        clearTimeout(timeout);
        setStatus('ready');
        const text = await page.getTextContent();
        if (!cancelled)
          setPageText(
            text.items.map((item) => ('str' in item ? item.str : '')).join(' ')
          );
      })
      .catch((error) => {
        if (!cancelled) fail(error);
      });
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      renderTask?.cancel();
    };
  }, [document, pageNumber, width]);

  const retry = () => {
    setAttempt((value) => value + 1);
    onRetry?.();
  };
  const failed = status === 'failed' || status === 'password';
  const pageLabel = t('folder.pdf-page', {
    page: pageNumber,
    total: document?.numPages || 1,
    defaultValue: 'Page {{page}} of {{total}}',
  });
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-ds-stack-related"
      aria-busy={status === 'loading'}
    >
      {toolbarContainer &&
        createPortal(
          <div
            className="flex shrink-0 items-center gap-ds-control-gap"
            data-pdf-controls
          >
            {document && !failed && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  buttonContent="icon-only"
                  aria-label={t('folder.pdf-previous', {
                    defaultValue: 'Previous page',
                  })}
                  title={t('folder.pdf-previous', {
                    defaultValue: 'Previous page',
                  })}
                  disabled={pageNumber <= 1}
                  onClick={() => setPageNumber((page) => page - 1)}
                >
                  <ChevronLeft aria-hidden />
                </Button>
                <DsText
                  as="span"
                  role="meta"
                  aria-live="polite"
                  aria-label={pageLabel}
                  title={pageLabel}
                  className="whitespace-nowrap"
                >
                  {pageNumber} / {document.numPages}
                </DsText>
                <Button
                  variant="ghost"
                  size="sm"
                  buttonContent="icon-only"
                  aria-label={t('folder.pdf-next', {
                    defaultValue: 'Next page',
                  })}
                  title={t('folder.pdf-next', { defaultValue: 'Next page' })}
                  disabled={pageNumber >= document.numPages}
                  onClick={() => setPageNumber((page) => page + 1)}
                >
                  <ChevronRight aria-hidden />
                </Button>
              </>
            )}
            {failed && (
              <Button
                variant="ghost"
                size="sm"
                buttonContent="icon-only"
                onClick={retry}
                aria-label={t('layout.retry')}
                title={t('layout.retry')}
              >
                <RotateCcw aria-hidden />
              </Button>
            )}
            {status === 'loading' && (
              <DsText
                as="span"
                role="meta"
                aria-live="polite"
                className="whitespace-nowrap text-ds-ink-muted-default"
              >
                {t('folder.pdf-loading', { defaultValue: 'Loading PDF…' })}
              </DsText>
            )}
          </div>,
          toolbarContainer
        )}
      {failed && (
        <PreviewFailure
          message={
            status === 'password'
              ? t('folder.pdf-password-required', {
                  defaultValue:
                    'This PDF needs a password. Open it externally to unlock it.',
                })
              : undefined
          }
        />
      )}
      <div
        ref={viewportRef}
        className={
          failed
            ? 'hidden'
            : 'scrollbar-always-visible min-h-0 flex-1 overflow-auto'
        }
      >
        <canvas
          ref={canvasRef}
          className={status === 'ready' ? 'block' : 'invisible'}
          role="img"
          aria-label={pageLabel}
        />
        {status === 'ready' && <p className="sr-only">{pageText}</p>}
      </div>
    </div>
  );
}
