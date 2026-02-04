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
  }, [content, speed]);

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
      <div className="prose prose-sm markdown-container pointer-events-auto w-full select-text overflow-x-auto">
        <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-code-surface p-2 font-mono text-xs">
          <code>{formattedHtml}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="prose prose-sm markdown-container pointer-events-auto w-full select-text overflow-x-auto">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-primary mb-1 break-words text-xs font-bold">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-primary mb-1 break-words text-xs font-semibold">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-primary mb-1 break-words text-xs font-medium">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p
              className={`m-0 ${pTextSize} text-primary whitespace-pre-line break-words font-inter text-xs font-medium leading-10`}
            >
              {children}
            </p>
          ),
          ul: ({ children }) => (
            <ul
              className={`text-primary mb-1 list-inside list-disc text-xs ${olPadding}`}
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
            <li className="mb-1 list-inside break-all">{children}</li>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              className="break-all underline hover:text-text-link-hover"
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
            <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-code-surface p-2 font-mono text-xs">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="text-primary border-l-4 border-border-subtle-strong pl-3 text-xs italic">
              {children}
            </blockquote>
          ),
          strong: ({ children }) => (
            <strong className="text-primary text-xs font-semibold">
              {children}
            </strong>
          ),
          em: ({ children }) => (
            <em className="text-primary text-xs italic">{children}</em>
          ),
          table: ({ children }) => (
            <div className="w-full max-w-full overflow-x-auto">
              <table
                className="mb-4 !table w-full min-w-0"
                style={{
                  borderCollapse: 'collapse',
                  border: '1px solid #d1d5db',
                  borderSpacing: 0,
                }}
              >
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="!table-header-group bg-code-surface">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="!table-row-group">{children}</tbody>
          ),
          tr: ({ children }) => <tr className="!table-row">{children}</tr>,
          th: ({ children }) => (
            <th
              className="text-primary !table-cell text-left text-[10px] font-semibold"
              style={{
                border: '1px solid #d1d5db',
                padding: '2px 5px',
                borderCollapse: 'collapse',
              }}
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td
              className="text-primary !table-cell text-[10px]"
              style={{
                border: '1px solid #d1d5db',
                padding: '2px 5px',
                borderCollapse: 'collapse',
              }}
            >
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
