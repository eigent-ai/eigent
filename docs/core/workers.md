---
title: Workers
description: Understand how to create and equip a custom worker.
icon: bot
---

Eigent is designed to be extensible. Beyond the pre-configured agents, you can significantly expand your workforce's capabilities by connecting to external tools via custom MCP Servers and creating specialized workers to use them.

This guide will walk you through how to integrate a new tool and build a custom worker step-by-step.

## Configuring a Custom MCP Server

The Model Context Protocol (MCP) is the framework that allows Eigent to connect to external tools and services like GitHub, Notion, or any other API. By adding a custom MCP server, you are essentially teaching your workforce a new skill.

- Step 1: Click the **Settings** gear icon → Select the **MCP and Tools** tab.
- Step 2: Click the **+ Add MCP Server** button to open the configuration dialog.
- Step 3: Provide the Server Configuration
    - **Paste the JSON configuration** for the server. This JSON file acts as a manifest, telling Eigent what the tool is, what functions it has, and how to call them. You can typically find this configuration file in the documentation of the third-party tool you wish to integrate.
    - **Add required credentials**. Many tools require authentication. For example, to connect to GitHub, you will need to generate a Personal Access Token from your GitHub account settings and paste it into the appropriate field.

<aside>


📌 **Note on Security**

Always treat your API keys and access tokens like passwords. Eigent stores them securely, but you should ensure they are generated with the minimum required permissions for the tasks you want to perform.

</aside>

![add mcp servers.gif](/docs/images/add_mcp_servers.gif)

## Creating and Equipping a Custom Worker

Once you've configured a new MCP server, you need to create a worker that knows how to use it. A worker is your specialized agent, and you can equip it with any combination of tools.

- Step 1: On the **Canvas**, click the **+ Add Worker** button located in the bottom toolbar.
- Step 2: Enter a clear Worker **Name** (e.g., "GitHub Specialist") and provide an optional **Description** of its duties (e.g., "Manages pull requests and repository issues").
- Step 3: Equip your Worker with the new tool (most important!)
    - Click on the **Agent Tool** dropdown menu.
    - Select the custom MCP server you just configured (e.g., Github MCP). You can also add any other tools you want this worker to have.
    - Click **Save**.

![add worker.gif](/docs/images/add_worker.gif)

## What’s next?

That's it! You have successfully extended your AI workforce. You can now assign tasks that leverage your new integration.