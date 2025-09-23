<div align="center"><a name="readme-top"></a>

[![][image-head]][eigent-site]

[![][image-seperator]][eigent-site]

### Eigent: The World's First Multi-agent Workforce to Unlock Your Exceptional Productivity

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

**English** · [简体中文](./README_CN.md) · [Official Site][eigent-site] · [Documents][docs-site] · [Feedback][github-issue-link]

</div>
<br/>

**Eigent** is the world’s first **Multi-agent Workforce** desktop application, empowering you to build, manage, and deploy a custom AI workforce that can turn your most complex workflows into automated tasks. 

Built on [CAMEL-AI][camel-site]'s acclaimed open-source project, our system introduces a **Multi-Agent Workforce** that **boosts productivity** through parallel execution, customization, and privacy protection.

### ⭐ 100% Open Source - 🥇 Local Deployment - 🏆 MCP Integration

- ✅ **Zero Setup** - No technical configuration required
- ✅ **Multi-Agent Coordination** - Handle complex multi-agent workflows
- ✅ **Enterprise Feature** - SSO/Access control
- ✅ **Local Deploymen**t
- ✅ **Open Source**
- ✅ **Custom Model Support**
- ✅ **MCP Integration**

<br/>

[![][image-join-us]][join-us]

<details>
<summary><kbd>Table of contents</kbd></summary>

#### TOC

