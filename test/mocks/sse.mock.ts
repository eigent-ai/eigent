import { vi } from "vitest"

// Mock fetchEventSource
export const mockFetchEventSource = vi.fn()

vi.mock('@microsoft/fetch-event-source', () => ({
  fetchEventSource: (...args: any[]) => mockFetchEventSource(...args),
}))

// Helper function for sequential SSE events
export const createSSESequence = (events: Array<{ event: any; delay: number }>) => {
  return async (onMessage: (data: any) => void) => {
    for (let i = 0; i < events.length; i++) {
      const { event, delay } = events[i]
      
      await new Promise<void>((resolve) => {
        setTimeout(() => {
          console.log(`Sending SSE Event ${i + 1}:`, event.step);
          onMessage({
            data: JSON.stringify(event)
          })
          resolve()
        }, delay)
      })
    }
  }
}


// https://github.com/eigent-ai/eigent/issues/619 - Two task boxes
export const issue619SseSequence = [
  {
    event: {
      step: 'confirmed',
      data: { question: 'Please help me check Google Calendar when is the next meeting, what kind of meeting it is, and who is attending the meeting.' }
    },
    delay: 100
  },
  {
    event: {
      step: 'to_sub_tasks',
      data: {
        summary_task: 'Task|Please help me check Google Calendar when is the next meeting, what kind of meeting it is, and who is attending the meeting.',
        sub_tasks: [
          {
            id: '1762503273000-2985.1',
            content: 'Retrieve the details of the next scheduled event on the user\'s Google Calendar, including the start time, title of the meeting, and the list of all participants\' names and email addresses. Format the result as a JSON object with the keys: \'start_time\', \'meeting_title\', and \'participants\', where \'participants\' is an array of objects each with \'name\' and \'email\'.',
            state: 'FAILED',
            subtasks: []
          }
        ]
      }
    },
    delay:  100
  },
  {
    event: {
      step: 'deactivate_agent',
      data: {
        agent_name: 'question_confirm_agent',
        agent_id: '3f9fff03-e95a-4ad6-a3d4-6bdd73b639c4',
        process_task_id: '',
        message: 'yes',
        tokens: 357
      }
    },
    delay:  100
  },
  {
    event: {
      step: 'create_agent',
      data: {
        agent_name: 'task_agent',
        agent_id: '17cef41b-5158-40e8-b1e2-0a88777dddb4',
        tools: []
      }
    },
    delay:  100
  },
  {
    event: {
      step: 'create_agent',
      data: {
        agent_name: 'search_agent',
        agent_id: 'c249ac7b-6745-4832-a5c1-3238f9176434',
        tools: ['Search Toolkit', 'Browser Toolkit', 'Human Toolkit', 'Note Taking Toolkit', 'Terminal Toolkit']
      }
    },
    delay:  100
  },
  {
    event: {
      step: 'deactivate_toolkit',
      data: {
        agent_name: 'search_agent',
        process_task_id: '',
        toolkit_name: 'Browser Toolkit',
        method_name: 'register agent',
        message: 'null'
      }
    },
    delay:  100
  },
  {
    event: {
      step: 'create_agent',
      data: {
        agent_name: 'document_agent',
        agent_id: 'e861cc5b-976b-41f0-a298-9c3e921ffaf5',
        tools: ['File Toolkit', 'Pptx Toolkit', 'Human Toolkit', 'Mark It Down Toolkit', 'Excel Toolkit', 'Note Taking Toolkit', 'Terminal Toolkit', 'Google Drive Mcp Toolkit']
      }
    },
    delay:  100
  },
  {
    event: {
      step: 'deactivate_toolkit',
      data: {
        agent_name: 'multi_modal_agent',
        process_task_id: '',
        toolkit_name: 'Open Ai Image Toolkit',
        method_name: 'get openai credentials',
        message: '[object Object]'
      }
    },
    delay:  100
  },
  {
    event: {
      step: 'activate_toolkit',
      data: {
        agent_name: 'search_agent',
        process_task_id: '',
        toolkit_name: 'Browser Toolkit',
        method_name: 'register agent',
        message: 'ChatAgent(Search Agent, RoleType.ASSISTANT, gpt-5)'
      }
    },
    delay:  100
  },
  {
    event: {
      step: 'create_agent',
      data: {
        agent_name: 'mcp_agent',
        agent_id: 'd23a70fe-5c90-47bd-9170-f50defcd352a',
        tools: []
      }
    },
    delay:  100
  },
  {
    event: {
      step: 'activate_toolkit',
      data: {
        agent_name: 'search_agent',
        process_task_id: '',
        toolkit_name: 'Browser Toolkit',
        method_name: 'register agent',
        message: 'ChatAgent(Search Agent, RoleType.ASSISTANT, gpt-5)'
      }
    },
    delay:  100
  },
  {
    event: {
      step: 'activate_agent',
      data: {
        agent_name: 'question_confirm_agent',
        process_task_id: '',
        agent_id: '3f9fff03-e95a-4ad6-a3d4-6bdd73b639c4',
        message: '=== Previous Conversation ===\nPrevious Task: Please help me check Google Calendar when is the next meeting, what kind of meeting it is, and who is attending the meeting.\n\n\nUser Query: Please help me check Google Calendar when is the next meeting, what kind of meeting it is, and who is attending the meeting.\n\nDetermine if this user query is a complex task or a simple question.\n\nComplex task (answer "yes"): Requires tools, code execution, file operations, multi-step planning, or creating/modifying content\n- Examples: "create a file", "search for X", "implement feature Y", "write code", "analyze data", "build something"\n\nSimple question (answer "no"): Can be answered directly with knowledge or conversation history, no action needed\n- Examples: greetings ("hello", "hi"), fact queries ("what is X?"), clarifications ("what did you mean?"), status checks ("how are you?")\n\nAnswer only "yes" or "no". Do not provide any explanation.\n\nIs this a complex task? (yes/no):'
      }
    },
    delay:  100
  },
  {
    event: {
      step: 'create_agent',
      data: {
        agent_name: 'coordinator_agent',
        agent_id: '97326e19-91aa-4f9e-95ac-dbc1d92d3756',
        tools: []
      }
    },
    delay:  100
  },
  {
    event: {
      step: 'create_agent',
      data: {
        agent_name: 'new_worker_agent',
        agent_id: '62eca7d0-ed56-4101-bd20-9c929d31590e',
        tools: []
      }
    },
    delay:  100
  },
  {
    event: {
      step: 'activate_toolkit',
      data: {
        agent_name: 'search_agent',
        process_task_id: '',
        toolkit_name: 'Browser Toolkit',
        method_name: 'register agent',
        message: 'ChatAgent(Search Agent, RoleType.ASSISTANT, gpt-4.1)'
      }
    },
    delay:  100
  },
  {
    event: {
      step: 'create_agent',
      data: {
        agent_name: 'developer_agent',
        agent_id: 'd7514c96-3414-4220-9a99-c08cbabc86b5',
        tools: ['Human Toolkit', 'Terminal Toolkit', 'Note Taking Toolkit', 'Web Deploy Toolkit']
      }
    },
    delay:  100
  },
  {
    event: {
      step: 'activate_toolkit',
      data: {
        agent_name: 'multi_modal_agent',
        process_task_id: '',
        toolkit_name: 'Open Ai Image Toolkit',
        method_name: 'get openai credentials',
        message: '[object Object]'
      }
    },
    delay:  100
  },
  {
    event: {
      step: 'create_agent',
      data: {
        agent_name: 'multi_modal_agent',
        agent_id: '2682c381-3560-4584-96c6-985a5395c85d',
        tools: ['Video Downloader Toolkit', 'Audio Analysis Toolkit', 'Image Analysis Toolkit', 'Open Ai Image Toolkit', 'Human Toolkit', 'Terminal Toolkit', 'Note Taking Toolkit', 'Search Toolkit']
      }
    },
    delay:  100
  },
  {
    event: {
      step: 'deactivate_toolkit',
      data: {
        agent_name: 'search_agent',
        process_task_id: '',
        toolkit_name: 'Browser Toolkit',
        method_name: 'register agent',
        message: 'null'
      }
    },
    delay:  100
  },
  {
    event: {
      step: 'create_agent',
      data: {
        agent_name: 'Google calendar agent ',
        agent_id: '729ebd9b-4eef-4f4a-83b8-0289bef302c5',
        tools: ['Google Calendar Toolkit']
      }
    },
    delay:  1100
  },
  {
    event: {
      step: 'activate_toolkit',
      data: {
        agent_name: 'search_agent',
        process_task_id: '',
        toolkit_name: 'Browser Toolkit',
        method_name: 'register agent',
        message: 'ChatAgent(Search Agent, RoleType.ASSISTANT, gpt-4.1)'
      }
    },
    delay:  1100
  },
  {
    event: {
      step: 'deactivate_toolkit',
      data: {
        agent_name: 'Google calendar agent ',
        process_task_id: '1762502461718-31.1',
        toolkit_name: 'Google Calendar Toolkit',
        method_name: 'get calendar details',
        message: 'Failed to retrieve calendar details'
      }
    },
    delay:  1100
  },
  {
    event: {
      step: 'deactivate_toolkit',
      data: {
        agent_name: 'Google calendar agent ',
        process_task_id: '1762502461718-31.1',
        toolkit_name: 'Google Calendar Toolkit',
        method_name: 'get events',
        message: '{"error": "Failed to retrieve events: timed out"}'
      }
    },
    delay:  1100
  },
  {
    event: {
      step: 'to_sub_tasks',
      data: {
        summary_task: 'Task|Please help me check Google Calendar when is the next meeting, what kind of meeting it is, and who is attending the meeting.',
        sub_tasks: []
      }
    },
    delay:  1100
  },
  {
    event: {
      step: 'end',
      data: ''
    },
    delay:  1100
  }
];
