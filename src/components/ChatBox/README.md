# ChatBox Component Structure

This document explains the new Message ChatBox structure and the relationships between different components in the ChatBox folder.

## Overview

The ChatBox component has been restructured to support a multi-turn conversation system with improved message organization, task management, and user interaction patterns. The new structure separates concerns and provides better scalability for handling complex chat interactions.

## Architecture

### Core Structure

```
ChatBox/
├── index.tsx                    # Main ChatBox container and orchestration
├── ProjectChatContainer.tsx     # Project-level chat container
├── ProjectSection.tsx           # Individual project section
├── UserQueryGroup.tsx           # User query and response grouping
├── TaskCard.tsx                 # Task planning and execution display
├── MessageCard.tsx              # Individual message rendering
├── TypeCardSkeleton.tsx         # Loading skeleton for task planning
├── NoticeCard.tsx               # Chain of thought display
├── FloatingAction.tsx           # Floating action buttons
├── TaskItem.tsx                 # Individual task item component
├── TaskType.tsx                 # Task type indicator
├── MarkDown.tsx                 # Markdown content rendering
├── SummaryMarkDown.tsx          # Summary markdown rendering
└── BottomBox/                   # Input and action components
    ├── index.tsx               # BottomBox container
    ├── InputBox.tsx            # Message input component
    ├── BoxAction.tsx           # Action buttons
    ├── BoxHeader.tsx           # Header with task info
    └── QueuedBox.tsx           # Queued messages display
```

## Component Relationships

### 1. Main Orchestration (`index.tsx`)

**Purpose**: The main ChatBox component that orchestrates the entire chat experience.

**Key Responsibilities**:
- Manages chat state and project store integration
- Handles message sending and task queuing
- Controls BottomBox state based on task status
- Manages privacy settings and file attachments
- Handles task confirmation and replay functionality

**Relationships**:
- **Uses**: `ProjectChatContainer`, `BottomBox`
- **Manages**: Chat store state, project store state, message queuing
- **Controls**: Input state, task status, privacy settings

### 2. Project Chat Container (`ProjectChatContainer.tsx`)

**Purpose**: Container for all chat stores within an active project.

**Key Responsibilities**:
- Renders multiple chat stores for the active project
- Manages scroll behavior and auto-scrolling
- Handles intersection observer for scroll-based animations
- Provides scrollbar visibility management

**Relationships**:
- **Uses**: `ProjectSection`
- **Manages**: Multiple chat stores, scroll behavior
- **Provides**: Scroll container for all project chats

### 3. Project Section (`ProjectSection.tsx`)

**Purpose**: Individual project section that groups messages by query cycles.

**Key Responsibilities**:
- Groups messages by user queries and responses
- Renders query groups in chronological order
- Manages floating action buttons
- Provides project-level task management

**Relationships**:
- **Uses**: `UserQueryGroup`, `FloatingAction`
- **Manages**: Message grouping, query cycles
- **Provides**: Project-level task controls

### 4. User Query Group (`UserQueryGroup.tsx`)

**Purpose**: Groups a user query with its associated task and responses.

**Key Responsibilities**:
- Renders user message and associated task card
- Manages sticky task box behavior
- Handles skeleton loading states
- Renders assistant responses and file lists
- Manages intersection observer for active query tracking

**Relationships**:
- **Uses**: `MessageCard`, `TaskCard`, `TypeCardSkeleton`, `NoticeCard`
- **Manages**: Query grouping, sticky behavior, loading states
- **Provides**: Complete query-response cycle display

### 5. Task Card (`TaskCard.tsx`)

**Purpose**: Displays task planning, execution status, and progress.

**Key Responsibilities**:
- Shows task summary and progress
- Displays task list with status indicators
- Manages task filtering and expansion
- Handles task editing and management
- Provides task state visualization

**Relationships**:
- **Uses**: `TaskItem`, `TaskType`, `TaskState`
- **Manages**: Task info, task running status, progress
- **Provides**: Task planning and execution interface

### 6. Message Card (`MessageCard.tsx`)

**Purpose**: Renders individual messages with typewriter effects and attachments.

**Key Responsibilities**:
- Displays message content with markdown rendering
- Manages typewriter effect for agent messages
- Handles file attachments display
- Provides copy functionality for user messages
- Tracks completed typewriter effects globally

**Relationships**:
- **Uses**: `MarkDown`
- **Manages**: Message content, typewriter effects, attachments
- **Provides**: Individual message rendering

