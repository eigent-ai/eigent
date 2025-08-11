import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const MarkDown = ({
	content,
	speed = 15,
	onTyping,
	enableTypewriter = true, // Whether to enable typewriter effect
	pTextSize = "text-xs",
	olPadding = "",
}: {
	content: string;
	speed?: number;
	onTyping?: () => void;
	enableTypewriter?: boolean;
	pTextSize?: string;
	olPadding?: string;
}) => {
	const [displayedContent, setDisplayedContent] = useState("");

	useEffect(() => {
		if (!enableTypewriter) {
			setDisplayedContent(content);
			return;
		}

		setDisplayedContent("");
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
		return text.replace(/\\n/g, "  \n "); // add two spaces before \n, so ReactMarkdown will recognize it as a line break
	};
	return (
		<div className="prose prose-sm w-full select-text pointer-events-auto overflow-x-auto">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					h1: ({ children }) => (
						<h1 className="text-xs font-bold text-primary mb-1 break-words">
							{children}
						</h1>
					),
					h2: ({ children }) => (
						<h2 className="text-xs font-semibold text-primary mb-1 break-words">
							{children}
						</h2>
					),
					h3: ({ children }) => (
						<h3 className="text-xs font-medium text-primary mb-1 break-words">
							{children}
						</h3>
					),
					p: ({ children }) => (
						<p
							className={`m-0 ${pTextSize} font-medium text-xs text-primary leading-10 font-inter whitespace-pre-line break-words`}
						>
							{children}
						</p>
					),
					ul: ({ children }) => (
						<ul
							className={`list-disc list-inside text-xs text-primary mb-1 ${olPadding}`}
						>
							{children}
						</ul>
					),
					ol: ({ children }) => (
						<ol
							className={`list-decimal list-inside text-xs text-primary mb-1 ${olPadding}`}
						>
							{children}
						</ol>
					),
					li: ({ children }) => (
						<li className="mb-1 list-inside break-all">{children}</li>
					),
					a: ({ children, href }) => (
						<a
							href={href}
							className=" hover:text-blue-800 underline break-all"
							target="_blank"
							rel="noopener noreferrer"
						>
							{children}
						</a>
					),
					code: ({ children }) => (
						<code className="bg-zinc-100 px-1 py-0.5 rounded text-xs font-mono">
							{children}
						</code>
					),
					pre: ({ children }) => (
						<pre className="bg-zinc-100 p-2 rounded text-xs overflow-x-auto">
							{children}
						</pre>
					),
					blockquote: ({ children }) => (
						<blockquote className="border-l-4 border-zinc-300 pl-3 italic text-primary text-xs">
							{children}
						</blockquote>
					),
					strong: ({ children }) => (
						<strong className="font-semibold text-primary text-xs">
							{children}
						</strong>
					),
					em: ({ children }) => (
						<em className="italic text-primary text-xs">{children}</em>
					),
					table: ({ children }) => (
						<div className="overflow-x-auto w-full max-w-full">
							<table
								className="w-full mb-4 !table min-w-0"
								style={{
									borderCollapse: "collapse",
									border: "1px solid #d1d5db",
									borderSpacing: 0,
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
							className="text-left font-semibold text-primary text-[10px] !table-cell"
							style={{
								border: "1px solid #d1d5db",
								padding: "2px 5px",
								borderCollapse: "collapse",
							}}
						>
							{children}
						</th>
					),
					td: ({ children }) => (
						<td
							className="text-primary text-[10px] !table-cell"
							style={{
								border: "1px solid #d1d5db",
								padding: "2px 5px",
								borderCollapse: "collapse",
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
