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
        UTILS["utils.py<br/>(Utilities)"]
    end

    subgraph "Factory"
        BROWSER["browser.py"]
        DEV["developer.py"]
        DOC["document.py"]
        MODAL["multi_modal.py"]
        MCP["mcp.py"]
        QC["question_confirm.py"]
        SOCIAL["social_medium.py"]
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
    BROWSER --> UTILS
    BROWSER --> TOOLKITS

    DEV --> AM
    DEV --> PROMPT
    DEV --> UTILS
    DEV --> TOOLKITS

    DOC --> AM
    DOC --> PROMPT
    DOC --> UTILS
    DOC --> TOOLKITS

    MODAL --> AM
    MODAL --> PROMPT
    MODAL --> UTILS
    MODAL --> TOOLKITS

    MCP --> LCA
    MCP --> TOOLS
    MCP --> PROMPT

    QC --> AM
    QC --> PROMPT
    QC --> UTILS

    SOCIAL --> AM
    SOCIAL --> PROMPT
    SOCIAL --> UTILS
    SOCIAL --> TOOLKITS

    SUMMARY --> AM
    SUMMARY --> PROMPT
```

## Dependency Graph

```mermaid
graph LR
    subgraph "Leaf Modules (No Internal Dependencies)"
        UTILS["utils.py"]
        PROMPT["prompt.py"]
    end

    subgraph "Core Modules"
        LCA["listen_chat_agent.py"]
        AM["agent_model.py"]
        TOOLS["tools.py"]
    end

    subgraph "Factory Modules"
        BROWSER["browser.py"]
        DEV["developer.py"]
        DOC["document.py"]
        MODAL["multi_modal.py"]
        MCP["mcp.py"]
        QC["question_confirm.py"]
        SOCIAL["social_medium.py"]
        SUMMARY["task_summary.py"]
    end

    AM --> LCA

    BROWSER --> AM
    BROWSER --> LCA
    BROWSER --> PROMPT
    BROWSER --> UTILS

    DEV --> AM
    DEV --> LCA
    DEV --> PROMPT
    DEV --> UTILS

    DOC --> AM
    DOC --> LCA
    DOC --> PROMPT
    DOC --> UTILS

    MODAL --> AM
    MODAL --> LCA
    MODAL --> PROMPT
    MODAL --> UTILS

    MCP --> LCA
    MCP --> TOOLS
    MCP --> PROMPT

    QC --> AM
    QC --> PROMPT
    QC --> UTILS

    SOCIAL --> AM
    SOCIAL --> LCA
    SOCIAL --> PROMPT
    SOCIAL --> UTILS

    SUMMARY --> AM
    SUMMARY --> PROMPT
```

## File Descriptions

| File | Purpose |
|------|---------|
| `agent_model.py` | Core factory function for creating agents with event loop management |
| `listen_chat_agent.py` | Base agent class extending CAMEL's ChatAgent with task tracking |
| `tools.py` | Toolkit and MCP tools loader utilities |
| `prompt.py` | System prompts for all 8 agent types |
| `utils.py` | Shared utilities (NOW_STR timestamp constant) |

### Factory Files

| File | Agent Type | Async | Key Toolkits |
|------|------------|-------|--------------|
| `browser.py` | Senior Research Analyst | No | HybridBrowserToolkit, SearchToolkit, TerminalToolkit |
| `developer.py` | Lead Software Engineer | Yes | TerminalToolkit, WebDeployToolkit, ScreenshotToolkit |
| `document.py` | Documentation Specialist | Yes | FileToolkit, PPTXToolkit, ExcelToolkit, GoogleDriveToolkit |
| `multi_modal.py` | Creative Content Specialist | No | VideoDownloadToolkit, ImageAnalysisToolkit, AudioAnalysisToolkit |
| `mcp.py` | MCP Server Agent | Yes | McpSearchToolkit, dynamic MCP tools |
| `question_confirm.py` | Question Confirmation | No | Minimal (wrapper only) |
| `social_medium.py` | Social Media Manager | Yes | WhatsAppToolkit, TwitterToolkit, LinkedInToolkit, etc. |
| `task_summary.py` | Task Summarizer | No | Minimal (wrapper only) |

## Design Patterns

### Factory Pattern

```mermaid
graph TB
    AM["agent_model()<br/>(Core Factory)"]
    LCA["ListenChatAgent<br/>(Base Class)"]

    subgraph "Specialized Factories"
        B["browser_agent()"]
        D["developer_agent()"]
        DOC["document_agent()"]
        M["multi_modal_agent()"]
        MCP["mcp_agent()"]
        Q["question_confirm_agent()"]
        S["social_medium_agent()"]
        T["task_summary_agent()"]
    end

    AM --> LCA
    B --> AM
    D --> AM
    DOC --> AM
    M --> AM
    Q --> AM
    S --> AM
    T --> AM
    MCP -.-> LCA
```

### Inheritance Hierarchy

```mermaid
classDiagram
    class ChatAgent {
        <<CAMEL Framework>>
        +step()
        +astep()
        +_execute_tool()
        +_aexecute_tool()
    }

    class ListenChatAgent {
        +process_task_id
        +agent_name
        +api_task_id
        +step() override
        +astep() override
        +_execute_tool() override
        +_aexecute_tool() override
    }

    ChatAgent <|-- ListenChatAgent
```

## Toolkit Integration Flow

```mermaid
sequenceDiagram
    participant F as Factory Function
    participant T as Toolkits
    participant TMI as ToolkitMessageIntegration
    participant AM as agent_model()
    participant LCA as ListenChatAgent

    F->>T: Instantiate toolkits
    F->>TMI: Wrap with message integration
    TMI->>T: register_toolkits()
    T-->>TMI: Wrapped tools
    F->>AM: Pass tools + prompt + options
    AM->>LCA: Create agent instance
    LCA-->>F: Configured agent
```
