---
title: Workforce
description: Understand core concepts and features that power Eigent.
icon: cubes
---
## Concept: What is a Workforce?

Workforce is CAMEL-AI's multi-agent teamwork engine. 

Instead of relying on a single agent, Workforce lets you organize a *team* of specialized agents—each with its own strengths—under a single, coordinated system. You can quickly assemble, configure, and launch collaborative agent "workforces" for any task that needs parallelization, diverse expertise, or complex workflows.

With Workforce, agents plan, solve, and verify work together—like a project team in an organization, but fully automated.


<aside>
**📌 Key advantages of Workforce:**

- Instantly scale from single-agent to multi-agent workflows
- Built-in coordination, planning, and failure recovery
- Ideal for hackathons, evaluations, code review, brainstorming, and more
- Configure roles, toolsets, and communication patterns for *any* scenario
</aside>

## System Design

### **Architecture: How Workforce Works**

Workforce uses a **hierarchical, modular design** for real-world team problem-solving.
![Workforce](/docs/images/workforce.jpg)

See how the coordinator and task planner agents orchestrate a multi-agent workflow:

- **Workforce:** The “team” as a whole.
- **Worker nodes:** Individual contributors—each node can contain one or more agents, each with their own capabilities.
- **Coordinator agent:** The “project manager”—routes tasks to worker nodes based on their role and skills.
- **Task planner agent:** The “strategy lead”—breaks down big jobs into smaller, doable subtasks and organizes the workflow.

### **Communication: A Shared Task Channel**

Every Workforce gets a **shared task channel** when it’s created.
**How it works:**
- All tasks are posted into this channel.
- Worker nodes “listen” and accept their assigned tasks.
- Results are posted back to the channel, where they’re available as dependencies for the next steps.

*This design lets agents build on each other’s work and ensures no knowledge is lost between steps.*

### **Failure Handling: Built-In Robustness**

Workforce is designed to handle failures and recover gracefully.

If a worker fails a task, the coordinator agent will:
- **Decompose and retry:** Break the task into even smaller pieces and reassign.
- **Escalate:** If the task keeps failing, create a new worker designed for that problem.
To prevent infinite loops, if a task has failed or been decomposed more than a set number of times (default: 3), Workforce will automatically halt that workflow.

<aside>


**📌 Tip:** Workforce automatically stops stuck workflows—so you don’t waste compute or get caught in agent loops!

</aside>

## Worker Nodes

Eigent comes with a set of pre-configured agents, each designed for a specific domain of expertise. These agents are equipped with a curated set of toolkits to make them effective right out of the box.

### DeveloperAgent

*A skilled coding assistant that can write and execute code, run terminal commands, and verify solutions to complete tasks.*

**Equipped Toolkits:**

- HumanToolkit
- TerminalToolkit
- NoteTakingToolkit
- WebDeployToolkit

### SearchAgent

*Can search the web, extract webpage content, simulate browser actions, and provide relevant information to solve the given task.*

**Equipped Toolkits:**

- SearchToolkit
- HybridBrowserToolkit
- HumanToolkit
- NoteTakingToolkit
- TerminalToolkit

### DocumentAgent

*A document processing assistant for creating, modifying, and managing various document formats, including presentations.*

**Equipped Toolkits:**

- FileToolkit
- PPTXToolkit
- HumanToolkit
- MarkItDownToolkit
- ExcelToolkit
- NoteTakingToolkit
- TerminalToolkit
- GoogleDriveMCPToolkit
- SearchToolkit

### Multi-ModalAgent

*A multi-modal processing assistant for analyzing and generating media content like audio and images.*

**Equipped Toolkits:**

- VideoDownloaderToolkit
- AudioAnalysisToolkit
- ImageAnalysisToolkit
- OpenAIImageToolkit
- HumanToolkit
- TerminalToolkit
- NoteTakingToolkit
- SearchToolkit

## Toolkit Reference

Toolkits are the collections of functions that give your agents their powers. Here is a reference for the toolkits used by the pre-configured agents.

*(in alphabetical order)*

### [AudioAnalysisToolkit](https://docs.camel-ai.org/reference/camel.toolkits.audio_analysis_toolkit)

*Provides tools for audio processing and analysis.*

This toolkit allows an agent to process audio files. It can take an audio file (from a local path or URL) and transcribe the speech into text. It can also answer specific questions about the content of an audio file, enabling agents to extract information from podcasts, meetings, or voice notes.

### [ExcelToolkit](https://docs.camel-ai.org/reference/camel.toolkits.excel_toolkit)

*Enables agents to create, read, and manipulate Excel spreadsheets.*

This toolkit provides comprehensive functions for interacting with Excel files (`.xlsx/.xls/. csv`). Agents can create new workbooks, add or delete worksheets, read data from specific cells or ranges, write data to the spreadsheet, and convert data into Markdown formatted table.

### [FileToolkit](https://docs.camel-ai.org/reference/camel.toolkits.file_write_toolkit)

*A toolkit for creating, writing, and modifying text in files.*

