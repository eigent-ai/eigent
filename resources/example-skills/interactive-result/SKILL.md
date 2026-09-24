---
name: interactive-result
description: Create a self-contained interactive HTML result for an Eigent task when controls help the user explore its final answer.
---

# Create an interactive result

Use this skill when the result benefits from user-controlled filtering, comparison, calculation, or navigation. A normal answer should remain Markdown.

Write one self-contained HTML file with semantic headings and labeled controls. Embed the data, CSS, and JavaScript needed for the interaction. Support a narrow window, keyboard use, readable light and dark presentation, and reduced motion. Treat task data as text, not executable code. Do not include secrets, remote libraries, network requests, external forms, parent-window APIs, or Electron/Node APIs.

In the final response, explain the conclusion in plain text and link to the HTML artifact using the file mechanism available in the current task. The text must remain useful if the interactive view cannot load. Do not paste the whole HTML document into the Markdown response. Do not claim that an inline preview is available unless the application actually displays it.

Use [the accessible template](examples/accessible-template.html) as a starting point. The host's inline artifact contract is still under development, so use the normal task file reference today.
