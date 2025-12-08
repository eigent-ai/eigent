# Feature Test TODO

## Overview

This document tracks the feature tests needed to cover core user journeys. Feature tests validate complete user scenarios rather than implementation details, providing high ROI with fewer tests.

---

## P0 - Critical User Flows

Must be covered. These are the core paths every user takes.

| # | Feature | User Journey | Key Files |
|---|---------|--------------|-----------|
| 1 | **Login Flow** | User enters email/password → Validates credentials → Redirects to home → Displays user info | `Login.tsx`, `authStore.ts` |
| 2 | **Sign Up Flow** | User fills registration form → Creates account → Auto-login → Redirects to home | `SignUp.tsx`, `authStore.ts` |
| 3 | **Send Message Flow** | User types message → Clicks send → User message appears → AI response streams in → Task completes | `ChatBox/`, `chatStore.ts` |
| 4 | **Task Confirmation Flow** | System splits task → Shows subtasks → User confirms/edits → Execution begins | `ChatBox/`, `chatStore.ts` |

**Status:**
- [ ] Login Flow
- [ ] Sign Up Flow
- [x] Send Message Flow (partial - `SendFirstMessage.feature.test.tsx`)
- [x] Task Confirmation Flow (partial - `SendFirstMessage.feature.test.tsx`)

---

## P1 - Important Features

Should be covered. These represent major user interactions.

| # | Feature | User Journey | Key Files |
|---|---------|--------------|-----------|
| 5 | **Project Switching** | User creates new project → Switches between projects → Messages remain independent | `projectStore.ts`, `HistorySidebar/` |
| 6 | **History Replay** | User opens history → Switches view mode → Selects past project → Replays conversation | `History.tsx`, `projectStore.ts` |
| 7 | **Model Switching** | User switches between Cloud/Custom API/Local modes → Configuration takes effect | `Setting/Models.tsx`, `authStore.ts` |
| 8 | **API Key Configuration** | User enters API key → Saves → Key is validated and persisted | `Setting/API.tsx`, `authStore.ts` |
| 9 | **File Attachment** | User clicks attach → Selects file → File appears in input → Sends with message | `ChatBox/BottomBox/` |

**Status:**
- [ ] Project Switching
- [ ] History Replay
- [ ] Model Switching
- [ ] API Key Configuration
- [ ] File Attachment

---

## P2 - Secondary Features

Nice to have. These cover less frequent but still important scenarios.

| # | Feature | User Journey | Key Files |
|---|---------|--------------|-----------|
| 10 | **Agent Q&A Interaction** | Agent asks question → User replies → Execution continues | `ChatBox/`, `chatStore.ts` |
| 11 | **Task Pause/Resume** | User pauses running task → Status shows paused → User resumes → Execution continues | `ChatBox/`, `chatStore.ts` |
| 12 | **MCP Server Config** | User adds MCP server → Server appears in list → User can delete it | `Setting/MCP.tsx` |
| 13 | **Worker Management** | User views worker list → Configures worker settings | `Dashboard/Worker.tsx` |
| 14 | **Language/Theme Toggle** | User switches language → UI updates / User switches theme → Styles update | `Setting/General.tsx` |

**Status:**
- [ ] Agent Q&A Interaction
- [ ] Task Pause/Resume
- [ ] MCP Server Config
- [ ] Worker Management
- [ ] Language/Theme Toggle

---

## P3 - Edge Cases

Optional. Cover these as time permits.

| # | Feature | User Journey | Key Files |
|---|---------|--------------|-----------|
| 15 | **Network Disconnect** | Network drops → Error message shown → Reconnects → Resumes normally | Global |
| 16 | **Token Expiration** | Token expires → Prompts re-login → Redirects to login page | `authStore.ts` |
| 17 | **Budget Exhausted** | `budget_not_enough` event → Shows warning → Guides user to top up | `chatStore.ts` |
| 18 | **Browser Snapshot View** | Task generates snapshot → User clicks to view → Snapshot content displayed | `ChatBox/` |
| 19 | **Generated File Download** | Task generates files → File list shown → User clicks to download | `ChatBox/` |

**Status:**
- [ ] Network Disconnect
- [ ] Token Expiration
- [ ] Budget Exhausted
- [ ] Browser Snapshot View
- [ ] Generated File Download

---

## Minimum Viable Test Set

If resources are extremely limited, prioritize these 4 tests for ~60% core path coverage:

1. **Login Flow** - Entry point for all users
2. **Send Message Flow** - Core product value
3. **Task Confirmation Flow** - Key user interaction
4. **Model Switching** - Critical configuration