This toolkit gives an agent the ability to create and write to files on the local file system (macOS, Linux, Windows). It provides support for writing to various file formats (Markdown, DOCX, PDF, and plaintext), replacing text in existing files, automatic filename uniquification to prevent overwrites, custom encoding and enhanced formatting options for specialized formats.

### [GoogleDriveMCPToolkit](https://docs.camel-ai.org/reference/camel.toolkits.google_drive_mcp_toolkit)

*Connects to Google Drive to manage files and folders.*

This toolkit allows agents to interact with a user's Google Drive. It can read files and folders from Google Drive. It acts as a bridge between the agent's local environment and cloud storage.

### [HumanToolkit](https://docs.camel-ai.org/reference/camel.toolkits.human_toolkit)

*Allows an agent to pause its task and ask the user for help.*

This is a critical toolkit for handling situations that require human intervention. When an agent is stuck, needs credentials, or requires a subjective decision, it can use this toolkit to send a prompt to the user and wait for a response before continuing its task.

### [HybridBrowserToolkit](https://docs.camel-ai.org/reference/camel.toolkits.hybrid_browser_toolkit.ws_wrapper)

*Provides a powerful, stateful browser for web navigation and interaction.*

This toolkit gives an agent a fully-featured web browser that it can control programmatically. Unlike simple web scraping, this toolkit maintains a session, allowing the agent to click, type, hover, screenshot, and live *Take Control* from the UI. 

### [ImageAnalysisToolkit](https://docs.camel-ai.org/reference/camel.toolkits.image_analysis_toolkit)

*Provides tools for understanding the content of images.*

This toolkit enables an agent to "see" and interpret images. It can generate a detailed text description of an image or answer specific questions about what an image contains. This is crucial for tasks that involve visual data, such as describing products, analyzing charts, or identifying objects in a photo.

### [MarkItDownToolkit](https://docs.camel-ai.org/reference/camel.toolkits.markitdown_toolkit)

*A specialized toolkit for converting content into clean Markdown.*

This toolkit is designed to scrape content from a list of local files and convert each into a structured Markdown format. The conversion is performed in parallel for efficiency. Supported file formats include: PDF, Office, EPUB, HTML, Images (ORC), Audio, Text, ZIP.

### [NoteTakingToolkit](https://docs.camel-ai.org/reference/camel.toolkits.note_taking_toolkit)

*A toolkit for managing and interacting with Markdown note files.*

This toolkit provides tools for creating, reading, appending to, and listing notes. All notes are stored as **`.md`** files in a dedicated working directory and are tracked in a registry. An agent can use it to write down any important information. Other agents can then read these notes to get context and build upon previous work, facilitating effective collaboration.

### [OpenAIImageToolkit](https://docs.camel-ai.org/reference/camel.toolkits.openai_image_toolkit)

*Generates images from text prompts using OpenAI's DALL-E models.*

This toolkit allows an agent to create new images based on a descriptive text prompt. It leverages models like DALL-E 3 to generate high-quality visuals, which can then be saved locally. This is essential for creative tasks, generating illustrations for documents, or any workflow requiring original image content.

### [PPTXToolkit](https://docs.camel-ai.org/reference/camel.toolkits.pptx_toolkit)

*Enables agents to create and write Microsoft PowerPoint presentations.*

This toolkit provides a suite of functions for building PowerPoint (`.pptx`) files. An agent can create a new presentation, add title and content slides, format text, create lists, and insert tables and images. It allows for the automated creation of professional-looking presentations.

### [SearchToolkit](https://docs.camel-ai.org/reference/camel.toolkits.search_toolkit)

*Provides access to various web search engines.*

This toolkit is the primary tool for web research. It allows an agent to search information on engines like Google, Wikipedia, Bing, and Baidu. The agent can submit a query and receive a list of relevant URLs and snippets, which it can then use as a starting point for deeper investigation with the `HybridBrowserToolkit`.

### [TerminalToolkit](https://docs.camel-ai.org/reference/camel.toolkits.terminal_toolkit)

*A toolkit for terminal operations across multiple operating systems.*

This toolkit gives an agent access to a command-line interface. It supports terminal operations such as searching for files by name or content, executing shell commands, and managing terminal sessions.

### [VideoDownloaderToolkit](https://docs.camel-ai.org/reference/camel.toolkits.video_download_toolkit)

*Allows an agent to download and process videos from popular platforms.*

This toolkit enables an agent to download video content from URLs (e.g., from YouTube) and optionally split them into chunks. The saved video can then be analyzed by other toolkits, such as the `AudioAnalysisToolkit` for transcription, or `ImageAnalysisToolkit` for object detection.

### [WebDeployToolkit](https://docs.camel-ai.org/reference/camel.toolkits.web_deploy_toolkit)

*Provides tools to deploy web content on a local server.*

This toolkit allows the `DeveloperAgent` to instantly host web applications or static files. It can serve a single HTML file or an entire folder (like a built React app) on a local port, making it easy to preview and test web development work.