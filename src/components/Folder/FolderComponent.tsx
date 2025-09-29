import React, { useMemo } from "react";
import DOMPurify from "dompurify";

type Props = {
	selectedFile: {
		content?: string | null;
	};
};

export default function FolderComponent({ selectedFile }: Props) {
	const sanitizedHtml = useMemo(() => {
		const raw = selectedFile?.content || "";
		if (!raw) return "";

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
				console.warn("Detected forbidden content:", pattern);
				return "";
			}
		}

		return DOMPurify.sanitize(raw, {
			USE_PROFILES: { html: true },
			ALLOWED_TAGS: [
				"a",
				"b",
				"i",
				"u",
				"strong",
				"em",
				"p",
				"br",
				"ul",
				"ol",
				"li",
				"img",
				"div",
				"span",
				"table",
				"thead",
				"tbody",
				"tr",
				"td",
				"th",
				"pre",
				"code",
				"h1",
				"h2",
				"h3",
				"h4",
				"h5",
				"h6",
			],
			ALLOWED_ATTR: [
				"href",
				"src",
				"alt",
				"title",
				"width",
				"height",
				"target",
				"rel",
				"colspan",
				"rowspan",
				"class",
				"id",
			],
			FORBID_ATTR: [
				"onerror",
				"onload",
				"onclick",
				"onmouseover",
				"onfocus",
				"onblur",
				"onchange",
				"onsubmit",
				"onreset",
				"onselect",
				"onabort",
				"onkeydown",
				"onkeypress",
				"onkeyup",
				"onunload",
			],
			FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button"],
			ADD_ATTR: ["target"],
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