- [🚀 Getting Started](#-getting-started)
  - [☁️ Cloud Version](#️-cloud-version)
  - [🏠 Self-Hosting (Community Edition)](#-self-hosting-community-edition)
  - [🏢 Enterprise](#-enterprise)
- [✨ Key features](#-key-features)
  - [🏭 Workforce](#-workforce)
  - [🧠 Comprehensive Model Support](#-comprehensive-model-support)
  - [🔌 MCP Tools Integration (MCP)](#-mcp-tools-integration-mcp)
  - [✋ Human-in-the-Loop](#-human-in-the-loop)
  - [👐 100% Open Source](#-100-open-source)
- [🧩 Use Cases](#-use-cases)
- [🛠️ Tech Stack](#-tech-stack)
  - [Backend](#backend)
  - [Frontend](#frontend)
- [🌟 Staying ahead](#staying-ahead)
- [🗺️ Roadmap](#-roadmap)
- [📖 Contributing](#-contributing)
  - [Main Contributors](#main-contributors)
  - [Distinguished amabssador](#distinguished-amabssador)
- [Ecosystem](#ecosystem)
- [📄 Open Source License](#-open-source-license)
- [🌐 Community & contact](#-community--contact)

####

<br/>

</details>

## **🚀 Getting Started**

There are three ways to get started with Eigent:

### ☁️ Cloud Version

The fastest way to experience Eigent's multi-agent AI capabilities is through our cloud platform, perfect for teams and individuals who want immediate access without setup complexity. We'll host the models, APIs, and cloud storage, ensuring Eigent runs flawlessly.

- **Instant Access** - Start building multi-agent workflows in minutes.
- **Managed Infrastructure** - We handle scaling, updates, and maintenance.
- **Premium Support** - Subscribe and get priority assistance from our engineering team.

<br/>

[![image-public-beta]][eigent-download]

<div align="right">
<a href="https://www.eigent.ai/download">Get started at Eigent.ai →</a>
</div>

### 🏠 Self-Hosting (Community Edition)

For users who prefer local control, data privacy, or customization, this option is ideal for organizations requiring:

- **Data Privacy** - Keep sensitive data within your infrastructure.
- **Customization** - Modify and extend the platform to fit your needs.
- **Cost Control** - Avoid recurring cloud fees for large-scale deployments.

#### 1. Prerequisites

- Node.js (version 18-22) and npm

#### 2. Quick Start

```bash
git clone https://github.com/eigent-ai/eigent.git
cd eigent
npm install
npm run dev
```

#### 3. Local Development (Use the version that is completely separated from the cloud service)
[server/README_EN.md](./server/README_EN.md)

### 🏢 Enterprise

For organizations requiring maximum security, customization, and control:

- **Commercial License** - [Check our license →](LICENSE)
- **Exclusive Features** (like SSO & custom development)
- **Scalable Enterprise Deployment**
- **Negotiated SLAs** & implementation services

📧 For further details, please contact us at [info@eigent.ai](mailto:info@eigent.ai).

## **✨ Key features**
Unlock the full potential of exceptional productivity with Eigent’s powerful features—built for seamless integration, smarter task execution, and boundless automation.

### 🏭 Workforce 
Employs a team of specialized AI agents that collaborate to solve complex tasks. Eigent dynamically breaks down tasks and activates multiple agents to work **in parallel.**

Eigent pre-defined the following agent workers:

- **Developer Agent:** Writes and executes code, runs terminal commands.
- **Search Agent:** Searches the web and extracts content.
- **Document Agent:** Creates and manages documents.
- **Multi-Modal Agent:** Processes images and audio.

![Workforce](https://eigent-ai.github.io/.github/assets/gif/feature_dynamic_workforce.gif)

<br/>

### 🧠 Comprehensive Model Support
Deploy Eigent locally with your preferred models. 

![Model](https://eigent-ai.github.io/.github/assets/gif/feature_local_model.gif)

<br/>

### 🔌 MCP Tools Integration (MCP)
Eigent comes with massive built-in **Model Context Protocol (MCP)** tools (for web browsing, code execution, Notion, Google suite, Slack etc.), and also lets you **install your own tools**. Equip agents with exactly the right tools for your scenarios – even integrate internal APIs or custom functions – to enhance their capabilities.

![MCP](https://eigent-ai.github.io/.github/assets/gif/feature_add_mcps.gif)

<br/>

### ✋ Human-in-the-Loop
If a task gets stuck or encounters uncertainty, Eigent will automatically request human input. 

![Human-in-the-loop](https://eigent-ai.github.io/.github/assets/gif/feature_human_in_the_loop.gif)

<br/>

### 👐 100% Open Source
Eigent is completely open-sourced. You can download, inspect, and modify the code, ensuring transparency and fostering a community-driven ecosystem for multi-agent innovation.

![Opensource][image-opensource]

<br/>

## 🧩 Use Cases

### 1. Palm Springs Tennis Trip Itinerary with Slack Summary [Replay ▶️](https://www.eigent.ai/download?share_token=IjE3NTM0MzUxNTEzMzctNzExMyI.aIeysw.MUeG6ZcBxI1GqvPDvn4dcv-CDWw__1753435151337-7113)

<details>
<summary><strong>Prompt:</strong> <kbd>We are two tennis fans and want to go see the tennis tournament ... <kbd></summary>
<br>
We are two tennis fans and want to go see the tennis tournament in Palm Springs 2026. I live in SF - please prepare a detailed itinerary with flights, hotels, things to do for 3 days - around the time semifinal/finals are happening. We like hiking, vegan food and spas. Our budget is $5K. The itinerary should be a detailed timeline of time, activity, cost, other details and if applicable a link to buy tickets/make reservations etc. for the item. Some preferences .Spa access would be nice but not necessary. When you finish this task, please generate a html report about this trip; write a summary of this plan and send text summary and report html link to slack #tennis-trip-sf channel.
</details>

<br>

### 2. Generate Q2 Report from CSV Bank Data [Replay ▶️](https://www.eigent.ai/download?share_token=IjE3NTM1MjY4OTE4MDgtODczOSI.aIjJmQ.WTdoX9mATwrcBr_w53BmGEHPo8U__1753526891808-8739)

<details>
<summary><strong>Prompt:</strong> <kbd>Please help me prepare a Q2 financial statement based on my bank ... <kbd></summary>
<br>
Please help me prepare a Q2 financial statement based on my bank transfer record file bank_transacation.csv in my desktop to a html report with chart to investors how much we have spent.
</details>

<br>

### 3. UK Healthcare Market Research Report Automation [Replay ▶️](https://www.eigent.ai/download?share_token=IjE3NTMzOTM1NTg3OTctODcwNyI.aIey-Q.Jh9QXzYrRYarY0kz_qsgoj3ewX0__1753393558797-8707)

<details>
<summary><strong>Prompt:</strong> <kbd>Analyze the UK healthcare industry to support the planning ... <kbd></summary>
<br>
Analyze the UK healthcare industry to support the planning of my next company. Provide a comprehensive market overview, including current trends, growth projections, and relevant regulations. Identify the top 5–10 major opportunities, gaps, or underserved segments within the market. Present all findings in a well-structured, professional HTML report. Then send a message to slack #eigentr-product-test channel when this task is done to align the report content with my teammates.
</details>

<br>

### 4. German Electric Skateboard Market Feasibility [Replay ▶️](https://www.eigent.ai/download?share_token=IjE3NTM2NTI4MjY3ODctNjk2Ig.aIjGiA.t-qIXxk_BZ4ENqa-yVIm0wMVyXU__1753652826787-696)

<details>
<summary><strong>Prompt:</strong> <kbd>We are a company that produces high-end electric skateboards ... <kbd></summary>
<br>
We are a company that produces high-end electric skateboards, and we are considering entering the German market. Please prepare a detailed market entry feasibility report for me. The report needs to cover the following aspects:
1. Market Size & Regulations: Research the market size, annual growth rate, key players, and market share for Personal Light Electric Vehicles (PLEVs) in Germany. Simultaneously, provide a detailed breakdown and summary of German laws and regulations concerning the use of electric skateboards on public roads, including certification requirements (such as ABE certification) and insurance policies.
2. Consumer Profile: Analyze the profile of potential German consumers, including their age, income level, primary usage scenarios (commuting, recreation), key purchasing decision drivers (price, performance, brand, design), and the channels they typically use to gather information (forums, social media, offline retail stores).
3. Channels & Distribution: Investigate Germany’s mainstream online electronics sales platforms (e.g., Amazon.de, MediaMarkt.de) and high-end sporting goods offline retail chains. List the top 5 potential online and offline distribution partners and find the contact information for their purchasing departments, if possible.
4. Costing & Pricing: Based on the product cost structure in my Product_Cost.csv file on my desktop, and taking into account German customs duties, Value Added Tax (VAT), logistics and warehousing costs, and potential marketing expenses, estimate a Manufacturer’s Suggested Retail Price (MSRP) and analyze its competitiveness in the market.
5. Comprehensive Report & Presentation: Summarize all research findings into an HTML report file. The content should include data charts, key findings, and a final market entry strategy recommendation (Recommended / Not Recommended / Recommended with Conditions).
</details>

<br>

### 5. SEO Audit for Workforce Multiagent Launch [Replay ▶️](https://www.eigent.ai/download?share_token=IjE3NTM2OTk5NzExNDQtNTY5NiI.aIex0w.jc_NIPmfIf9e3zGt-oG9fbMi3K4__1753699971144-5696)

<details>
<summary><strong>Prompt:</strong> <kbd>To support the launch of our new Workforce Multiagent product ... <kbd></summary>
<br>
To support the launch of our new Workforce Multiagent product, please run a thorough SEO audit on our official website (https://www.camel-ai.org/) and deliver a detailed optimization report with actionable recommendations.
</details>

<br>

### 6. Identify Duplicate Files in Downloads [Replay ▶️](https://www.eigent.ai/download?share_token=IjE3NTM3NjAzODgxNzEtMjQ4Ig.aIhKLQ.epOG--0Nj0o4Bqjtdqm9OZdaqRQ__1753760388171-248)

<details>
<summary><strong>Prompt:</strong> <kbd>I have a folder named mydocs inside my Documents directory ... <kbd></summary>
<br>
I have a folder named mydocs inside my Documents directory. Please scan it and identify all files that are exact or near duplicates — including those with identical content, file size, or format (even if file names or extensions differ). List them clearly, grouped by similarity.
</details>

<br>

### 7. Add Signature to PDF [Replay ▶️](https://www.eigent.ai/download?share_token=IjE3NTQwOTU0ODM0NTItNTY2MSI.aJCHrA.Mg5yPOFqj86H_GQvvRNditzepXc__1754095483452-5661)

<details>
<summary><strong>Prompt:</strong> <kbd>Please add this signature image to the Signature Areas in the PDF ... <kbd></summary>
<br>
Please add this signature image to the Signature Areas in the PDF. You could install the CLI tool ‘tesseract’ (needed for reliable location of ‘Signature Areas’ via OCR) to help finish this task.
</details>

<br>

## 🛠️ Tech Stack

### Backend
- **Framework:** FastAPI
- **Package Manager:** uv
- **Async Server:** Uvicorn
- **Authentication:** OAuth 2.0,  Passlib.
- **Multi-agent framework:** CAMEL
    
### Frontend

- **Framework:** React
- **Desktop App Framework:** Electron
- **Language:** TypeScript
- **UI:** Tailwind CSS, Radix UI, Lucide React, Framer Motion
- **State Management:** Zustand
- **Flow Editor:** React Flow

## 🌟 Staying ahead

> \[!IMPORTANT]
>
> **Star Eigent**, You will receive all release notifications from GitHub without any delay \~ ⭐️

![][image-star-us]

## 🗺️ Roadmap

| Topics                   | Issues   | Discord Channel |
| ------------------------ | -- |-- |
| **Context Engineering** | - Prompt caching<br> - System prompt optimize<br> - Toolkit docstring optimize<br> - Context compression | [**Join Discord →**](https://discord.gg/D2e3rBWD) |
| **Multi-modal Enhancement** | - More accurate image understanding when using browser<br> - Advanced video generation | [**Join Discord →**](https://discord.gg/kyapNCeJ) |
| **Multi-agent system** | - Workforce support fixed workflow<br> - Workforce support multi-round conversion | [**Join Discord →**](https://discord.gg/bFRmPuDB) |
| **Browser Toolkit** | - BrowseCamp integration<br> - Benchmark improvement<br> - Forbid repeated page visiting<br> - Automatic cache button clicking | [**Join Discord →**](https://discord.gg/NF73ze5v) |
| **Document Toolkit** | - Support dynamic file editing | [**Join Discord →**](https://discord.gg/4yAWJxYr) |
| **Terminal Toolkit** | - Benchmark improvement<br> - Terminal-Bench integration | [**Join Discord →**](https://discord.gg/FjQfnsrV) |
| **Environment & RL** | - Environment design<br> - Data-generation<br> - RL framework integration (VERL, TRL, OpenRLHF) | [**Join Discord →**](https://discord.gg/MaVZXEn8) |


## [🤝 Contributing][contribution-link]

We believe in building trust and embracing all forms of open-source collaborations. Your creative contributions help drive the innovation of `Eigent`. Explore our GitHub issues and projects to dive in and show us what you’ve got 🤝❤️ [Contribution Guideline][contribution-link]

## [❤️ Sponsor][sponsor-link]

Eigent is built on top of [CAMEL-AI.org][camel-ai-org-github]'s research and infrastructures. [Sponsoring CAMEL-AI.org][sponsor-link] will make `Eigent` better.

## **📄 Open Source License**

This repository is licensed under the [**Eigent Open Source License**](LICENSE), based on Apache 2.0 with additional conditions.

## 🌐 Community & Contact
For more information please contact info@eigent.ai

- **GitHub Issues:** Report bugs, request features, and track development. [Submit an issue][github-issue-link]

- **Discord:** Get real-time support, chat with the community, and stay updated. [Join us](https://discord.camel-ai.org/)

- **X (Twitter):** Follow for updates, AI insights, and key announcements. [Follow us][social-x-link]

- **WeChat Community:** Scan the QR codes below to join our WeChat community groups.

<div align="center">
  <img src="./src/assets/wechat_qr_1.jpg" width="200" style="display: inline-block; margin: 10px;">
  <img src="./src/assets/wechat_qr_2.jpg" width="200" style="display: inline-block; margin: 10px;">
  <img src="./src/assets/wechat_qr_3.jpg" width="200" style="display: inline-block; margin: 10px;">
  <img src="./src/assets/wechat_qr_4.jpg" width="200" style="display: inline-block; margin: 10px;">
</div>



<!-- LINK GROUP -->
<!-- Social -->
[discord-url]: https://discord.camel-ai.org/
[discord-image]: https://img.shields.io/discord/1082486657678311454?logo=discord&labelColor=%20%235462eb&logoColor=%20%23f5f5f5&color=%20%235462eb

[built-with-camel]:https://img.shields.io/badge/-Built--with--CAMEL-4C19E8.svg?logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQ4IiBoZWlnaHQ9IjI3MiIgdmlld0JveD0iMCAwIDI0OCAyNzIiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik04LjgzMTE3IDE4LjU4NjVMMCAzMC44MjY3QzUuNDY2OTIgMzUuMDQzMiAxNS4xMzkxIDM4LjgyNTggMjQuODExNCAzNi4yOTU5QzMwLjY5ODggNDAuOTM0MSAzOS42NzAyIDQwLjIzMTMgNDQuMTU1OSA0MC4wOTA4QzQzLjQ1NSA0Ny4zOTk0IDQyLjQ3MzcgNzAuOTU1OCA0NC4xNTU5IDEwNi43MTJDNDUuODM4IDE0Mi40NjggNzEuNzcwOCAxNjYuODY4IDg0LjUyNjkgMTc0LjU5OEw3Ni4wMDAyIDIyMEw4NC41MjY5IDI3MkgxMDguOTE4TDk4LjAwMDIgMjIwTDEwOC45MTggMTc0LjU5OEwxMjkuOTQ0IDI3MkgxNTQuNzU2TDEzNC4xNSAxNzQuNTk4SDE4Ny4xMzdMMTY2LjUzMSAyNzJIMTkxLjc2M0wyMTIuMzY5IDE3NC41OThMMjI2IDIyMEwyMTIuMzY5IDI3MkgyMzcuNjAxTDI0OC4wMDEgMjIwTDIzNy4xOCAxNzQuNTk4QzIzOS4yODMgMTY5LjExNyAyNDAuNDAxIDE2Ni45NzYgMjQxLjgwNiAxNjEuMTA1QzI0OS4zNzUgMTI5LjQ4MSAyMzUuMDc3IDEwMy45MDEgMjI2LjY2NyA5NC40ODRMMjA2LjQ4MSA3My44MjNDMTk3LjY1IDY0Ljk2ODMgMTgyLjUxMSA2NC41NDY3IDE3Mi44MzkgNzIuNTU4MUMxNjUuNzI4IDc4LjQ0NzcgMTYxLjcwMSA3OC43NzI3IDE1NC43NTYgNzIuNTU4MUMxNTEuODEyIDcwLjAyODEgMTQ0LjUzNSA2MS40ODg5IDEzNC45OTEgNTMuNTgzN0MxMjUuMzE5IDQ1LjU3MjMgMTA4LjQ5NyA0OC45NDU1IDEwMi4xODkgNTUuNjkxOUw3My41OTMxIDg0LjM2NDRWNy42MjM0OUw3OS4xMjczIDBDNjAuOTA0MiAzLjY1NDMzIDIzLjgwMjEgOS41NjMwOSAxOS43NjUgMTAuNTc1MUMxNS43Mjc5IDExLjU4NyAxMC43OTM3IDE2LjMzNzcgOC44MzExNyAxOC41ODY1WiIgZmlsbD0id2hpdGUiLz4KPHBhdGggZD0iTTQzLjIwMzggMTguNzE4N0w0OS4wOTEyIDEzLjA0OTNMNTQuOTc4NyAxOC43MTg3TDQ5LjA5MTIgMjQuODI0Mkw0My4yMDM4IDE4LjcxODdaIiBmaWxsPSIjNEMxOUU4Ii8+Cjwvc3ZnPgo=

[eigent-github]: https://github.com/eigent-ai/eigent
[github-star]: https://img.shields.io/github/stars/eigent-ai?color=F5F4F0&labelColor=gray&style=plastic&logo=github
[camel-ai-org-github]: https://github.com/camel-ai

[camel-github]: https://github.com/camel-ai/camel
[eigent-github]: https://github.com/eigent-ai/eigent
[contribution-link]: https://github.com/eigent-ai/eigent/blob/main/CONTRIBUTING.md

[social-x-link]: https://x.com/Eigent_AI
[social-x-shield]: https://img.shields.io/badge/-%40Eigent_AI-white?labelColor=gray&logo=x&logoColor=white&style=plastic

[reddit-url]: https://www.reddit.com/r/CamelAI/
[reddit-image]: https://img.shields.io/reddit/subreddit-subscribers/CamelAI?style=plastic&logo=reddit&label=r%2FCAMEL&labelColor=white

[wechat-url]: https://ghli.org/camel/wechat.png
[wechat-image]: https://img.shields.io/badge/WeChat-CamelAIOrg-brightgreen?logo=wechat&logoColor=white

[sponsor-link]: https://github.com/sponsors/camel-ai
[sponsor-shield]: https://img.shields.io/badge/-Sponsor%20CAMEL--AI-1d1d1d?logo=github&logoColor=white&style=plastic

[eigent-download]: https://www.eigent.ai/download
[download-shield]: https://img.shields.io/badge/Download%20Eigent-363AF5?style=plastic

[join-us]:https://eigent-ai.notion.site/eigent-ai-careers
[join-us-image]:https://img.shields.io/badge/Join%20Us-yellow?style=plastic

<!-- camel & eigent -->
[camel-site]: https://www.camel-ai.org
[eigent-site]: https://www.eigent.ai
[docs-site]: https://docs.eigent.ai
[github-issue-link]: https://github.com/eigent-ai/eigent/issues

<!-- marketing -->
[image-seperator]: https://eigent-ai.github.io/.github/assets/seperator.png 
[image-head]: https://eigent-ai.github.io/.github/assets/head.png 
[image-public-beta]: https://eigent-ai.github.io/.github/assets/banner.png
[image-star-us]: https://eigent-ai.github.io/.github/assets/star-us.gif
[image-opensource]: https://eigent-ai.github.io/.github/assets/opensource.png
[image-wechat]: https://eigent-ai.github.io/.github/assets/wechat.png
[image-join-us]: https://camel-ai.github.io/camel_asset/graphics/join_us.png

<!-- feature -->
[image-workforce]: https://eigent-ai.github.io/.github/assets/feature_dynamic_workforce.gif
[image-human-in-the-loop]: https://eigent-ai.github.io/.github/assets/feature_human_in_the_loop.gif
[image-customise-workers]: https://eigent-ai.github.io/.github/assets/feature_customise_workers.gif
[image-add-mcps]: https://eigent-ai.github.io/.github/assets/feature_add_mcps.gif
[image-local-model]: https://eigent-ai.github.io/.github/assets/feature_local_model.gif
