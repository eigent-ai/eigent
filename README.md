<div align="center"><a name="readme-top"></a>

[![][image-head]][eigent-site]

[![][image-seperator]][eigent-site]

### Eigent: The Open Source Cowork Desktop to Unlock Your Exceptional Productivity

<!-- SHIELD GROUP -->

[![][download-shield]][eigent-download]
[![][github-star]][eigent-github]
[![][social-x-shield]][social-x-link]
[![][discord-image]][discord-url]<br>
[![Reddit][reddit-image]][reddit-url]
[![Wechat][wechat-image]][wechat-url]
[![][sponsor-shield]][sponsor-link]
[![][built-with-camel]][camel-github]
[![][join-us-image]][join-us]

</div>

<hr/>
<div align="center">

**English** · [Português](./README_PT-BR.md) · [简体中文](./README_CN.md) · [日本語](./README_JA.md) · [Official Site][eigent-site] · [Documents][docs-site] · [Feedback][github-issue-link]

</div>
<br/>

**Eigent** is the open source Cowork desktop application, empowering you to build, manage, and deploy a custom AI workforce that can turn your most complex workflows into automated tasks. As a leading open-source Cowork product, Eigent brings together the best of open-source collaboration and AI-powered automation.

Built on [CAMEL-AI][camel-site]'s acclaimed open-source project, our system introduces a **Multi-Agent Workforce** that **boosts productivity** through parallel execution, customization, and privacy protection.

### ⭐ 100% Open Source - 🥇 Local Deployment - 🏆 MCP Integration

- ✅ **Zero Setup** - No technical configuration required
- ✅ **Multi-Agent Coordination** - Handle complex multi-agent workflows
- ✅ **Single-Agent Harness** - Run focused tasks with one meta agent
- ✅ **Local Deployment**
- ✅ **Open Source**
- ✅ **Model Agnostic** - Support any model of your choice
- ✅ **MCP Integration**
- ✅ **Skill Integration**
- ✅ **Built-in Browser & Terminal Toolkits**
- ✅ **Enterprise Features** - SSO, access control, and custom enquiries

<br/>

[![][image-join-us]][join-us]

<details>
<summary><kbd>Table of contents</kbd></summary>

#### TOC

