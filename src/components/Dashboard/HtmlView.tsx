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

import { getBaseURL } from '@/api/http';
import { useHost } from '@/host';
import {
  deferInlineScriptsUntilLoad,
  injectFontStyles,
} from '@/lib/htmlFontStyles';
import { containsDangerousContent } from '@/lib/htmlSanitization';
import { useEffect, useRef, useState } from 'react';
import { ZoomControls } from '../Folder/ZoomControls';

export interface FileInfo {
  name: string;
  path: string;
  type: string;
  isFolder?: boolean;
  icon?: React.ElementType;
  content?: string;
  relativePath?: string;
  isRemote?: boolean;
}

const IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'bmp',
  'webp',
  'svg',
  'ico',
  'heic',
  'avif',
];

function getDirPath(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const lastSlashIndex = normalizedPath.lastIndexOf('/');
  return lastSlashIndex >= 0 ? normalizedPath.substring(0, lastSlashIndex) : '';
}

function joinPath(...paths: string[]): string {
  return paths
    .filter(Boolean)
    .map((p) => p.replace(/\\/g, '/'))
    .join('/')
    .replace(/\/+/g, '/');
}

function resolveRelativePath(basePath: string, relativePath: string): string {
  const normalizedBase = basePath.replace(/\\/g, '/');
  const normalizedRelative = relativePath.replace(/\\/g, '/');

  if (
    !normalizedRelative.startsWith('./') &&
    !normalizedRelative.startsWith('../')
  ) {
    return joinPath(normalizedBase, normalizedRelative);
  }

  const baseParts = normalizedBase.split('/').filter(Boolean);
  const relativeParts = normalizedRelative.split('/').filter(Boolean);

  for (const part of relativeParts) {
    if (part === '.') {
      continue;
    } else if (part === '..') {
      baseParts.pop();
    } else {
      baseParts.push(part);
    }
  }

  return baseParts.join('/');
}

function hasScriptSrcAttribute(attrs: string): boolean {
  return /(?:^|\s)src\s*=/.test(attrs.toLowerCase());
}

function isClassicScriptAttribute(attrs: string): boolean {
  const typeMatch = attrs.match(
    /(?:^|\s)type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i
  );
  if (!typeMatch) return true;

  const rawType = (typeMatch[1] ?? typeMatch[2] ?? typeMatch[3] ?? '').trim();
  const normalizedType = rawType.split(';', 1)[0].trim().toLowerCase();
  if (!normalizedType) return true;

  if (normalizedType === 'module' || normalizedType === 'application/ld+json') {
    return false;
  }

  return new Set([
    'text/javascript',
    'application/javascript',
    'text/ecmascript',
    'application/ecmascript',
    'application/x-javascript',
    'text/x-javascript',
    'application/x-ecmascript',
    'text/x-ecmascript',
    'text/jscript',
    'text/livescript',
  ]).has(normalizedType);
}

function canParseClassicScript(script: string): boolean {
  try {
    new Function(script);
    return true;
  } catch {
    return false;
  }
}

function normalizeGeneratedDoubleBraces(source: string): string {
  return source.replace(/\{\{/g, '{').replace(/\}\}/g, '}');
}

function repairGeneratedReportBraces(html: string): string {
  let repairedHtml = html.replace(
    /<style\b([^>]*)>([\s\S]*?)<\/style>/gi,
    (fullTag, attrs: string, content: string) => {
      if (!content.includes('{{') && !content.includes('}}')) {
        return fullTag;
      }
      return `<style${attrs}>${normalizeGeneratedDoubleBraces(content)}</style>`;
    }
  );

  repairedHtml = repairedHtml.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    (fullTag, attrs: string, content: string) => {
      if (
        hasScriptSrcAttribute(attrs) ||
        !isClassicScriptAttribute(attrs) ||
        (!content.includes('{{') && !content.includes('}}'))
      ) {
        return fullTag;
      }

      const normalizedContent = normalizeGeneratedDoubleBraces(content);
      if (
        !canParseClassicScript(content) &&
        canParseClassicScript(normalizedContent)
      ) {
        return `<script${attrs}>${normalizedContent}</script>`;
      }

      return fullTag;
    }
  );

  return repairedHtml;
}

function normalizeLookupPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/\/+/g, '/')
    .replace(/^\//, '')
    .toLowerCase();
}

function getRelativeDirPath(
  relativePath?: string,
  fallbackName?: string
): string {
  const target = (relativePath || fallbackName || '').replace(/\\/g, '/');
  const lastSlashIndex = target.lastIndexOf('/');
  return lastSlashIndex >= 0 ? target.substring(0, lastSlashIndex) : '';
}

function isSpecialBrowserUrl(url: string): boolean {
  const normalizedUrl = url.trim().toLowerCase();
  return (
    !normalizedUrl ||
    normalizedUrl.startsWith('http://') ||
    normalizedUrl.startsWith('https://') ||
    normalizedUrl.startsWith('//') ||
    normalizedUrl.startsWith('data:') ||
    normalizedUrl.startsWith('blob:') ||
    normalizedUrl.startsWith('mailto:') ||
    normalizedUrl.startsWith('tel:') ||
    normalizedUrl.startsWith('javascript:') ||
    normalizedUrl.startsWith('vbscript:') ||
    normalizedUrl.startsWith('#')
  );
}

function isInlineImageUrl(url: string): boolean {
  const normalizedUrl = url.trim().toLowerCase();
  return normalizedUrl.startsWith('data:') || normalizedUrl.startsWith('blob:');
}

