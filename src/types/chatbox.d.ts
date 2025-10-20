// Global type definitions for ChatBox component

declare global {
	interface FileInfo {
		name: string;
		type: string;
		path: string;
		content?: string;
		icon?: React.ElementType;
		agent_id?: string;
		task_id?: string;
		project_id?: string;
		isFolder?: boolean;
		relativePath?: string;
	}

	interface ProjectInfo {
		id: string;
		name: string;
		path: string;
		taskCount: number;
		createdAt: Date;
	}

	interface TaskInfo {
		report?: string | undefined;
		id: string;
		content: string;
		status?: string;
		agent?: Agent;
		terminal?: string[];
		fileList?: FileInfo[];
		project_id?: string;
		toolkits?: {
			toolkitName: string;
			toolkitMethods: string;
			message: string;
			toolkitStatus?: AgentStatus;
		}[];
		failure_count?: number;
		reAssignTo?:string;
	}

	interface File {
		fileName: string;
		filePath: string;
	}



	type AgentStatus = "pending" | "running" | "completed" | "failed"

	interface ActiveWebView {
		id: string;
		url: string;
		processTaskId: string;
		img: string;
	}

	interface Agent {
		agent_id: string;
		name: string;
		type: AgentNameType;
		status?: AgentStatus;
		tasks: TaskInfo[];
		log: AgentMessage[];
		img?: string[];
		activeWebviewIds?: ActiveWebView[];
		tools?:string[];
		workerInfo?: {
			name: string;
			description: string;
			tools: any;
			mcp_tools: any;
			selectedTools: any;
		};
	}

	interface Message {
		id: string;
		role: "user" | "agent";
		content: string;
		step?: string;
		agent_id?: string;
		isConfirm?: boolean;
		taskType?: 1 | 2 | 3;
		taskInfo?: TaskInfo[];
		taskRunning?: TaskInfo[];
		summaryTask?: string;
		taskAssigning?: Agent[];
		showType?: "tree" | "list";
		rePort?: any
		fileList?: FileInfo[];
		task_id?: string;
		summary?: string;
		agent_name?: string;
		attaches?:File[]
	}

	interface AgentMessage {
		step: string;
		data: {
			project_id?:string;
			failure_count?: number;
			tokens?: number;
			sub_tasks?: TaskInfo[];
			summary_task?: string;
			content?: string;
			notice?: string;
			answer?: string;
			agent_name?: string;
			agent_id?: string;
			assignee_id?: string;
			task_id?: string;
			toolkit_name?: string;
			method_name?: string;
			state?: string;
			message?: string;
			question?: string;
			agent?: string;
			file_path?: string;
			process_task_id?: string;
			output?: string
			result?: string
			tools?: string[];
			//Context Length
			current_length?: number;
			max_length?: number
		};
		status?: 'running' | 'filled' | 'completed';
	}

	type AgentNameType =
		| "developer_agent"
		| "search_agent"
		| "document_agent"
		| "multi_modal_agent"
		| "social_medium_agent";

	interface AgentNameMap {
		developer_agent: "Developer Agent";
		search_agent: "Search Agent";
		document_agent: "Document Agent";
		multi_modal_agent: "Multi Modal Agent";
		social_medium_agent: "Social Media Agent";
	}
	type WorkspaceType = 'workflow' | 'developer_agent' | 'search_agent' | 'document_agent' | 'multi_modal_agent' | 'social_medium_agent' | null;
}


export { }; 	