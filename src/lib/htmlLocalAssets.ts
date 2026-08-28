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

const IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'ico',
  'avif',
];

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function joinPath(...paths: string[]): string {
  return paths
    .filter(Boolean)
    .map((pathPart) => normalizePath(pathPart))
    .join('/')
    .replace(/\/+/g, '/');
}

function encodePathSegments(filePath: string): string {
  const normalizedPath = normalizePath(filePath);

  if (normalizedPath.startsWith('//')) {
    const withoutLeadingSlashes = normalizedPath.replace(/^\/+/, '');
    const [host, ...pathSegments] = withoutLeadingSlashes.split('/');
    const encodedPath = pathSegments.map(encodeURIComponent).join('/');
    return encodedPath ? `//${host}/${encodedPath}` : `//${host}/`;
  }

  const hasWindowsDrive = /^[A-Za-z]:\//.test(normalizedPath);
  if (hasWindowsDrive) {
    const [drive, ...pathSegments] = normalizedPath.split('/');
    const encodedPath = pathSegments.map(encodeURIComponent).join('/');
    return encodedPath ? `/${drive}/${encodedPath}` : `/${drive}/`;
  }

  return normalizedPath
    .split('/')
    .map((segment, index) =>
      index === 0 && segment === '' ? '' : encodeURIComponent(segment)
    )
    .join('/');
}

export function toLocalFileUrl(filePath: string): string {
  if (
    filePath.startsWith('http://') ||
    filePath.startsWith('https://') ||
    filePath.startsWith('blob:') ||
    filePath.startsWith('data:')
  ) {
    return filePath.endsWith('/') ? filePath : `${filePath}/`;
  }

  let localPath = filePath;
  if (filePath.startsWith('localfile:') || filePath.startsWith('file:')) {
    const parsed = new URL(filePath);
    const queryPath = parsed.searchParams.get('path');
    if (parsed.hostname === 'preview' && queryPath) {
      localPath = queryPath;
    } else if (!parsed.hostname || parsed.hostname === 'preview') {
      localPath = decodeURIComponent(parsed.pathname);
    } else {
      localPath = `/${parsed.hostname}${decodeURIComponent(parsed.pathname)}`;
    }
  }

  const encodedPath = encodePathSegments(localPath);
  const rootedPath = encodedPath.startsWith('/')
    ? encodedPath
    : `/${encodedPath}`;
  const localFileUrl = `localfile://preview${rootedPath}`;
  return localFileUrl.endsWith('/') ? localFileUrl : `${localFileUrl}/`;
}

function isStaticImageSrc(src: string): boolean {
  return !src.includes('${');
}

function isSpecialImageSrc(src: string): boolean {
  const normalizedSrc = src.trim().toLowerCase();
  return (
    !normalizedSrc ||
    normalizedSrc.startsWith('http://') ||
    normalizedSrc.startsWith('https://') ||
    normalizedSrc.startsWith('//') ||
    normalizedSrc.startsWith('data:') ||
    normalizedSrc.startsWith('blob:') ||
    normalizedSrc.startsWith('localfile:')
  );
}

function isLocalScriptSrc(src: string): boolean {
  const normalizedSrc = src.trim().toLowerCase();
  const colonIndex = normalizedSrc.indexOf(':');
  const hasExplicitScheme =
    colonIndex > 0 &&
    Array.from(normalizedSrc.slice(0, colonIndex)).every((character, index) =>
      index === 0
        ? character >= 'a' && character <= 'z'
        : (character >= 'a' && character <= 'z') ||
          (character >= '0' && character <= '9') ||
          character === '+' ||
          character === '.' ||
          character === '-'
    );
  return (
    Boolean(normalizedSrc) &&
    !hasExplicitScheme &&
    !(
      normalizedSrc.startsWith('http://') ||
      normalizedSrc.startsWith('https://') ||
      normalizedSrc.startsWith('//') ||
      normalizedSrc.startsWith('data:') ||
      normalizedSrc.startsWith('blob:') ||
      normalizedSrc.startsWith('localfile:') ||
      normalizedSrc.startsWith('#')
    )
  );
}

