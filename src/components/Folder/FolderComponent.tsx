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

import DOMPurify from 'dompurify';
import { useMemo } from 'react';

type Props = {
  selectedFile: {
    content?: string | null;
  };
};

export default function FolderComponent({ selectedFile }: Props) {
  const sanitizedHtml = useMemo(() => {
    const raw = selectedFile?.content || '';
    if (!raw) return '';

    // Strict dangerous content detection to prevent various bypass techniques
    const dangerousPatterns = [
      /ipcRenderer/gi,
      /window\s*\[\s*['"`]ipcRenderer['"`]\s*\]/gi,
      /parent\s*\.\s*ipcRenderer/gi,
      /top\s*\.\s*ipcRenderer/gi,
      /frames\s*\[\s*\d+\s*\]\s*\.\s*ipcRenderer/gi,
      /require\s*\(\s*['"`]electron['"`]\s*\)/gi,
      /process\s*\.\s*versions\s*\.\s*electron/gi,
      /nodeIntegration/gi,
      /webSecurity/gi,
      /contextIsolation/gi,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(raw)) {
        console.warn('Detected forbidden content:', pattern);
        return '';
      }
    }

    return DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true },
      ALLOWED_TAGS: [
        'a',
        'b',
        'i',
        'u',
        'strong',
        'em',
        'p',
        'br',
        'ul',
        'ol',
        'li',
        'img',
        'div',
        'span',
        'table',
        'thead',
        'tbody',
        'tr',
        'td',
        'th',
        'pre',
        'code',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'style',
      ],
      ALLOWED_ATTR: [
        'href',
        'src',
        'alt',
        'title',
        'width',
        'height',
        'target',
        'rel',
        'colspan',
        'rowspan',
        'class',
        'id',
        'style',
      ],
      FORBID_ATTR: [
        'onerror',
        'onload',
        'onclick',
        'onmouseover',
        'onfocus',
        'onblur',
        'onchange',
        'onsubmit',
        'onreset',
        'onselect',
        'onabort',
        'onkeydown',
        'onkeypress',
        'onkeyup',
        'onunload',
      ],
      FORBID_TAGS: [
        'script',
        'iframe',
        'object',
        'embed',
        'form',
        'input',
        'button',
      ],
      ADD_ATTR: ['target'],
      SANITIZE_DOM: true,
      KEEP_CONTENT: false,
    });
  }, [selectedFile?.content]);

  return (
    <div
      className="w-full overflow-auto"
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  );
}
