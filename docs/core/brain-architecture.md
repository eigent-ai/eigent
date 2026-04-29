---
title: Brain Architecture
description: Understand how Eigent separates clients, Brain, and runtime capabilities across desktop and web deployments.
icon: brain
---

## Overview

Eigent is evolving toward a Brain-centered architecture.

Instead of treating the desktop app as the system boundary, Eigent treats the Brain as the primary runtime. Clients such as Desktop and Web connect to the same Brain over HTTP and SSE, while runtime capabilities are determined by where the Brain is deployed.

This shift makes it easier to:

- support both Desktop and Web as first-class clients
- run Brain independently from Electron
- keep capability boundaries consistent across local and remote deployments
- prepare for future CLI, channel, and remote resource integrations

## Core Building Blocks

### Brain

The Brain is the central runtime for Eigent. It is responsible for:

- task and chat orchestration
- agent and workforce coordination
- file, tool, MCP, and skill APIs
- session-aware request handling
- runtime capability resolution

In practice, the Brain is the part of the system that reasons, routes work, and executes actions through the available runtime capabilities.

### Clients

Eigent supports multiple client shapes around the same Brain:

- Desktop
- Web
- future CLI and channel-based clients

Clients are responsible for presentation and interaction. They do not define what the system is allowed to do. They only define how users connect to and interact with the Brain.

### Hands

Hands represent what the Brain can actually operate in its current environment.

Examples include:

- terminal execution
- browser control
- filesystem access
- MCP usage

This is an important architectural choice: Hands are determined by the Brain deployment environment, not by the client type.

That means a Web client connected to a full local or VM-hosted Brain can still access browser and terminal capabilities, while a client connected to a restricted Brain will see a reduced capability set.

### Host

For Desktop, Electron acts as a host layer. It provides native integrations such as:

- window controls
- file picking
- CDP and webview-related integrations
- backend lifecycle support

The host is intentionally kept separate from Brain logic so shared frontend code can work across Desktop and Web.

## High-Level Architecture

```text
Clients
  ├─ Desktop
  ├─ Web
  └─ Future CLI / Channels
            │
            │ HTTP / SSE
            ▼
          Brain
            ├─ Router layer
            ├─ Chat / Task / Tool / File APIs
            ├─ MCP / Skills services
            └─ Hands
                ├─ terminal
                ├─ browser
                ├─ filesystem
                └─ MCP
```

## Request Flow

### Desktop

In Desktop mode, Electron starts and hosts the local Brain. The frontend resolves the local Brain endpoint through the host layer, then uses shared Brain HTTP and SSE APIs for most business flows.

### Web

In Web mode, the frontend connects directly to a Brain endpoint. Session metadata is carried through headers, file attachments are uploaded through Brain APIs, and task streaming uses shared SSE transport.

This makes Web a first-class entry point instead of a limited fallback path.

## Why Hands Are Environment-Driven

A common pitfall in multi-client systems is tying capability boundaries to the client type.

Eigent avoids that by separating:

- **channel**: how a client connects and how responses should be adapted
- **hands**: what the Brain can actually do in its runtime environment

This enables a cleaner model:

- Desktop does not automatically mean full capability
- Web does not automatically mean restricted capability
- the Brain environment remains the source of truth for runtime power

## Deployment Modes

The architecture supports multiple deployment shapes:

- **Desktop + Local Brain**
  - best for local development and full machine access
- **Web + Local Brain**
  - useful for frontend/backend separation and local web usage
- **Web + Cloud or VM Brain**
  - allows browser-based access to a remotely hosted Brain
- **Brain + Remote resource pools**
  - enables future remote browser or terminal acquisition patterns

## What This Architecture Enables

This architecture lays the foundation for:

- stronger separation between UI and runtime
- better Web support without breaking Desktop
- clearer capability modeling
- future remote execution and multi-client expansion

It also reduces the amount of client-specific branching required in the product by moving more system behavior into shared Brain-side abstractions.

## Current Direction

The architecture is being rolled out incrementally. Desktop remains supported while Web and standalone Brain flows are being strengthened around the same core abstractions.

That incremental approach helps Eigent evolve toward a more portable and extensible system without requiring a full rewrite.
