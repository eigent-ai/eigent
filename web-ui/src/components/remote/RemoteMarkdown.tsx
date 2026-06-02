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

import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface RemoteMarkdownProps {
  content: string;
  className?: string;
}

/**
 * Markdown renderer for remote-control agent output. Maps every element to
 * design-system tokens. All dividers and borders are 1px (`border` /
 * `border-b` resolve to 1px in Tailwind).
 */
export function RemoteMarkdown({ content, className }: RemoteMarkdownProps) {
  // Normalise escaped newlines so single `\n` produces a soft break.
  const normalized = content.replace(/\\n/g, '  \n ');

  return (
    <div
      className={cn(
        'min-w-0 text-body-sm text-ds-text-neutral-default-default w-full break-words select-text',
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="mb-2 mt-3 text-heading-sm font-bold text-ds-text-neutral-default-default first:mt-0 break-words">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mb-2 mt-3 text-body-lg font-semibold text-ds-text-neutral-default-default first:mt-0 break-words">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mb-1.5 mt-2.5 text-body-md font-semibold text-ds-text-neutral-default-default first:mt-0 break-words">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="mb-1 mt-2 text-body-sm font-semibold text-ds-text-neutral-default-default first:mt-0 break-words">
              {children}
            </h4>
          ),
          p: ({ children }) => (
            <p className="my-2 text-body-sm font-normal leading-relaxed text-ds-text-neutral-default-default first:mt-0 last:mb-0 break-words">
              {children}
            </p>
          ),
          ul: ({ children }) => (
            <ul className="my-2 pl-5 text-body-sm text-ds-text-neutral-default-default marker:text-ds-text-neutral-muted-default list-disc">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 pl-5 text-body-sm text-ds-text-neutral-default-default marker:text-ds-text-neutral-muted-default list-decimal">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="my-1 leading-relaxed list-outside break-words">
              {children}
            </li>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              className="text-ds-text-neutral-default-default hover:text-ds-text-neutral-default-hover break-all underline underline-offset-2"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-ds-text-neutral-default-default">
              {children}
            </strong>
          ),
          em: ({ children }) => (
            <em className="text-ds-text-neutral-default-default italic">
              {children}
            </em>
          ),
          del: ({ children }) => (
            <del className="text-ds-text-neutral-muted-default line-through">
              {children}
            </del>
          ),
          hr: () => (
            <hr className="my-3 border-ds-border-neutral-subtle-default border-0 border-t border-solid" />
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-ds-border-neutral-strong-default pl-3 text-body-sm text-ds-text-neutral-muted-default border-l border-solid italic">
              {children}
            </blockquote>
          ),
          code: ({ children, className: codeClass }) => {
            // Inline code has no language class; block code is wrapped in <pre>.
            const isBlock = /language-/.test(codeClass || '');
            if (isBlock) {
              return (
                <code className="font-mono text-label-xs text-ds-text-neutral-default-default">
                  {children}
                </code>
              );
            }
            return (
              <code className="rounded bg-code-surface px-1 py-0.5 font-mono text-label-xs text-ds-text-neutral-default-default">
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-2 rounded-lg border-ds-border-neutral-subtle-default bg-code-surface p-3 font-mono text-label-xs overflow-x-auto border border-solid whitespace-pre-wrap">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="my-2 w-full max-w-full overflow-x-auto">
              <table className="min-w-0 border-ds-border-neutral-default-default w-full border-collapse border border-solid">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-ds-bg-neutral-subtle-default">
              {children}
            </thead>
          ),
          tr: ({ children }) => (
            <tr className="border-ds-border-neutral-subtle-default border-b border-solid">
              {children}
            </tr>
          ),
          th: ({ children }) => (
            <th className="border-ds-border-neutral-default-default px-2 py-1 text-label-xs font-semibold text-ds-text-neutral-default-default border border-solid text-left">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-ds-border-neutral-default-default px-2 py-1 text-label-xs text-ds-text-neutral-default-default border border-solid">
              {children}
            </td>
          ),
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}
