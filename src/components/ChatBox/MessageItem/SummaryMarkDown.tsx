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

export const SummaryMarkDown = ({
  content,
  speed = 15,
  onTyping,
  enableTypewriter = true,
}: {
  content: string;
  speed?: number;
  onTyping?: () => void;
  enableTypewriter?: boolean;
}) => {
  const [displayedContent, setDisplayedContent] = useState('');
  const [_isTyping, setIsTyping] = useState(true);

  useEffect(() => {
    if (!enableTypewriter) {
      setDisplayedContent(content);
      setIsTyping(false);
      return;
    }

    setDisplayedContent('');
    setIsTyping(true);
    let index = 0;

    const timer = setInterval(() => {
      if (index < content.length) {
        setDisplayedContent(content.slice(0, index + 1));
        index++;
        if (onTyping) {
          onTyping();
        }
      } else {
        setIsTyping(false);
        clearInterval(timer);
      }
    }, speed);

    return () => clearInterval(timer);
  }, [content, speed, onTyping, enableTypewriter]);

  // If content is a pure HTML document, render in a styled pre block
  if (isHtmlDocument(content)) {
    // Trim leading whitespace from each line for consistent alignment
    const formattedHtml = displayedContent
      .split('\n')
      .map((line) => line.trimStart())
      .join('\n')
      .trim();
    return (
      <div className="prose prose-sm max-w-none">
        <pre className="mb-3 overflow-x-auto whitespace-pre-wrap rounded-lg border border-ds-border-status-completed-default-default bg-ds-bg-completed-subtle-default p-3 font-mono text-xs text-ds-text-neutral-default-default">
          <code>{formattedHtml}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="prose prose-sm max-w-none">
      <ReactMarkdown
        components={{
          h1: ({ children }) => (
            <h1 className="mb-3 flex items-center gap-2 border-b border-ds-border-status-completed-default-default pb-2 text-xl font-bold text-ds-text-success-default-default">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-3 mt-4 flex items-center gap-2 text-lg font-semibold text-ds-text-status-completed-muted-default">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-2 mt-3 text-base font-medium text-ds-text-status-completed-muted-default">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="m-0 mb-3 whitespace-pre-wrap text-sm font-normal leading-relaxed text-ds-text-neutral-default-default">
              {children}
            </p>
          ),
          ul: ({ children }) => (
            <ul className="mb-3 ml-2 list-inside list-disc space-y-1 text-sm text-ds-text-neutral-default-default">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-3 ml-2 list-inside list-decimal space-y-1 text-sm text-ds-text-neutral-default-default">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="mb-1 leading-relaxed text-ds-text-neutral-default-default">
              {children}
            </li>
          ),
          code: ({ children }) => (
            <code className="rounded bg-ds-bg-completed-subtle-default px-2 py-1 font-mono text-xs text-ds-text-success-default-default">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="mb-3 overflow-x-auto whitespace-pre-wrap rounded-lg border border-ds-border-status-completed-default-default bg-ds-bg-completed-subtle-default p-3 font-mono text-xs text-ds-text-neutral-default-default">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="mb-3 rounded-r-lg border-l-4 border-ds-border-status-completed-default-default bg-ds-bg-completed-subtle-default py-2 pl-4 italic text-ds-text-status-completed-muted-default">
              {children}
            </blockquote>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-ds-text-success-default-default">
              {children}
            </strong>
          ),
          em: ({ children }) => (
            <em className="italic text-ds-text-status-completed-muted-default">
              {children}
            </em>
          ),
          hr: () => (
            <hr className="my-4 border-ds-border-status-completed-default-default" />
          ),
        }}
      >
        {displayedContent}
      </ReactMarkdown>
    </div>
  );
};
