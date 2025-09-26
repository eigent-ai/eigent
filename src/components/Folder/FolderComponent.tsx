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
		// 如果内容包含 ipcRenderer，直接返回空字符串
		if (raw.includes("ipcRenderer")) {
			console.warn("Detected forbidden content: ipcRenderer");
			return "";
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
			],
			FORBID_ATTR: ["onerror", "onload"],
		});
	}, [selectedFile?.content]);

	return (
		<div
			className="w-full overflow-auto"
			dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
		/>
	);
}
