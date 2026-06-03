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
    filePath.startsWith('localfile://') ||
    filePath.startsWith('file://') ||
    filePath.startsWith('http://') ||
    filePath.startsWith('https://') ||
    filePath.startsWith('blob:') ||
    filePath.startsWith('data:')
  ) {
    const normalized =
      filePath.startsWith('file://') && !filePath.startsWith('localfile://')
        ? filePath.replace(/^file:\/\//, 'localfile://')
        : filePath;
    return normalized.endsWith('/') ? normalized : `${normalized}/`;
  }

  const encodedPath = encodePathSegments(filePath);
  const localFileUrl = `localfile://${encodedPath}`;
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
