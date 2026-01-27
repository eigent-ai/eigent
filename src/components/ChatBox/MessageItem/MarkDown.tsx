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
import { memo, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export const MarkDown = memo(
  ({
    content,
    speed = 10,
    onTyping,
    enableTypewriter = true, // Whether to enable typewriter effect
    pTextSize = 'text-body-sm',
    olPadding = 'pl-3',
  }: {
    content: string;
    speed?: number;
    onTyping?: () => void;
    enableTypewriter?: boolean;
    pTextSize?: string;
    olPadding?: string;
  }) => {
    const [displayedContent, setDisplayedContent] = useState('');
    const lastContentRef = useRef<string | null>(null);
    const typingCallbackRef = useRef(onTyping);

    useEffect(() => {
      typingCallbackRef.current = onTyping;
    }, [onTyping]);

    useEffect(() => {
      if (lastContentRef.current === content) {
        return;
      }
      lastContentRef.current = content;

      if (!enableTypewriter) {
        setDisplayedContent(content);
        if (typingCallbackRef.current) {
          typingCallbackRef.current();
        }
        return;
      }

      setDisplayedContent('');
      let index = 0;

      const timer = setInterval(() => {
        if (index < content.length) {
          setDisplayedContent(content.slice(0, index + 1));
          index++;
        } else {
          clearInterval(timer);
          // when typewriter effect is completed, call callback
          if (typingCallbackRef.current) {
            typingCallbackRef.current();
          }
        }
      }, speed);

      return () => clearInterval(timer);
    }, [content, speed, enableTypewriter]);

    // If content is a pure HTML document, render in a styled pre block
    if (isHtmlDocument(content)) {
      // Trim leading whitespace from each line for consistent alignment
      const formattedHtml = displayedContent
        .split('\n')
        .map((line) => line.trimStart())
        .join('\n')
        .trim();
      return (
        <div className="markdown-container max-w-none overflow-hidden">
          <pre
            className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-zinc-100 p-2 font-mono text-xs"
            style={{ wordBreak: 'break-all' }}
          >
            <code>{formattedHtml}</code>
          </pre>
        </div>
      );
    }

    return (
      <div className="markdown-container max-w-none overflow-hidden">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: ({ children }) => (
              <h1 className="text-primary mb-2 text-wrap break-words text-lg font-bold">
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 className="text-primary mb-2 text-wrap break-words text-base font-semibold">
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 className="text-primary mb-1 text-wrap break-words text-sm font-medium">
                {children}
              </h3>
            ),
            p: ({ children }) => (
              <p
                className={`${pTextSize} whitespace-pre-wrap break-all font-inter font-medium leading-10 text-text-body`}
                style={{ margin: 0, wordBreak: 'break-all' }}
              >
                {children}
              </p>
            ),
            ul: ({ children }) => (
              <ul
                className={`mb-2 ml-3 list-outside list-disc text-body-sm text-text-body ${olPadding}`}
              >
                {children}
              </ul>
            ),
            li: ({ children }) => (
              <li className="my-sm text-body-sm text-text-body">{children}</li>
            ),
            code: ({ children }) => (
              <code
                className="whitespace-pre-wrap break-all rounded bg-zinc-100 px-1 py-0.5 font-mono text-body-sm text-text-body"
                style={{ wordBreak: 'break-all' }}
              >
                {children}
              </code>
            ),
            pre: ({ children }) => (
              <pre
                className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-zinc-100 p-2 text-xs"
                style={{ wordBreak: 'break-all' }}
              >
                {children}
              </pre>
            ),
            blockquote: ({ children }) => (
              <blockquote className="text-primary border-l-4 border-zinc-300 pl-3 italic">
                {children}
              </blockquote>
            ),
            strong: ({ children }) => (
              <strong className="text-primary font-semibold">{children}</strong>
            ),
            em: ({ children }) => (
              <em className="text-primary italic">{children}</em>
            ),
            a: ({ children, href }) => {
              const cleanChildren =
                typeof children === 'string'
                  ? children.replace(/^[.,"'{}()\[\]]+|[.,"'{}()\[\]]+$/g, '')
                  : children;
              const cleanHref =
                typeof href === 'string'
                  ? href
                      .replace(/^[.,"'{}()\[\]]+|[.,"'{}()\[\]]+$/g, '')
                      .replace(/(%[0-9A-Fa-f]{2})+$/g, '')
                  : href;
              return (
                <a
                  href={cleanHref}
                  className="inline break-words text-blue-600 underline hover:text-blue-800"
                  style={{
                    wordBreak: 'break-word',
                    overflowWrap: 'break-word',
                  }}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {cleanChildren}
                </a>
              );
            },
            table: ({ children }) => (
              <div className="w-full max-w-full overflow-x-auto">
                <table
                  className="mb-4 !table w-full min-w-0"
                  style={{
                    borderCollapse: 'collapse',
                    border: '1px solid #d1d5db',
                    borderSpacing: 0,
                    tableLayout: 'auto',
                    wordBreak: 'break-word',
                  }}
                >
                  {children}
                </table>
              </div>
            ),
            thead: ({ children }) => (
              <thead
                className="!table-header-group"
                style={{ backgroundColor: '#f9fafb' }}
              >
                {children}
              </thead>
            ),
            tbody: ({ children }) => (
              <tbody className="!table-row-group">{children}</tbody>
            ),
            tr: ({ children }) => <tr className="!table-row">{children}</tr>,
            th: ({ children }) => (
              <th
                className="text-primary !table-cell max-w-0 text-left text-[13px] font-semibold"
                style={{
                  border: '1px solid #d1d5db',
                  padding: '8px 12px',
                  borderCollapse: 'collapse',
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word',
                  maxWidth: '200px',
                }}
              >
                {children}
              </th>
            ),
            td: ({ children }) => (
              <td
                className="text-primary !table-cell max-w-0 text-[13px]"
                style={{
                  border: '1px solid #d1d5db',
                  padding: '8px 12px',
                  borderCollapse: 'collapse',
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word',
                  maxWidth: '200px',
                }}
              >
                {children}
              </td>
            ),
          }}
        >
          {displayedContent}
        </ReactMarkdown>
      </div>
    );
  }
);

MarkDown.displayName = 'MarkDown';