function getPathWithoutSearchOrHash(pathOrUrl: string): string {
  return pathOrUrl.split(/[?#]/)[0].toLowerCase();
}

function isImagePathLike(pathOrUrl: string): boolean {
  const path = getPathWithoutSearchOrHash(pathOrUrl);
  return IMAGE_EXTENSIONS.some((ext) => path.endsWith(`.${ext}`));
}

function isRemoteProjectFileUrl(url: string, baseHref?: string): boolean {
  try {
    const parsedUrl = new URL(url, baseHref || window.location.href);
    return (
      parsedUrl.pathname.includes('/files/stream') ||
      parsedUrl.pathname.includes('/files/preview/')
    );
  } catch {
    return false;
  }
}

function toAbsoluteResourceUrl(url: string, baseHref?: string): string | null {
  try {
    return new URL(url, baseHref || window.location.href).toString();
  } catch {
    return null;
  }
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function fetchRemoteFileAsDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return readBlobAsDataUrl(await response.blob());
}

function shouldInlineHtmlImageUrl(url: string, baseHref?: string): boolean {
  if (!url || isInlineImageUrl(url)) {
    return false;
  }

  const absoluteUrl = toAbsoluteResourceUrl(url, baseHref);
  if (!absoluteUrl) {
    return false;
  }

  return isRemoteProjectFileUrl(absoluteUrl) || isImagePathLike(url);
}

async function inlineImageUrl(
  url: string,
  baseHref?: string
): Promise<string | null> {
  if (!shouldInlineHtmlImageUrl(url, baseHref)) {
    return null;
  }

  const absoluteUrl = toAbsoluteResourceUrl(url, baseHref);
  if (!absoluteUrl) {
    return null;
  }

  try {
    return await fetchRemoteFileAsDataUrl(absoluteUrl);
  } catch (error) {
    console.warn('[HtmlView] Failed to inline image:', absoluteUrl, error);
    return null;
  }
}

async function inlineSrcsetImages(
  srcset: string,
  baseHref?: string
): Promise<string> {
  if (srcset.toLowerCase().includes('data:')) {
    return srcset;
  }

  const candidates = srcset
    .split(',')
    .map((candidate) => candidate.trim())
    .filter(Boolean);

  if (!candidates.length) {
    return srcset;
  }

  const rewrittenCandidates = await Promise.all(
    candidates.map(async (candidate) => {
      const [url, ...descriptors] = candidate.split(/\s+/);
      const dataUrl = await inlineImageUrl(url, baseHref);
      return [dataUrl || url, ...descriptors].join(' ');
    })
  );

  return rewrittenCandidates.join(', ');
}

async function inlineCssImageUrls(
  cssText: string,
  baseHref?: string
): Promise<string> {
  const matches = Array.from(
    cssText.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)
  );
  if (!matches.length) {
    return cssText;
  }

  const replacements = await Promise.all(
    matches.map(async (match) => {
      const fullMatch = match[0];
      const url = match[2];
      const dataUrl = await inlineImageUrl(url, baseHref);
      return dataUrl ? { fullMatch, replacement: `url("${dataUrl}")` } : null;
    })
  );

  return replacements.reduce((result, replacement) => {
    if (!replacement) return result;
    return result.replace(replacement.fullMatch, replacement.replacement);
  }, cssText);
}

async function inlineRemoteHtmlImages(
  html: string,
  baseHref?: string
): Promise<string> {
  if (typeof DOMParser === 'undefined') {
    return html;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const doctype = html.match(/<!doctype[^>]*>/i)?.[0] || '';

  await Promise.all(
    Array.from(doc.querySelectorAll('[src], [href], [srcset]')).map(
      async (element) => {
        const src = element.getAttribute('src');
        if (src) {
          const dataUrl = await inlineImageUrl(src, baseHref);
          if (dataUrl) {
            element.setAttribute('src', dataUrl);
          }
        }

        const href = element.getAttribute('href');
        if (href && element.tagName.toLowerCase() === 'image') {
          const dataUrl = await inlineImageUrl(href, baseHref);
          if (dataUrl) {
            element.setAttribute('href', dataUrl);
          }
        }

        const srcset = element.getAttribute('srcset');
        if (srcset) {
          element.setAttribute(
            'srcset',
            await inlineSrcsetImages(srcset, baseHref)
          );
        }
      }
    )
  );

  await Promise.all(
    Array.from(doc.querySelectorAll('[style]')).map(async (element) => {
      const style = element.getAttribute('style');
      if (style) {
        element.setAttribute(
          'style',
          await inlineCssImageUrls(style, baseHref)
        );
      }
    })
  );

  await Promise.all(
    Array.from(doc.querySelectorAll('style')).map(async (styleElement) => {
      styleElement.textContent = await inlineCssImageUrls(
        styleElement.textContent || '',
        baseHref
      );
    })
  );

  const serialized = doc.documentElement?.outerHTML || html;
  return `${doctype}${serialized}`;
}

function getRemoteRelativePath(file: FileInfo): string | undefined {
  if (file.relativePath) {
    return file.relativePath.replace(/\\/g, '/');
  }

  if (!file.path) return undefined;

  try {
    const url = new URL(file.path, window.location.origin);
    const pathParam = url.searchParams.get('path');
    return pathParam
      ? decodeURIComponent(pathParam).replace(/\\/g, '/')
      : undefined;
  } catch {
    return undefined;
  }
}

function encodePathSegments(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function getRemotePreviewUrl(file: FileInfo): string | undefined {
  const relativePath = getRemoteRelativePath(file);
  if (!relativePath || !file.path) {
    return undefined;
  }

  try {
    const url = new URL(file.path, window.location.origin);
    const email = url.searchParams.get('email');
    const projectId = url.searchParams.get('project_id');
    if (!email || !projectId) {
      return undefined;
    }

    const filesIndex = url.pathname.indexOf('/files/stream');
    const routePrefix =
      filesIndex >= 0 ? url.pathname.substring(0, filesIndex) : '';

    return `${url.origin}${routePrefix}/files/preview/${encodeURIComponent(email)}/${encodeURIComponent(projectId)}/${encodePathSegments(relativePath)}`;
  } catch {
    return undefined;
  }
}

function getRemotePreviewBaseHref(file: FileInfo): string | undefined {
  const previewUrl = getRemotePreviewUrl(file);
  if (!previewUrl) {
    return undefined;
  }

  const lastSlashIndex = previewUrl.lastIndexOf('/');
  return lastSlashIndex >= 0
    ? `${previewUrl.substring(0, lastSlashIndex + 1)}`
    : previewUrl;
}

function injectBaseHref(html: string, baseHref: string): string {
  if (!baseHref || typeof DOMParser === 'undefined') {
    return html;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const doctype = html.match(/<!doctype[^>]*>/i)?.[0] || '';
  const base = doc.querySelector('base') || doc.createElement('base');

  base.setAttribute('href', baseHref);

  if (!base.parentElement) {
    const head = doc.head || doc.createElement('head');
    head.prepend(base);
    if (!doc.head) {
      const htmlElement = doc.documentElement || doc.createElement('html');
      htmlElement.prepend(head);
      if (!doc.documentElement) {
        doc.appendChild(htmlElement);
      }
    }
  }

  const serialized = doc.documentElement?.outerHTML || html;
  return `${doctype}${serialized}`;
}

function rewriteRemoteHtmlReferences(
  html: string,
  selectedFile: FileInfo,
  projectFiles: FileInfo[]
): string {
  const htmlRelativePath = getRemoteRelativePath(selectedFile);
  if (!htmlRelativePath || typeof DOMParser === 'undefined') {
    return html;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const baseDir = getRelativeDirPath(htmlRelativePath, selectedFile.name);
  const doctype = html.match(/<!doctype[^>]*>/i)?.[0] || '';
  const fileMap = new Map<string, FileInfo>();

  projectFiles.forEach((file) => {
    if (!file.relativePath) return;
    fileMap.set(normalizeLookupPath(file.relativePath), file);
  });

  const rewriteAttribute = (element: Element, attributeName: string) => {
    const originalValue = element.getAttribute(attributeName);
    if (!originalValue || isSpecialBrowserUrl(originalValue)) return;

    const match = originalValue.match(/^([^?#]*)(.*)$/);
    const pathPart = match?.[1] || originalValue;
    const suffix = match?.[2] || '';
    const resolvedRelativePath = pathPart.startsWith('/')
      ? pathPart.replace(/^\/+/, '')
      : resolveRelativePath(baseDir, pathPart);
    const matchedFile = fileMap.get(normalizeLookupPath(resolvedRelativePath));

    if (matchedFile?.path) {
      element.setAttribute(attributeName, `${matchedFile.path}${suffix}`);
    }
  };

  doc
    .querySelectorAll('[src], [href], [poster], [data], [action]')
    .forEach((element) => {
      ['src', 'href', 'poster', 'data', 'action'].forEach((attributeName) => {
        if (element.hasAttribute(attributeName)) {
          rewriteAttribute(element, attributeName);
        }
      });
    });

  const serialized = doc.documentElement?.outerHTML || html;
  return `${doctype}${serialized}`;
}

export function HtmlView({
  selectedFile,
  projectFiles,
  liveRefreshSignal,
  projectId,
}: {
  selectedFile: FileInfo;
  projectFiles: FileInfo[];
  /** Increment to send a postMessage refresh to the iframe without remounting. */
  liveRefreshSignal?: number;
  projectId?: string;
}) {
  const [processedHtml, setProcessedHtml] = useState<string>('');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const host = useHost();
  const ipcRenderer = host?.ipcRenderer;
  const electronAPI = host?.electronAPI;

  // Send postMessage to the iframe when liveRefreshSignal increments.
  // The generated HTML listens for { type: 'eigent-refresh' } and re-fetches its data.
  useEffect(() => {
    if (!liveRefreshSignal || liveRefreshSignal <= 0) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'eigent-refresh' },
      '*'
    );
  }, [liveRefreshSignal]);

  useEffect(() => {
    const processHtml = async () => {
      if (!selectedFile.content) {
        setProcessedHtml('');
        return;
      }

      let html = repairGeneratedReportBraces(selectedFile.content);

      // Inject Brain base URL and project context so the HTML's JS can call
      // Brain API endpoints directly for live data (Model B Live Artifact pattern).
      try {
        const brainBaseUrl = await getBaseURL();
        if (brainBaseUrl) {
          const injection = `<script data-eigent-inject="true">
window.__EIGENT_BRAIN_URL__ = ${JSON.stringify(brainBaseUrl)};
window.__EIGENT_PROJECT_ID__ = ${JSON.stringify(projectId || '')};
window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'eigent-refresh') {
    if (typeof window.__eigentRefresh === 'function') {
      window.__eigentRefresh();
    }
  }
});
</script>`;
          html = html.includes('<head>')
            ? html.replace('<head>', `<head>${injection}`)
            : injection + html;
        }
      } catch {
        // Brain URL unavailable — HTML still renders, just without live-data globals
      }

      const htmlDir = getDirPath(selectedFile.path);

      const scriptSrcRegex = /<script[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi;
      const linkHrefRegex =
        /<link[^>]*href\s*=\s*["']([^"']+\.css)["'][^>]*>/gi;

      const referencedPaths: Set<string> = new Set();

      const addReferencedPath = (url: string) => {
        if (
          !url.startsWith('http://') &&
          !url.startsWith('https://') &&
          !url.startsWith('//')
        ) {
          const resolvedPath = resolveRelativePath(htmlDir, url);
          referencedPaths.add(resolvedPath.toLowerCase());
        }
      };

      let scriptMatch;
      while ((scriptMatch = scriptSrcRegex.exec(html)) !== null) {
        addReferencedPath(scriptMatch[1]);
      }

      let linkMatch;
      while ((linkMatch = linkHrefRegex.exec(html)) !== null) {
        addReferencedPath(linkMatch[1]);
      }

      const relatedFiles = projectFiles.filter((file) => {
        if (
          file.isFolder ||
          !['js', 'css'].includes(file.type?.toLowerCase() || '')
        )
          return false;
        const normalizedFilePath = file.path.replace(/\\/g, '/').toLowerCase();
        return referencedPaths.has(normalizedFilePath);
      });

      const jsFiles = relatedFiles.filter(
        (f) => f.type?.toLowerCase() === 'js'
      );
      const cssFiles = relatedFiles.filter(
        (f) => f.type?.toLowerCase() === 'css'
      );

      if (containsDangerousContent(html)) {
        setProcessedHtml('');
        return;
      }

      if (selectedFile.isRemote) {
        const previewBaseHref = getRemotePreviewBaseHref(selectedFile);
        const rewrittenHtml = rewriteRemoteHtmlReferences(
          html,
          selectedFile,
          projectFiles
        );
        const htmlWithBaseHref = previewBaseHref
          ? injectBaseHref(rewrittenHtml, previewBaseHref)
          : rewrittenHtml;
        const htmlWithInlineImages = await inlineRemoteHtmlImages(
          htmlWithBaseHref,
          previewBaseHref
        );
        setProcessedHtml(
          injectFontStyles(deferInlineScriptsUntilLoad(htmlWithInlineImages))
        );
        return;
      }

      const imgRegex = /<img\s+([^>]*?)(?:\s*\/\s*>|>)/gi;
      const matches = Array.from(html.matchAll(imgRegex));

      const processedImages = await Promise.all(
        matches.map(async (match) => {
          const fullMatch = match[0];
          const attributes = match[1];
          const imgTag = fullMatch;

          const srcMatch = attributes.match(/src\s*=\s*["']([^"']+)["']/i);
          if (!srcMatch) return { original: imgTag, processed: imgTag };

          const src = srcMatch[1];

          if (
            src.startsWith('http://') ||
            src.startsWith('https://') ||
            src.startsWith('data:') ||
            src.startsWith('localfile://')
          ) {
            return { original: imgTag, processed: imgTag };
          }

          const imagePath = joinPath(htmlDir, src);

          try {
            if (!electronAPI?.readFileAsDataUrl) {
              return { original: imgTag, processed: imgTag };
            }
            const dataUrl = await electronAPI.readFileAsDataUrl(imagePath);

            const newAttributes = attributes.replace(
              /src\s*=\s*["'][^"']+["']/i,
              `src="${dataUrl}"`
            );
            const isSelfClosing = imgTag.trim().endsWith('/>');
            const processedTag = isSelfClosing
              ? `<img ${newAttributes} />`
              : `<img ${newAttributes}>`;

            return { original: imgTag, processed: processedTag };
          } catch (error) {
            console.error(`Failed to load image: ${imagePath}`, error);
            return { original: imgTag, processed: imgTag };
          }
        })
      );

      let processedHtmlContent = html;
      processedImages.forEach(({ original, processed }) => {
        processedHtmlContent = processedHtmlContent.replace(
          original,
          processed
        );
      });

      for (const cssFile of cssFiles) {
        try {
          const cssContent = ipcRenderer
            ? await ipcRenderer.invoke('open-file', 'css', cssFile.path, false)
            : null;
          if (cssContent) {
            const styleTag = `<style data-source="${cssFile.name}">${cssContent}</style>`;

            const linkRegex = new RegExp(
              `<link[^>]*href=["'](?:[^"']*[/\\\\])?${cssFile.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`,
              'gi'
            );
            const replacedCss = processedHtmlContent.replace(
              linkRegex,
              styleTag
            );
            if (replacedCss !== processedHtmlContent) {
              processedHtmlContent = replacedCss;
            } else {
              if (processedHtmlContent.includes('<head>')) {
                processedHtmlContent = processedHtmlContent.replace(
                  '<head>',
                  `<head>${styleTag}`
                );
              } else {
                processedHtmlContent = styleTag + processedHtmlContent;
              }
            }
          }
        } catch (error) {
          console.error(`Failed to load CSS file: ${cssFile.path}`, error);
        }
      }

      for (const jsFile of jsFiles) {
        try {
          const jsContent = ipcRenderer
            ? await ipcRenderer.invoke('open-file', 'js', jsFile.path, false)
            : null;
          if (jsContent) {
            const scriptRegex = new RegExp(
              `<script[^>]*src=["'](?:[^"']*[/\\\\])?${jsFile.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>\\s*</script>`,
              'gi'
            );
            const inlineScriptTag = `<script data-source="${jsFile.name}">${jsContent}</script>`;
            processedHtmlContent = processedHtmlContent.replace(
              scriptRegex,
              inlineScriptTag
            );
          }
        } catch (error) {
          console.error(`Failed to load JS file: ${jsFile.path}`, error);
        }
      }

      if (containsDangerousContent(processedHtmlContent)) {
        setProcessedHtml('');
        return;
      }

      const htmlWithDeferredScripts =
        deferInlineScriptsUntilLoad(processedHtmlContent);

      setProcessedHtml(injectFontStyles(htmlWithDeferredScripts));
    };

    processHtml().catch((error) => {
      console.error('[HtmlView] Failed to process HTML:', error);
      setProcessedHtml(injectFontStyles(selectedFile.content || ''));
    });
  }, [selectedFile, projectFiles, ipcRenderer, electronAPI]);

  const [zoom, setZoom] = useState(100);

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 10, 200));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 10, 50));
  const handleZoomReset = () => setZoom(100);

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -10 : 10;
      setZoom((prev) => Math.min(Math.max(prev + delta, 50), 200));
    }
  };

  if (selectedFile.content && !processedHtml) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <div className="mb-4 h-8 w-8 animate-spin mx-auto rounded-full" />
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col">
      <ZoomControls
        zoom={zoom}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
      />

      <div
        className="min-h-0 bg-code-surface flex-1 overflow-hidden"
        onWheel={handleWheel}
      >
        <div
          className="h-full origin-top-left transition-transform duration-150"
          style={{
            transform: `scale(${zoom / 100})`,
            width: `${10000 / zoom}%`,
            height: `${10000 / zoom}%`,
          }}
        >
          {/*Security is maintained via CSP allowlist in index.html which restricts script sources. */}
          <iframe
            ref={iframeRef}
            srcDoc={processedHtml}
            className="bg-white h-full w-full border-0"
            sandbox="allow-scripts allow-forms allow-downloads allow-same-origin"
            title={selectedFile.name}
            tabIndex={0}
            onLoad={() => iframeRef.current?.focus()}
          />
        </div>
      </div>
    </div>
  );
}
