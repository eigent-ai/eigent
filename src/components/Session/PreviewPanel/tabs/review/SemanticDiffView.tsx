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

import { MarkDown } from '@/components/ChatBox/MessageItem/MarkDown';
import { DsIcon } from '@/components/ui/ds-icon';
import { useHost } from '@/host';
import DOMPurify from 'dompurify';
import { AlertTriangle, FileImage, Minus, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReviewFile } from './useReviewChanges';

export type SemanticDiffKind = 'markdown' | 'html' | 'json' | 'image';

const IMAGE_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp',
]);

export function semanticDiffKindForPath(path: string): SemanticDiffKind | null {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? '';
  if (extension === 'md' || extension === 'markdown') return 'markdown';
  if (extension === 'html' || extension === 'htm') return 'html';
  if (extension === 'json') return 'json';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  return null;
}

interface SemanticDiffViewProps {
  file: ReviewFile;
  kind: SemanticDiffKind;
  sides: { original: string; modified: string } | null;
}

export function SemanticDiffView({ file, kind, sides }: SemanticDiffViewProps) {
  if (kind === 'image') return <ImageDiff file={file} sides={sides} />;
  if (!sides) return <SemanticLoading />;
  if (kind === 'markdown') {
    return (
      <TwoPaneSemanticDiff
        before={
          <MarkdownDocument
            content={sides.original}
            empty={file.status === 'added'}
          />
        }
        after={
          <MarkdownDocument
            content={sides.modified}
            empty={file.status === 'deleted'}
          />
        }
      />
    );
  }
  if (kind === 'html') {
    return (
      <TwoPaneSemanticDiff
        before={<HtmlDocument content={sides.original} />}
        after={<HtmlDocument content={sides.modified} />}
      />
    );
  }
  return (
    <StructuredJsonDiff original={sides.original} modified={sides.modified} />
  );
}

function TwoPaneSemanticDiff({
  before,
  after,
}: {
  before: React.ReactNode;
  after: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid h-full min-h-0 grid-cols-1 overflow-y-auto lg:grid-cols-2 lg:overflow-hidden">
      <section className="flex min-h-[240px] min-w-0 flex-col border-0 border-x-0 border-t-0 border-b border-solid border-ds-hairline-subtle-default lg:min-h-0 lg:border-t-0 lg:border-r lg:border-b-0 lg:border-l-0">
        <div className="flex h-ds-control-md shrink-0 items-center gap-1.5 bg-ds-neutral-subtle-default px-3 text-ds-text-meta font-medium tracking-wide text-ds-ink-muted-default uppercase">
          <DsIcon
            icon={Minus}
            recipe="main-compact"
            className="text-ds-icon-error-default-default"
          />
          {t('layout.review-before', { defaultValue: 'Before' })}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{before}</div>
      </section>
      <section className="flex min-h-[240px] min-w-0 flex-col lg:min-h-0">
        <div className="flex h-ds-control-md shrink-0 items-center gap-1.5 bg-ds-neutral-subtle-default px-3 text-ds-text-meta font-medium tracking-wide text-ds-ink-muted-default uppercase">
          <DsIcon
            icon={Plus}
            recipe="main-compact"
            className="text-ds-icon-success-default-default"
          />
          {t('layout.review-after', { defaultValue: 'After' })}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{after}</div>
      </section>
    </div>
  );
}

function MarkdownDocument({
  content,
  empty,
}: {
  content: string;
  empty: boolean;
}) {
  const { t } = useTranslation();
  if (!content || empty) return <EmptySide />;
  return (
    <div className="px-5 py-4">
      <MarkDown
        content={content}
        enableTypewriter={false}
        profile="document"
        className="markdown-body"
      />
      <p className="sr-only">
        {t('layout.review-rendered-markdown', {
          defaultValue: 'Rendered Markdown',
        })}
      </p>
    </div>
  );
}

function sanitizeHtmlPreview(content: string): string {
  const sanitized = DOMPurify.sanitize(content, {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ['style'],
  });
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'">`;
  if (/<head[\s>]/i.test(sanitized)) {
    return sanitized.replace(/<head([^>]*)>/i, `<head$1>${policy}`);
  }
  return `<!doctype html><html><head>${policy}</head><body>${sanitized}</body></html>`;
}

