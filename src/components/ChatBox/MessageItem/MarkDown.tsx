import { useState, useEffect, memo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const MarkDown = memo(
	({
		content,
		speed = 10,
		onTyping,
		enableTypewriter = true, // Whether to enable typewriter effect
		pTextSize = "text-body-sm",
		olPadding = "pl-3",
	}: {
		content: string;
		speed?: number;
		onTyping?: () => void;
		enableTypewriter?: boolean;
		pTextSize?: string;
		olPadding?: string;
	}) => {
		const [displayedContent, setDisplayedContent] = useState("");
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

			setDisplayedContent("");
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

		return (
			<div className="max-w-none markdown-container overflow-hidden">
				<ReactMarkdown
					remarkPlugins={[remarkGfm]}
					components={{
						h1: ({ children }) => (
							<h1 className="text-lg font-bold text-primary mb-2 break-words text-wrap">
								{children}
							</h1>
						),
						h2: ({ children }) => (
							<h2 className="text-base font-semibold text-primary mb-2 break-words text-wrap">
								{children}
							</h2>
						),
						h3: ({ children }) => (
							<h3 className="text-sm font-medium text-primary mb-1 break-words text-wrap">
								{children}
							</h3>
						),
						p: ({ children }) => (
							<p
								className={`${pTextSize} font-medium text-text-body leading-10 font-inter whitespace-pre-wrap break-all`}
								style={{ margin: 0, wordBreak: 'break-all' }}
							>
								{children}
							</p>
						),
						ul: ({ children }) => (
							<ul
								className={`list-disc list-outside text-body-sm text-text-body ml-3 mb-2 ${olPadding}`}
							>
								{children}
							</ul>
						),
						li: ({ children }) => (
							<li className="my-sm text-body-sm text-text-body">{children}</li>
						),
						code: ({ children }) => (
							<code 
								className="bg-zinc-100 px-1 py-0.5 rounded text-body-sm text-text-body font-mono whitespace-pre-wrap break-all"
								style={{ wordBreak: 'break-all' }}
							>
								{children}
							</code>
						),
						pre: ({ children }) => (
							<pre 
								className="bg-zinc-100 p-2 rounded text-xs overflow-x-auto whitespace-pre-wrap break-all"
								style={{ wordBreak: 'break-all' }}
							>
								{children}
							</pre>
						),
						blockquote: ({ children }) => (
							<blockquote className="border-l-4 border-zinc-300 pl-3 italic text-primary">
								{children}
							</blockquote>
						),
						strong: ({ children }) => (
							<strong className="font-semibold text-primary">{children}</strong>
						),
						em: ({ children }) => (
							<em className="italic text-primary">{children}</em>
						),
						a: ({ children, href }) => {
							const cleanChildren = typeof children === 'string' 
								? children.replace(/^[.,"'{}()\[\]]+|[.,"'{}()\[\]]+$/g, '') 
								: children;
							const cleanHref = typeof href === 'string'
								? href.replace(/^[.,"'{}()\[\]]+|[.,"'{}()\[\]]+$/g, '').replace(/(%[0-9A-Fa-f]{2})+$/g, '')
								: href;
							return (
								<a 
									href={cleanHref} 
									className="text-blue-600 hover:text-blue-800 underline break-words inline"
									style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}
									target="_blank" 
									rel="noopener noreferrer"
								>
									{cleanChildren}
								</a>
							);
						},
						table: ({ children }) => (
							<div className="overflow-x-auto w-full max-w-full">
								<table
									className="w-full mb-4 !table min-w-0"
									style={{
										borderCollapse: "collapse",
										border: "1px solid #d1d5db",
										borderSpacing: 0,
										tableLayout: "auto",
										wordBreak: "break-word",
									}}
								>
									{children}
								</table>
							</div>
						),
						thead: ({ children }) => (
							<thead
								className="!table-header-group"
								style={{ backgroundColor: "#f9fafb" }}
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
								className="text-left font-semibold text-primary text-[13px] !table-cell max-w-0"
								style={{
									border: "1px solid #d1d5db",
									padding: "8px 12px",
									borderCollapse: "collapse",
									wordBreak: "break-word",
									overflowWrap: "break-word",
									maxWidth: "200px",
								}}
							>
								{children}
							</th>
						),
						td: ({ children }) => (
							<td
								className="text-primary text-[13px] !table-cell max-w-0"
								style={{
									border: "1px solid #d1d5db",
									padding: "8px 12px",
									borderCollapse: "collapse",
									wordBreak: "break-word",
									overflowWrap: "break-word",
									maxWidth: "200px",
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
