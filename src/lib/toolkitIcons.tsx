// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// ========= Copyright 2025-2026 @ Eigent.ai All Rights Reserved. =========

import {
  AudioLines,
  Bird,
  BookOpen,
  Brain,
  Briefcase,
  Bug,
  Calendar,
  Camera,
  Download,
  FileDown,
  FilePen,
  GitBranch,
  Globe,
  HardDrive,
  Image,
  type LucideIcon,
  Mail,
  MessageCircle,
  MessageSquare,
  MessageSquareMore,
  MessageSquareText,
  MousePointer,
  NotebookPen,
  Play,
  Presentation,
  Rocket,
  ScanEye,
  Search,
  Sheet,
  StickyNote,
  Terminal,
  User,
  Video,
  Wrench,
} from 'lucide-react';
import React from 'react';

const toolkitIconMap: Record<string, LucideIcon> = {
  // Dev/Code
  'Terminal Toolkit': Terminal,
  'Code Execution Toolkit': Play,
  'File Toolkit': FilePen,
  'Web Deploy Toolkit': Rocket,
  'Screenshot Toolkit': Camera,
  'Py Auto Gui Toolkit': MousePointer,

  // Browser/Web
  'Browser Toolkit': Globe,
  'Search Toolkit': Search,
  'Crawl Toolkit': Bug,

  // Documents
  'Note Taking Toolkit': StickyNote,
  'Mark It Down Toolkit': FileDown,
  'Excel Toolkit': Sheet,
  'Pptx Toolkit': Presentation,
  'Rag Toolkit': BookOpen,

  // Media
  'Image Analysis Toolkit': ScanEye,
  'Open Ai Image Toolkit': Image,
  'Video Downloader Toolkit': Download,
  'Video Analysis Toolkit': Video,
  'Audio Analysis Toolkit': AudioLines,

  // Communication
  'Human Toolkit': User,
  'Slack Toolkit': MessageSquare,
  'Twitter Toolkit': Bird,
  'Whats App Toolkit': MessageCircle,
  'Linked In Toolkit': Briefcase,
  'Reddit Toolkit': MessageSquareMore,
  'Lark Toolkit': MessageSquareText,
  'Github Toolkit': GitBranch,

  // Integrations
  'Google Drive Mcp Toolkit': HardDrive,
  'Google Calendar Toolkit': Calendar,
  'Google Gmail Mcp Toolkit': Mail,
  'Notion Toolkit': NotebookPen,
  'Notion Mcp Toolkit': NotebookPen,

  // Meta
  'Thinking Toolkit': Brain,
  ElectronToolkit: Globe,
};

export function getToolkitIcon(
  toolkitName: string,
  size: number = 16,
  className: string = 'text-text-primary'
): React.ReactNode {
  const Icon = toolkitIconMap[toolkitName] ?? Wrench;
  return <Icon size={size} className={className} />;
}