- [🚀 Getting Started with Open Source Cowork](#-getting-started-with-open-source-Cowork)
  - [🏠 Local Deployment (Recommended)](#-local-deployment-recommended)
  - [⚡ Quick Start (Cloud-Connected)](#-quick-start-cloud-connected)
  - [🏢 Enterprise](#-enterprise)
  - [☁️ Cloud Version](#%EF%B8%8F-cloud-version)
- [✨ Key features - Open Source Cowork](#-key-features---open-source-Cowork)
  - [🧑‍💻 Cowork with Single Agent](#-cowork-with-single-agent)
  - [🏭 Cowork with Workforce](#-cowork-with-workforce)
  - [⏰ Automation](#-automation)
  - [🔒 Local & Secure](#-local--secure)
  - [🧠 Model Agnostic](#-model-agnostic)
  - [👐 100% Open Source](#-100-open-source)
- [🧩 Use Cases - Open Source Cowork](#-use-cases---open-source-Cowork)
  - [For Developers](#for-developers)
  - [Featured](#featured)
- [🛠️ Tech Stack](#-tech-stack)
  - [Backend](#backend)
  - [Frontend](#frontend)
- [🌟 Staying ahead - Open Source Cowork](#-staying-ahead---open-source-Cowork)
- [🗺️ Roadmap - Open Source Cowork](#%EF%B8%8F-roadmap---open-source-Cowork)
- [📖 Contributing](#-contributing)
  - [Main Contributors](#main-contributors)
  - [Distinguished ambassador](#distinguished-ambassador)
- [Ecosystem](#ecosystem)
- [📄 Open Source License](#-open-source-license)
- [🌐 Community & contact](#-community--contact)

####

<br/>

</details>

## **🚀 Getting Started with Open Source Cowork**

> **🔓 Build in Public** — Eigent is **100% open source** from day one. Every feature, every commit, every decision is transparent. We believe the best AI tools should be built openly with the community, not behind closed doors.

### 🏠 Local Deployment (Recommended)

The recommended way to run Eigent — fully standalone with complete control over your data, no cloud account required.

👉 **[Full Local Deployment Guide](./server/README_EN.md)**

This setup includes:

- Local backend server with full API
- Local model integration (vLLM, Ollama, LM Studio, etc.)
- Complete isolation from cloud services
- Zero external dependencies

### ⚡ Quick Start (Cloud-Connected)

For a quick preview using our cloud backend — get started in seconds:

#### Prerequisites

- Node.js (version 18-22) and npm

#### Steps

```bash
git clone https://github.com/eigent-ai/eigent.git
cd eigent
npm install
npm run dev
```

> Note: This mode connects to Eigent cloud services and requires account registration. For a fully standalone experience, use [Local Deployment](#-local-deployment-recommended) instead.

#### Updating Dependencies

After pulling new code (`git pull`), update both frontend and backend dependencies:

```bash
# 1. Update frontend dependencies (in project root)
npm install

# 2. Update backend/Python dependencies (in backend directory)
cd backend
uv sync
```

### 🏢 Enterprise

For organizations requiring maximum security, customization, and control:

- **Exclusive Features** (like SSO & custom development)
- **Scalable Enterprise Deployment**
- **Negotiated SLAs** & implementation services

📧 For further details, [contact our sales team](https://www.eigent.ai/contact-sales).

### ☁️ Cloud Version

For teams who prefer managed infrastructure, we also offer a cloud platform. The fastest way to experience Eigent's multi-agent AI capabilities without setup complexity. We'll host the models, APIs, and cloud storage, ensuring Eigent runs flawlessly.

- **Instant Access** - Start building multi-agent workflows in minutes.
- **Managed Infrastructure** - We handle scaling, updates, and maintenance.
- **Premium Support** - Subscribe and get priority assistance from our engineering team.

<br/>

[![image-public-beta]][eigent-download]

<div align="right">
<a href="https://www.eigent.ai/download">Get started at Eigent.ai →</a>
</div>

## **✨ Key features - Open Source Cowork**

### 🧑‍💻 Cowork with Single Agent

Start with one focused agent for direct tasks. Research, write, debug, and operate alongside it in your desktop workspace.

### 🏭 Cowork with Workforce

Scale to multiple specialized agents that divide work, collaborate in parallel, and execute complex multi-step workflows together.

### ⏰ Automation

Schedule recurring workflows and let agents run tasks at the right time—so work continues even when you step away.

### 🔒 Local & Secure

Run agents on your machine with local-first execution. Your files, credentials, and context stay under your control.

### 🧠 Model Agnostic

Connect the models you already use—cloud APIs, enterprise gateways, or local inference—without locking into one vendor.

### 👐 100% Open Source

Eigent is completely open-sourced. You can download, inspect, and modify the code, ensuring transparency and fostering a community-driven ecosystem for multi-agent innovation.

## 🧩 Use Cases - Open Source Cowork

Explore how Eigent turns complex desktop work into repeatable agent workflows.

### For Developers

#### [Build 10 Chinese New Year HTML5 Games with Eigent](https://www.eigent.ai/use-cases/build-10-cny-horse-themed-html5-games)

Coordinate parallel agents to build ten polished, mobile-friendly browser games across genres, complete with scoring, increasing difficulty, and restart flows.

[View demo →](https://www.eigent.ai/use-cases/build-10-cny-horse-themed-html5-games/video)

[View guide →](https://www.eigent.ai/use-cases/build-10-cny-horse-themed-html5-games)

#### [Build a 3D Snow Bros Platformer with Gemini 3.1 Pro](https://www.eigent.ai/use-cases/build-3d-snow-bros-platformer-gemini)

Create a complete browser-based 3D platformer with snowball combat, enemy chains, scoring, lives, scaling difficulty, and layered environments.

[View demo →](https://www.eigent.ai/use-cases/build-3d-snow-bros-platformer-gemini/video)

[View guide →](https://www.eigent.ai/use-cases/build-3d-snow-bros-platformer-gemini)

#### [Automate Monthly Dev Reports with DeepSeek via Ollama](https://www.eigent.ai/use-cases/monthly-dev-reports-automated-eigent-with-deepseek-v4-pro-via-ollama)

Review a month of GitHub pull requests with a locally hosted model, generate a Word summary, and prepare the corresponding Slack release update.

[View demo →](https://www.eigent.ai/use-cases/monthly-dev-reports-automated-eigent-with-deepseek-v4-pro-via-ollama/video)

[View guide →](https://www.eigent.ai/use-cases/monthly-dev-reports-automated-eigent-with-deepseek-v4-pro-via-ollama)

### Featured

#### [Organize Desktop Files](https://www.eigent.ai/use-cases/organize-desktop-files)

Ask Eigent to inspect a cluttered desktop and organize files into a cleaner, more useful structure directly on your machine.

[View demo →](https://www.eigent.ai/use-cases/organize-desktop-files/video)

[View guide →](https://www.eigent.ai/use-cases/organize-desktop-files)

#### [Audit ML CI Failures with Gemini 3.5 Flash on Eigent](https://www.eigent.ai/use-cases/eigent-gemini-managed-agents)

Orchestrate a multi-agent CI investigation that fetches logs, compares golden values, traces evidence, delegates deep reasoning, and produces structured audit reports.

[View demo →](https://www.eigent.ai/use-cases/eigent-gemini-managed-agents/video)

[View guide →](https://www.eigent.ai/use-cases/eigent-gemini-managed-agents)

#### [Ticket Management System Integration and Reporting](https://www.eigent.ai/use-cases/ticket-management-system-integration-and-reporting)

Import local ticket data into a browser-based management system, then generate a statistical report with charts and visual summaries.

[View demo →](https://www.eigent.ai/use-cases/ticket-management-system-integration-and-reporting/video)

[View guide →](https://www.eigent.ai/use-cases/ticket-management-system-integration-and-reporting)

[Explore more use cases →](https://www.eigent.ai/use-cases)

## 🛠️ Tech Stack

Eigent open-source Cowork desktop is built on modern, reliable technologies that ensure scalability, performance, and extensibility.

### Backend

- **Framework:** FastAPI
- **Package Manager:** uv
- **Async Server:** Uvicorn
- **Authentication:** OAuth 2.0, Passlib.
- **Multi-agent framework:** CAMEL

### Frontend

- **Framework:** React
- **Desktop App Framework:** Electron
- **Language:** TypeScript
- **UI:** Tailwind CSS, Radix UI, Lucide React, Framer Motion
- **State Management:** Zustand
- **Flow Editor:** React Flow

## 🌟 Staying ahead - Open Source Cowork

> [!IMPORTANT]
>
> **Star Eigent**, You will receive all release notifications from GitHub without any delay ~ ⭐️

![][image-star-us]

## 🗺️ Roadmap - Open Source Cowork

Our open-source Cowork continues to evolve with input from the community. Here's what's coming next:

| Topics                      | Issues                                                                                                                         | Discord Channel                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| **Context Engineering**     | - Prompt caching<br> - System prompt optimize<br> - Toolkit docstring optimize<br> - Context compression                       | [**Join Discord →**](https://discord.com/invite/CNcNpquyDc) |
| **Multi-modal Enhancement** | - More accurate image understanding when using browser<br> - Advanced video generation                                         | [**Join Discord →**](https://discord.com/invite/CNcNpquyDc) |
| **Multi-agent system**      | - Workforce support fixed workflow<br> - Workforce support multi-round conversion                                              | [**Join Discord →**](https://discord.com/invite/CNcNpquyDc) |
| **Browser Toolkit**         | - BrowseComp integration<br> - Benchmark improvement<br> - Forbid repeated page visiting<br> - Automatic cache button clicking | [**Join Discord →**](https://discord.com/invite/CNcNpquyDc) |
| **Document Toolkit**        | - Support dynamic file editing                                                                                                 | [**Join Discord →**](https://discord.com/invite/CNcNpquyDc) |
| **Terminal Toolkit**        | - Benchmark improvement<br> - Terminal-Bench integration                                                                       | [**Join Discord →**](https://discord.com/invite/CNcNpquyDc) |
| **Environment & RL**        | - Environment design<br> - Data-generation<br> - RL framework integration (VERL, TRL, OpenRLHF)                                | [**Join Discord →**](https://discord.com/invite/CNcNpquyDc) |

## [🤝 Contributing][contribution-link]

We believe in building trust and embracing all forms of open-source collaborations. Your creative contributions help drive the innovation of `Eigent`. Explore our GitHub issues and projects to dive in and show us what you’ve got 🤝❤️ [Contribution Guideline][contribution-link]

## Contributors

<a href="https://github.com/eigent-ai/eigent/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=eigent-ai/eigent" />
</a>

Made with [contrib.rocks](https://contrib.rocks).

<br>

## [❤️ Sponsor][sponsor-link]

Eigent is built on top of [CAMEL-AI.org][camel-ai-org-github]'s research and infrastructures. [Sponsoring CAMEL-AI.org][sponsor-link] will make `Eigent` better.

## **📄 Open Source License**

This repository is licensed under the [Apache License 2.0](LICENSE).

## 🌐 Community & Contact

For more information please contact info@eigent.ai

- **GitHub Issues:** Report bugs, request features, and track development. [Submit an issue][github-issue-link]

- **Discord:** Get real-time support, chat with the community, and stay updated. [Join us](https://discord.com/invite/CNcNpquyDc)

- **X (Twitter):** Follow for updates, AI insights, and key announcements. [Follow us][social-x-link]

- **WeChat Community:** Scan the QR code below to add our WeChat assistant, and join our WeChat community group.

<div align="center">
  <img src="./src/assets/wechat_qr.jpg" width="200" style="display: inline-block; margin: 10px;">
</div>

<!-- LINK GROUP -->

<!-- Social -->

<!-- camel & eigent -->

<!-- marketing -->

<!-- feature -->

[built-with-camel]: https://img.shields.io/badge/-Built--with--CAMEL-4C19E8.svg?logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQ4IiBoZWlnaHQ9IjI3MiIgdmlld0JveD0iMCAwIDI0OCAyNzIiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik04LjgzMTE3IDE4LjU4NjVMMCAzMC44MjY3QzUuNDY2OTIgMzUuMDQzMiAxNS4xMzkxIDM4LjgyNTggMjQuODExNCAzNi4yOTU5QzMwLjY5ODggNDAuOTM0MSAzOS42NzAyIDQwLjIzMTMgNDQuMTU1OSA0MC4wOTA4QzQzLjQ1NSA0Ny4zOTk0IDQyLjQ3MzcgNzAuOTU1OCA0NC4xNTU5IDEwNi43MTJDNDUuODM4IDE0Mi40NjggNzEuNzcwOCAxNjYuODY4IDg0LjUyNjkgMTc0LjU5OEw3Ni4wMDAyIDIyMEw4NC41MjY5IDI3MkgxMDguOTE4TDk4LjAwMDIgMjIwTDEwOC45MTggMTc0LjU5OEwxMjkuOTQ0IDI3MkgxNTQuNzU2TDEzNC4xNSAxNzQuNTk4SDE4Ny4xMzdMMTY2LjUzMSAyNzJIMTkxLjc2M0wyMTIuMzY5IDE3NC41OThMMjI2IDIyMEwyMTIuMzY5IDI3MkgyMzcuNjAxTDI0OC4wMDEgMjIwTDIzNy4xOCAxNzQuNTk4QzIzOS4yODMgMTY5LjExNyAyNDAuNDAxIDE2Ni45NzYgMjQxLjgwNiAxNjEuMTA1QzI0OS4zNzUgMTI5LjQ4MSAyMzUuMDc3IDEwMy45MDEgMjI2LjY2NyA5NC40ODRMMjA2LjQ4MSA3My44MjNDMTk3LjY1IDY0Ljk2ODMgMTgyLjUxMSA2NC41NDY3IDE3Mi44MzkgNzIuNTU4MUMxNjUuNzI4IDc4LjQ0NzcgMTYxLjcwMSA3OC43NzI3IDE1NC43NTYgNzIuNTU4MUMxNTEuODEyIDcwLjAyODEgMTQ0LjUzNSA2MS40ODg5IDEzNC45OTEgNTMuNTgzN0MxMjUuMzE5IDQ1LjU3MjMgMTA4LjQ5NyA0OC45NDU1IDEwMi4xODkgNTUuNjkxOUw3My41OTMxIDg0LjM2NDRWNy42MjM0OUw3OS4xMjczIDBDNjAuOTA0MiAzLjY1NDMzIDIzLjgwMjEgOS41NjMwOSAxOS43NjUgMTAuNTc1MUMxNS43Mjc5IDExLjU4NyAxMC43OTM3IDE2LjMzNzcgOC44MzExNyAxOC41ODY1WiIgZmlsbD0id2hpdGUiLz4KPHBhdGggZD0iTTQzLjIwMzggMTguNzE4N0w0OS4wOTEyIDEzLjA0OTNMNTQuOTc4NyAxOC43MTg3TDQ5LjA5MTIgMjQuODI0Mkw0My4yMDM4IDE4LjcxODdaIiBmaWxsPSIjNEMxOUU4Ii8+Cjwvc3ZnPgo=
[camel-ai-org-github]: https://github.com/camel-ai
[camel-github]: https://github.com/camel-ai/camel
[camel-site]: https://www.camel-ai.org
[contribution-link]: https://github.com/eigent-ai/eigent/blob/main/CONTRIBUTING.md
[discord-image]: https://img.shields.io/discord/1082486657678311454?logo=discord&labelColor=%20%235462eb&logoColor=%20%23f5f5f5&color=%20%235462eb
[discord-url]: https://discord.com/invite/CNcNpquyDc
[docs-site]: https://docs.eigent.ai
[download-shield]: https://img.shields.io/badge/Download%20Eigent-363AF5?style=plastic
[eigent-download]: https://www.eigent.ai/download
[eigent-github]: https://github.com/eigent-ai/eigent
[eigent-site]: https://www.eigent.ai
[github-issue-link]: https://github.com/eigent-ai/eigent/issues
[github-star]: https://img.shields.io/github/stars/eigent-ai?color=F5F4F0&labelColor=gray&style=plastic&logo=github
[image-head]: https://eigent-ai.github.io/.github/assets/head.png
[image-join-us]: https://camel-ai.github.io/camel_asset/graphics/join_us.png
[image-opensource]: https://eigent-ai.github.io/.github/assets/opensource.png
[image-public-beta]: https://eigent-ai.github.io/.github/assets/banner.png
[image-seperator]: https://eigent-ai.github.io/.github/assets/seperator.png
[image-star-us]: https://eigent-ai.github.io/.github/assets/star-us.gif
[join-us]: https://www.eigent.ai/careers
[join-us-image]: https://img.shields.io/badge/Join%20Us-yellow?style=plastic
[reddit-image]: https://img.shields.io/reddit/subreddit-subscribers/CamelAI?style=plastic&logo=reddit&label=r%2FCAMEL&labelColor=white
[reddit-url]: https://www.reddit.com/r/CamelAI/
[social-x-link]: https://x.com/Eigent_AI
[social-x-shield]: https://img.shields.io/badge/-%40Eigent_AI-white?labelColor=gray&logo=x&logoColor=white&style=plastic
[sponsor-link]: https://github.com/sponsors/camel-ai
[sponsor-shield]: https://img.shields.io/badge/-Sponsor%20CAMEL--AI-1d1d1d?logo=github&logoColor=white&style=plastic
[wechat-image]: https://img.shields.io/badge/WeChat-CamelAIOrg-brightgreen?logo=wechat&logoColor=white
[wechat-url]: https://ghli.org/camel/wechat.png
