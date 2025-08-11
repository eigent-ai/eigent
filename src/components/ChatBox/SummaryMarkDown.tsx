import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";

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
	const [displayedContent, setDisplayedContent] = useState("");
	const [isTyping, setIsTyping] = useState(true);

	useEffect(() => {
		if (!enableTypewriter) {
			setDisplayedContent(content);
			setIsTyping(false);
			return;
		}

		setDisplayedContent("");
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
	}, [content, speed, onTyping]);

	return (
		<div className="prose prose-sm max-w-none">
			<ReactMarkdown
				components={{
					h1: ({ children }) => (
						<h1 className="text-xl font-bold text-emerald-800 mb-3 flex items-center gap-2 border-b border-emerald-200 pb-2">
							{children}
						</h1>
					),
					h2: ({ children }) => (
						<h2 className="text-lg font-semibold text-emerald-700 mb-3 mt-4 flex items-center gap-2">
							{children}
						</h2>
					),
					h3: ({ children }) => (
						<h3 className="text-base font-medium text-emerald-600 mb-2 mt-3">
							{children}
						</h3>
					),
					p: ({ children }) => (
						<p className="m-0 text-sm font-normal text-gray-700 leading-relaxed mb-3 whitespace-pre-wrap">
							{children}
						</p>
					),
					ul: ({ children }) => (
						<ul className="list-disc list-inside text-sm text-gray-700 mb-3 space-y-1 ml-2">
							{children}
						</ul>
					),
					ol: ({ children }) => (
						<ol className="list-decimal list-inside text-sm text-gray-700 mb-3 space-y-1 ml-2">
							{children}
						</ol>
					),
					li: ({ children }) => (
						<li className="mb-1 text-gray-700 leading-relaxed">{children}</li>
					),
					code: ({ children }) => (
						<code className="bg-emerald-100 text-emerald-800 px-2 py-1 rounded text-xs font-mono">
							{children}
						</code>
					),
					pre: ({ children }) => (
						<pre className="bg-emerald-50 border border-emerald-200 p-3 rounded-lg text-xs overflow-x-auto mb-3">
							{children}
						</pre>
					),
					blockquote: ({ children }) => (
						<blockquote className="border-l-4 border-emerald-300 pl-4 italic text-emerald-700 bg-emerald-50 py-2 rounded-r-lg mb-3">
							{children}
						</blockquote>
					),
					strong: ({ children }) => (
						<strong className="font-semibold text-emerald-800">{children}</strong>
					),
					em: ({ children }) => (
						<em className="italic text-emerald-600">{children}</em>
					),
					hr: () => (
						<hr className="border-emerald-200 my-4" />
					),
				}}
			>
				{displayedContent}
			</ReactMarkdown>
		</div>
	);
};
