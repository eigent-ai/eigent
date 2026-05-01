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

import { isHtmlDocument } from '@/lib/htmlFontStyles';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export const MarkDown = ({
  content,
  speed = 15,
  onTyping,
  enableTypewriter = true, // Whether to enable typewriter effect
  pTextSize = 'text-xs',
  olPadding = '',
}: {
  content: string;
  speed?: number;
  onTyping?: () => void;
  enableTypewriter?: boolean;
  pTextSize?: string;
  olPadding?: string;
}) => {
  const [displayedContent, setDisplayedContent] = useState('');

  useEffect(() => {
    if (!enableTypewriter) {
      setDisplayedContent(content);
      return;
    }

    setDisplayedContent('');
    let index = 0;

    const timer = setInterval(() => {
      if (index < content.length) {
        setDisplayedContent(content.slice(0, index + 1));
        index++;
        if (onTyping) {
          onTyping();
        }
      } else {
        clearInterval(timer);
      }
    }, speed);

    return () => clearInterval(timer);
  }, [content, speed, enableTypewriter, onTyping]);

  // process line breaks, convert \n to <br> tag
  const processContent = (text: string) => {
    return text.replace(/\\n/g, '  \n '); // add two spaces before \n, so ReactMarkdown will recognize it as a line break
  };

  // If content is a pure HTML document, render in a styled pre block
  if (isHtmlDocument(content)) {
    // Trim leading whitespace from each line for consistent alignment
    const formattedHtml = displayedContent
      .split('\n')
      .map((line) => line.trimStart())
      .join('\n')
      .trim();
    return (
      <div className="prose prose-sm markdown-container pointer-events-auto w-full overflow-x-auto select-text">
        <pre className="rounded bg-code-surface p-2 font-mono text-xs overflow-x-auto whitespace-pre-wrap">
          <code>{formattedHtml}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="prose prose-sm markdown-container pointer-events-auto w-full overflow-x-auto select-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-ds-text-neutral-default-default mb-1 text-label-sm font-bold break-words">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-ds-text-neutral-default-default mb-1 text-label-sm font-semibold break-words">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-ds-text-neutral-default-default mb-1 text-label-sm font-medium break-words">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p
              className={`m-0 ${pTextSize} text-ds-text-neutral-default-default font-inter text-label-xs font-medium break-words whitespace-pre-line`}
            >
              {children}
            </p>
          ),
          ul: ({ children }) => (
            <ul
              className={`text-ds-text-neutral-default-default mb-1 pl-4 text-label-xs list-disc ${olPadding}`}
            >
              {children}
            </ul>
          ),
          // ol: ({ children }) => (
          // 	<ol
          // 		className={`list-decimal list-inside text-xs text-primary mb-1 ${olPadding}`}
          // 	>
          // 		{children}
          // 	</ol>
          // ),
          li: ({ children }) => (
            <li className="mb-1 list-outside break-words">{children}</li>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              className="text-ds-text-neutral-default-default hover:text-ds-text-neutral-default-hover break-all underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          code: ({ children }) => (
            <code className="rounded bg-code-surface px-1 py-0.5 font-mono text-xs">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="rounded bg-code-surface p-2 font-mono text-xs overflow-x-auto whitespace-pre-wrap">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="text-ds-text-neutral-default-default border-ds-border-neutral-strong-default pl-3 text-xs border-l-4 italic">
              {children}
            </blockquote>
          ),
          strong: ({ children }) => (
            <strong className="text-ds-text-neutral-default-default text-xs font-semibold">
              {children}
            </strong>
          ),
          em: ({ children }) => (
            <em className="text-ds-text-neutral-default-default text-xs italic">
              {children}
            </em>
          ),
          table: ({ children }) => (
            <div className="w-full max-w-full overflow-x-auto">
              <table
                className="mb-4 min-w-0 border-ds-border-neutral-default-default !table w-full border-collapse border"
                style={{
                  borderSpacing: 0,
                }}
              >
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-code-surface !table-header-group">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="!table-row-group">{children}</tbody>
          ),
          tr: ({ children }) => <tr className="!table-row">{children}</tr>,
          th: ({ children }) => (
            <th className="text-ds-text-neutral-default-default border-ds-border-neutral-default-default font-semibold py-0.5 !table-cell border px-[5px] text-left text-[10px]">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="text-ds-text-neutral-default-default border-ds-border-neutral-default-default py-0.5 !table-cell border px-[5px] text-[10px]">
              {children}
            </td>
          ),
        }}
      >
        {processContent(displayedContent)}
      </ReactMarkdown>
    </div>
  );
};