function HtmlDocument({ content }: { content: string }) {
  const { t } = useTranslation();
  if (!content) return <EmptySide />;
  return (
    <iframe
      title={t('layout.review-html-preview', { defaultValue: 'HTML preview' })}
      sandbox=""
      srcDoc={sanitizeHtmlPreview(content)}
      className="h-full min-h-[420px] w-full border-0 border-x-0 border-y-0 bg-white"
    />
  );
}

type FlatJsonValue = { path: string; value: string };

function flattenJson(value: unknown, path = '$'): FlatJsonValue[] {
  if (value === null || typeof value !== 'object') {
    return [{ path, value: JSON.stringify(value) ?? String(value) }];
  }
  const entries = Array.isArray(value)
    ? value.map((child, index) => [String(index), child] as const)
    : Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return [{ path, value: Array.isArray(value) ? '[]' : '{}' }];
  }
  return entries.flatMap(([key, child]) =>
    flattenJson(
      child,
      Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`
    )
  );
}

function StructuredJsonDiff({
  original,
  modified,
}: {
  original: string;
  modified: string;
}) {
  const { t } = useTranslation();
  const result = useMemo(() => {
    try {
      const before = original.trim() ? flattenJson(JSON.parse(original)) : [];
      const after = modified.trim() ? flattenJson(JSON.parse(modified)) : [];
      const beforeMap = new Map(
        before.map((entry) => [entry.path, entry.value])
      );
      const afterMap = new Map(after.map((entry) => [entry.path, entry.value]));
      const paths = [
        ...new Set([...beforeMap.keys(), ...afterMap.keys()]),
      ].sort();
      return {
        rows: paths.map((path) => ({
          path,
          before: beforeMap.get(path),
          after: afterMap.get(path),
        })),
        error: null,
      };
    } catch (error) {
      return {
        rows: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [modified, original]);

  if (result.error) {
    return (
      <div className="flex h-full items-center justify-center gap-2 px-6 text-ds-text-meta text-ds-ink-muted-default">
        <DsIcon icon={AlertTriangle} />
        {t('layout.review-json-preview-failed', {
          defaultValue: 'Could not parse this JSON: {{message}}',
          message: result.error,
        })}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-3">
      <table className="w-full table-fixed border-collapse overflow-hidden rounded-lg text-left font-code text-ds-code-small">
        <thead className="sticky top-0 z-10 bg-ds-neutral-subtle-default text-ds-ink-muted-default">
          <tr>
            <th className="w-[34%] border border-x border-y border-solid border-ds-hairline-subtle-default px-3 py-2 font-medium">
              {t('layout.review-json-path', { defaultValue: 'JSON path' })}
            </th>
            <th className="w-[33%] border border-x border-y border-solid border-ds-hairline-subtle-default px-3 py-2 font-medium">
              {t('layout.review-before', { defaultValue: 'Before' })}
            </th>
            <th className="w-[33%] border border-x border-y border-solid border-ds-hairline-subtle-default px-3 py-2 font-medium">
              {t('layout.review-after', { defaultValue: 'After' })}
            </th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => {
            const changed = row.before !== row.after;
            return (
              <tr
                key={row.path}
                className={
                  changed ? 'bg-ds-bg-warning-subtle-default' : undefined
                }
              >
                <td className="border border-x border-y border-solid border-ds-hairline-subtle-default px-3 py-2 align-top text-ds-ink-default-default">
                  <span className="block truncate" title={row.path}>
                    {row.path}
                  </span>
                </td>
                <JsonValueCell
                  value={row.before}
                  tone="removed"
                  changed={changed}
                />
                <JsonValueCell
                  value={row.after}
                  tone="added"
                  changed={changed}
                />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function JsonValueCell({
  value,
  tone,
  changed,
}: {
  value: string | undefined;
  tone: 'added' | 'removed';
  changed: boolean;
}) {
  return (
    <td
      className={`border border-solid border-ds-hairline-subtle-default px-3 py-2 align-top break-words ${
        value === undefined
          ? 'text-ds-ink-muted-default'
          : !changed
            ? 'text-ds-ink-default-default'
            : tone === 'added'
              ? 'text-ds-text-success-default-default'
              : 'text-ds-text-error-default-default'
      }`}
    >
      {value ?? '—'}
    </td>
  );
}

type ImageSideState = { url: string | null; error: string | null };

const EMPTY_IMAGE_SIDE: ImageSideState = { url: null, error: null };

function ImageDiff({
  file,
  sides,
}: {
  file: ReviewFile;
  sides: { original: string; modified: string } | null;
}) {
  const { t } = useTranslation();
  const host = useHost();
  const [images, setImages] = useState<{
    before: ImageSideState;
    after: ImageSideState;
  }>({ before: EMPTY_IMAGE_SIDE, after: EMPTY_IMAGE_SIDE });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];
    setLoading(true);
    setImages({ before: EMPTY_IMAGE_SIDE, after: EMPTY_IMAGE_SIDE });
    const failure = (error: unknown): ImageSideState => ({
      url: null,
      error: error instanceof Error ? error.message : String(error),
    });
    const loaded = (url: string | null): ImageSideState => ({
      url,
      error: null,
    });
    const svgDataUrl = (content: string): string | null => {
      if (!content.trim()) return null;
      const sanitized = DOMPurify.sanitize(content, {
        USE_PROFILES: { svg: true, svgFilters: true },
      });
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sanitized)}`;
    };
    const read = async (path: string | null): Promise<ImageSideState> => {
      if (!path || !host?.electronAPI?.readFileAsDataUrl)
        return EMPTY_IMAGE_SIDE;
      try {
        return loaded(await host.electronAPI.readFileAsDataUrl(path));
      } catch (error: unknown) {
        return failure(error);
      }
    };
    const readGitSide = async (
      side: 'before' | 'after'
    ): Promise<ImageSideState> => {
      if (!file.loadPreview) return EMPTY_IMAGE_SIDE;
      try {
        const blob = await file.loadPreview(side);
        if (cancelled) return EMPTY_IMAGE_SIDE;
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        return loaded(url);
      } catch (error: unknown) {
        return failure(error);
      }
    };
    const isSvg = file.path.toLowerCase().endsWith('.svg');
    Promise.all([
      isSvg && sides
        ? Promise.resolve(loaded(svgDataUrl(sides.original)))
        : file.status === 'added'
          ? Promise.resolve(EMPTY_IMAGE_SIDE)
          : file.loadPreview
            ? readGitSide('before')
            : read(file.bakPath),
      isSvg && sides
        ? Promise.resolve(loaded(svgDataUrl(sides.modified)))
        : file.status === 'deleted'
          ? Promise.resolve(EMPTY_IMAGE_SIDE)
          : file.loadPreview
            ? readGitSide('after')
            : read(file.absPath),
    ]).then(([before, after]) => {
      if (!cancelled) {
        setImages({ before, after });
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [file, host, sides]);

  if (loading) return <SemanticLoading />;
  if (
    !images.before.url &&
    !images.after.url &&
    !images.before.error &&
    !images.after.error
  ) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-ds-text-meta text-ds-ink-muted-default">
        <DsIcon icon={FileImage} recipe="detailed" />
        {t('layout.review-image-preview-unavailable', {
          defaultValue:
            'Image metadata is available, but this Git-backed change has no local preview payload.',
        })}
      </div>
    );
  }
  return (
    <TwoPaneSemanticDiff
      before={<ImageSide url={images.before.url} error={images.before.error} />}
      after={<ImageSide url={images.after.url} error={images.after.error} />}
    />
  );
}

function ImageSide({
  url,
  error,
}: {
  url: string | null;
  error: string | null;
}) {
  const { t } = useTranslation();
  if (error) {
    return (
      <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 px-6 text-center text-ds-text-meta text-ds-ink-muted-default">
        <DsIcon icon={AlertTriangle} recipe="detailed" />
        {t('layout.review-file-load-failed', {
          defaultValue: 'Could not load this file: {{message}}',
          message: error,
        })}
      </div>
    );
  }
  if (!url) return <EmptySide />;
  return (
    <div className="flex h-full min-h-[320px] items-center justify-center bg-ds-neutral-subtle-default p-6">
      <img
        src={url}
        alt=""
        className="max-h-full max-w-full object-contain shadow-ds-elevation-card"
      />
    </div>
  );
}

function EmptySide() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full min-h-[180px] items-center justify-center text-ds-text-meta text-ds-ink-muted-default">
      {t('layout.review-file-not-present', {
        defaultValue: 'File not present on this side',
      })}
    </div>
  );
}

function SemanticLoading() {
  return (
    <div className="h-full w-full animate-pulse bg-ds-neutral-subtle-default" />
  );
}
