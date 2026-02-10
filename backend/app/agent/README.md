# Agent Module

This module provides the agent infrastructure for eigent, built on top of the CAMEL framework.

## Architecture Overview

```mermaid
graph TB
    subgraph "Core"
        AM["agent_model.py<br/>(Core Factory)"]
        LCA["listen_chat_agent.py<br/>(Base Agent Class)"]
        TOOLS["tools.py<br/>(Toolkit Loaders)"]
        PROMPT["prompt.py<br/>(System Prompts)"]
    end

    subgraph "Factory"
        BROWSER["browser.py"]
        DEV["developer.py"]
        DOC["document.py"]
        MODAL["multi_modal.py"]
        MCP["mcp.py"]
        QC["question_confirm.py"]
        SOCIAL["social_media.py"]
        SUMMARY["task_summary.py"]
    end

    subgraph "External"
        CAMEL["CAMEL Framework"]
        TASK["Task Service"]
        TOOLKITS["Toolkits"]
    end

    AM --> LCA
    AM --> CAMEL
    AM --> TASK

    LCA --> CAMEL
    LCA --> TASK

    BROWSER --> AM
    BROWSER --> PROMPT
    BROWSER --> TOOLKITS

    DEV --> AM
    DEV --> PROMPT
    DEV --> TOOLKITS

    DOC --> AM
    DOC --> PROMPT
    DOC --> TOOLKITS

    MODAL --> AM
    MODAL --> PROMPT
    MODAL --> TOOLKITS

    MCP --> LCA
    MCP --> TOOLS
    MCP --> PROMPT

    QC --> AM
    QC --> PROMPT

    SOCIAL --> AM
    SOCIAL --> PROMPT
    SOCIAL --> TOOLKITS

    SUMMARY --> AM
    SUMMARY --> PROMPT
```

## File Descriptions

| File                   | Purpose                                                              |
| ---------------------- | -------------------------------------------------------------------- |
| `agent_model.py`       | Core factory function for creating agents with event loop management |
| `listen_chat_agent.py` | Base agent class extending CAMEL's ChatAgent with task tracking      |
| `tools.py`             | Toolkit and MCP tools loader utilities                               |
| `prompt.py`            | System prompts for all 8 agent types                                 |

### Factory Files

| File                  | Agent Type                  |
| --------------------- | --------------------------- |
| `browser.py`          | Senior Research Analyst     |
| `developer.py`        | Lead Software Engineer      |
| `document.py`         | Documentation Specialist    |
| `multi_modal.py`      | Creative Content Specialist |
| `mcp.py`              | MCP Server Agent            |
| `question_confirm.py` | Question Confirmation       |
| `social_media.py`     | Social Media Manager        |
| `task_summary.py`     | Task Summarizer             |