### 7. Loading and State Components

#### TypeCardSkeleton (`TypeCardSkeleton.tsx`)
- **Purpose**: Loading skeleton for task planning phase
- **Shows**: Animated placeholders for task planning
- **Used by**: `UserQueryGroup` during skeleton phase

#### NoticeCard (`NoticeCard.tsx`)
- **Purpose**: Displays chain of thought reasoning
- **Shows**: Expandable list of reasoning steps
- **Used by**: `UserQueryGroup` for CoT display

#### FloatingAction (`FloatingAction.tsx`)
- **Purpose**: Floating action buttons for task control
- **Shows**: Pause, Resume, Skip buttons
- **Used by**: `ProjectSection` for task control

### 8. Task Management Components

#### TaskItem (`TaskItem.tsx`)
- **Purpose**: Individual task item with editing capabilities
- **Features**: Inline editing, task status, delete functionality
- **Used by**: `TaskCard` for task list display

#### TaskType (`TaskType.tsx`)
- **Purpose**: Visual indicator for task type
- **Shows**: Task type icons and labels
- **Used by**: `TaskCard`, `TypeCardSkeleton`

### 9. BottomBox Components

The BottomBox directory contains input and action components:

#### BottomBox (`BottomBox/index.tsx`)
- **Purpose**: Main input and action container
- **Manages**: Different states (input, confirm, running, finished, splitting)
- **Coordinates**: Input, actions, and queued messages

#### InputBox (`BottomBox/InputBox.tsx`)
- **Purpose**: Message input with file attachments
- **Features**: Text input, file drag-drop, send functionality
- **Used by**: BottomBox for message input

#### QueuedBox (`BottomBox/QueuedBox.tsx`)
- **Purpose**: Displays queued messages
- **Features**: Message queuing, removal, reordering
- **Used by**: BottomBox for queued message management

#### BoxAction (`BottomBox/BoxAction.tsx`)
- **Purpose**: Action buttons for task control
- **Features**: Confirm, edit, replay, pause/resume, skip
- **Used by**: BottomBox for task actions

#### BoxHeader (`BottomBox/BoxHeader.tsx`)
- **Purpose**: Header with task information
- **Shows**: Task summary, progress, timing
- **Used by**: BottomBox for task status display

## Data Flow

### Message Flow
1. **User Input** → `BottomBox/InputBox` → `index.tsx` → Chat Store
2. **Message Processing** → `index.tsx` → Backend API
3. **Response Rendering** → Chat Store → `ProjectChatContainer` → `ProjectSection` → `UserQueryGroup` → `MessageCard`

### Task Flow
1. **Task Planning** → `UserQueryGroup` → `TypeCardSkeleton` (loading) → `TaskCard` (planning)
2. **Task Execution** → `TaskCard` → Task status updates → `FloatingAction` (controls)
3. **Task Completion** → `TaskCard` → Final results → `MessageCard` (end message)

### State Management
- **Chat Store**: Manages individual chat sessions and tasks
- **Project Store**: Manages multiple chat stores per project
- **Component State**: Local UI state (expanded/collapsed, active queries, etc.)

## Key Features

### Multi-Turn Conversations
- Each user query creates a new query group
- Task cards are sticky and follow the user query
- Messages are grouped by query cycles for better organization

### Task Management
- Visual task planning with skeleton loading
- Real-time task execution status
- Task filtering and expansion
- Inline task editing capabilities

### Message Queuing
- Messages can be queued when tasks are busy
- Queued messages are displayed in a separate box
- Automatic processing when current task completes

### Responsive Design
- Sticky task cards that adapt to scroll position
- Smooth animations and transitions
- Intersection observer for performance optimization

### File Handling
- File attachments in messages
- File list display in end messages
- Click-to-reveal functionality

## Usage Patterns

### Adding New Message Types
1. Add message type handling in `UserQueryGroup.tsx`
2. Create specific rendering logic in the appropriate component
3. Update message grouping logic in `ProjectSection.tsx`

### Extending Task Management
1. Add new task states in `TaskCard.tsx`
2. Update task filtering logic
3. Add corresponding UI elements in `TaskItem.tsx`

### Customizing Message Rendering
1. Modify `MessageCard.tsx` for basic message display
2. Update `MarkDown.tsx` for content rendering
3. Add new attachment types as needed

This structure provides a scalable foundation for complex chat interactions while maintaining clear separation of concerns and efficient state management.