export function getRelativePathFromDir(
  baseDir: string,
  filePath: string
): string | null {
  const normalizedBase = normalizePath(baseDir).replace(/\/$/, '');
  const normalizedFile = normalizePath(filePath);

  if (
    normalizedFile !== normalizedBase &&
    !normalizedFile.startsWith(`${normalizedBase}/`)
  ) {
    return null;
  }

  return normalizedFile.slice(normalizedBase.length + 1);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isImagePath(pathValue: string): boolean {
  const pathWithoutQuery = pathValue.split(/[?#]/)[0].toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => pathWithoutQuery.endsWith(`.${ext}`));
}

export interface LocalProjectImageFile {
  path: string;
  isFolder?: boolean;
  isRemote?: boolean;
}

export async function inlineLocalProjectImagePaths(
  html: string,
  htmlDir: string,
  projectFiles: LocalProjectImageFile[],
  readFileAsDataUrl: (path: string) => Promise<string>
): Promise<string> {
  let result = html;

  for (const file of projectFiles) {
    if (file.isFolder || file.isRemote) continue;

    const relativePath = getRelativePathFromDir(htmlDir, file.path);
    if (!relativePath || !isImagePath(relativePath)) continue;

    const quotedPathMatcher = new RegExp(
      `(["'])${escapeRegExp(relativePath)}\\1`
    );
    if (!quotedPathMatcher.test(result)) continue;

    try {
      const dataUrl = await readFileAsDataUrl(file.path);
      const quotedPathPattern = new RegExp(
        `(["'])${escapeRegExp(relativePath)}\\1`,
        'g'
      );
      result = result.replace(quotedPathPattern, (_match, quote: string) => {
        return `${quote}${dataUrl}${quote}`;
      });
    } catch (error) {
      console.warn(
        '[HtmlRenderer] Failed to inline local project image:',
        relativePath,
        error
      );
    }
  }

  return result;
}

export async function inlineLocalHtmlImgElements(
  html: string,
  htmlDir: string,
  readFileAsDataUrl: (path: string) => Promise<string>
): Promise<string> {
  if (typeof DOMParser === 'undefined') {
    return html;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const doctype = html.match(/<!doctype[^>]*>/i)?.[0] || '';

  await Promise.all(
    Array.from(doc.querySelectorAll('img[src]')).map(async (image) => {
      const src = image.getAttribute('src');
      if (!src || !isStaticImageSrc(src) || isSpecialImageSrc(src)) {
        return;
      }

      try {
        const dataUrl = await readFileAsDataUrl(joinPath(htmlDir, src));
        image.setAttribute('src', dataUrl);
      } catch (error) {
        console.error(
          `[HtmlRenderer] Failed to load image: ${joinPath(htmlDir, src)}`,
          error
        );
      }
    })
  );

  const serialized = doc.documentElement?.outerHTML || html;
  return `${doctype}${serialized}`;
}

/**
 * Inline relative JavaScript referenced by a local HTML preview.
 *
 * A srcDoc iframe inherits the renderer's top-level CSP. Chromium may expose a
 * custom-protocol JavaScript response as a data: URL, which the application
 * deliberately does not allow as a script source. Reading the file through
 * the already-authorized preview IPC keeps execution inside the iframe's
 * `unsafe-inline` boundary without broadening the whole application's CSP.
 */
export async function inlineLocalHtmlScriptElements(
  html: string,
  htmlDir: string,
  readTextFile: (filePath: string) => Promise<string>
): Promise<string> {
  if (typeof DOMParser === 'undefined') {
    return html;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const doctype = html.match(/<!doctype[^>]*>/i)?.[0] || '';

  await Promise.all(
    Array.from(doc.querySelectorAll('script[src]')).map(async (script) => {
      const src = script.getAttribute('src');
      if (!src || !isLocalScriptSrc(src)) {
        return;
      }

      const pathWithoutQuery = src.split(/[?#]/, 1)[0];
      const resolvedPath = joinPath(htmlDir, pathWithoutQuery);
      try {
        const content = await readTextFile(resolvedPath);
        script.removeAttribute('src');
        script.setAttribute('data-source', src);
        // Prevent a source string from terminating its containing script tag
        // when the parsed document is serialized back to srcDoc HTML.
        script.textContent = content.replace(/<\/script/gi, '<\\/script');
      } catch (error) {
        console.warn(
          '[HtmlRenderer] Failed to inline local script:',
          resolvedPath,
          error
        );
      }
    })
  );

  const serialized = doc.documentElement?.outerHTML || html;
  return `${doctype}${serialized}`;
}
