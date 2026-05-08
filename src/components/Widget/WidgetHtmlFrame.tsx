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
import {
  deferInlineScriptsUntilLoad,
  injectFontStyles,
} from '@/lib/htmlFontStyles';
import { containsDangerousContent } from '@/lib/htmlSanitization';
import { useEffect, useMemo, useState } from 'react';

interface WidgetHtmlFrameProps {
  html?: string;
  title: string;
  basePath?: string;
  interactive?: boolean;
  disableScroll?: boolean;
  className?: string;
  reloadKey?: string | number;
}

function injectBaseHref(html: string, baseHref: string): string {
  const baseTag = `<base href="${baseHref}">`;
  if (/<base\s/i.test(html)) {
    return html.replace(/<base[^>]*>/i, baseTag);
  }
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, `$1${baseTag}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/(<html[^>]*>)/i, `$1<head>${baseTag}</head>`);
  }
  return `${baseTag}${html}`;
}

function toDirectoryBaseUrl(baseUrl: string, filePath: string): string {
  const absolute =
    filePath.startsWith('http://') || filePath.startsWith('https://')
      ? filePath
      : `${baseUrl}${filePath.startsWith('/') ? '' : '/'}${filePath}`;
  const url = new URL(absolute, window.location.href);
  url.pathname = url.pathname.replace(/\/[^/]*$/, '/');
  url.search = '';
  url.hash = '';
  return url.toString();
}

function injectNoScrollbarStyle(html: string): string {
  const styleTag = `<style data-eigent-widget-frame>
html, body {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden !important;
}
*, *::before, *::after {
  box-sizing: border-box;
  scrollbar-width: none;
}
*::-webkit-scrollbar {
  display: none;
}
</style>`;

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/(<head[^>]*>)/i, `$1${styleTag}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/(<html[^>]*>)/i, `$1<head>${styleTag}</head>`);
  }
  return `${styleTag}${html}`;
}

export function WidgetHtmlFrame({
  html,
  title,
  basePath,
  interactive = true,
  disableScroll = false,
  className,
  reloadKey,
}: WidgetHtmlFrameProps) {
  const [baseUrl, setBaseUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    void getBaseURL().then((value) => {
      if (!cancelled) setBaseUrl(value || window.location.origin);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const srcDoc = useMemo(() => {
    if (!html) return '';
    if (containsDangerousContent(html)) return '';

    const withBase =
      basePath && baseUrl
        ? injectBaseHref(html, toDirectoryBaseUrl(baseUrl, basePath))
        : html;

    const processed = injectFontStyles(deferInlineScriptsUntilLoad(withBase));
    return disableScroll ? injectNoScrollbarStyle(processed) : processed;
  }, [html, basePath, baseUrl, disableScroll]);

  if (html && !srcDoc) {
    return (
      <div className="text-ds-text-neutral-default-default px-4 text-body-sm flex h-full w-full items-center justify-center text-center">
        Widget content was blocked.
      </div>
    );
  }

  return (
    <iframe
      key={reloadKey}
      title={title}
      srcDoc={srcDoc}
      className={className}
      sandbox="allow-scripts allow-forms allow-downloads"
      tabIndex={interactive ? 0 : -1}
      scrolling={disableScroll ? 'no' : 'auto'}
    />
  );
}
