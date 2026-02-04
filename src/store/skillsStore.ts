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

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Skill scope interface
export interface SkillScope {
  isGlobal: boolean;
  selectedAgents: string[];
}

// Skill interface
export interface Skill {
  id: string;
  name: string;
  description: string;
  filePath: string;
  fileContent: string;
  addedAt: number;
  scope: SkillScope;
  enabled: boolean;
  isExample: boolean;
}

// Example skills
const EXAMPLE_SKILLS: Skill[] = [
  {
    id: 'example-web-scraper',
    name: 'Web Scraper',
    description:
      'Extract data from web pages using CSS selectors or XPath expressions',
    filePath: 'examples/web-scraper.skill',
    fileContent: `# Web Scraper Skill
This skill allows the agent to scrape web pages and extract structured data.

## Usage
- Extract text content from specific elements
- Parse tables and lists
- Follow pagination links`,
    addedAt: Date.now() - 86400000 * 7,
    scope: { isGlobal: true, selectedAgents: [] },
    enabled: true,
    isExample: true,
  },
  {
    id: 'example-file-organizer',
    name: 'File Organizer',
    description:
      'Automatically organize files into folders based on type, date, or custom rules',
    filePath: 'examples/file-organizer.skill',
    fileContent: `# File Organizer Skill
This skill helps organize files in directories based on various criteria.

## Features
- Sort by file type (images, documents, videos)
- Sort by date created/modified
- Custom folder naming rules`,
    addedAt: Date.now() - 86400000 * 14,
    scope: { isGlobal: true, selectedAgents: [] },
    enabled: true,
    isExample: true,
  },
  {
    id: 'example-data-analyzer',
    name: 'Data Analyzer',
    description:
      'Analyze CSV and JSON data files to generate insights and visualizations',
    filePath: 'examples/data-analyzer.skill',
    fileContent: `# Data Analyzer Skill
This skill enables data analysis capabilities for the agent.

## Capabilities
- Read and parse CSV/JSON files
- Calculate statistics (mean, median, mode)
- Generate summary reports`,
    addedAt: Date.now() - 86400000 * 21,
    scope: { isGlobal: true, selectedAgents: [] },
    enabled: false,
    isExample: true,
  },
];

// Skills state interface
interface SkillsState {
  skills: Skill[];
  addSkill: (skill: Omit<Skill, 'id' | 'addedAt' | 'isExample'>) => void;
  updateSkill: (id: string, updates: Partial<Skill>) => void;
  deleteSkill: (id: string) => void;
  toggleSkill: (id: string) => void;
  getSkillsByType: (isExample: boolean) => Skill[];
}

// Generate unique ID
const generateId = () =>
  `skill-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

// Create store
export const useSkillsStore = create<SkillsState>()(
  persist(
    (set, get) => ({
      skills: [...EXAMPLE_SKILLS],

      addSkill: (skill) => {
        const newSkill: Skill = {
          ...skill,
          id: generateId(),
          addedAt: Date.now(),
          isExample: false,
        };
        set((state) => ({
          skills: [newSkill, ...state.skills],
        }));
      },

      updateSkill: (id, updates) => {
        set((state) => ({
          skills: state.skills.map((skill) =>
            skill.id === id ? { ...skill, ...updates } : skill
          ),
        }));
      },

      deleteSkill: (id) => {
        set((state) => ({
          skills: state.skills.filter((skill) => skill.id !== id),
        }));
      },

      toggleSkill: (id) => {
        set((state) => ({
          skills: state.skills.map((skill) =>
            skill.id === id ? { ...skill, enabled: !skill.enabled } : skill
          ),
        }));
      },

      getSkillsByType: (isExample) => {
        return get().skills.filter((skill) => skill.isExample === isExample);
      },
    }),
    {
      name: 'skills-storage',
      partialize: (state) => ({
        skills: state.skills,
      }),
    }
  )
);

// Non-hook version for use outside React components
export const getSkillsStore = () => useSkillsStore.getState();
