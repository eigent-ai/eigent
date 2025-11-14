import { fetchGroupedHistoryTasks } from "@/service/historyApi";
import { ChatStore } from "@/store/chatStore";
import { ProjectStore } from "@/store/projectStore";
import { ProjectGroup } from "@/types/history";
import { NavigateFunction } from "react-router-dom";

/**
 * Reusable replay function that can be used across different components
 * This function replays a project using projectStore.replayProject
 * 
 * @param projectStore - The project store instance
 * @param navigate - The navigate function from useNavigate hook
 * @param projectId - The project ID to replay
 * @param question - The question/content to replay
 * @param historyId - The history ID for the replay
 */
export const replayProject = async (
	projectStore: ProjectStore,
	navigate: NavigateFunction,
	projectId: string,
	question: string,
	historyId: string,
	taskIdsList?: string[]
) => {
	if(!taskIdsList) taskIdsList = [projectId];
	projectStore.replayProject(taskIdsList, question, projectId, historyId);
	navigate({ pathname: "/" });
};

/**
 * Replay function specifically for the current active task in ChatBox
 * This extracts the necessary data from the current chat store and project store
 * 
 * @param chatStore - The chat store instance
 * @param projectStore - The project store instance
 * @param navigate - The navigate function from useNavigate hook
 */
export const replayActiveTask = async (
	chatStore: ChatStore,
	projectStore: ProjectStore,
	navigate: NavigateFunction
) => {
	const taskId = chatStore.activeTaskId as string;
	const projectId = projectStore.activeProjectId as string;
	
	if (!taskId || !projectId) {
		console.error("Missing taskId or projectId for replay");
		return;
	}

	// Extract the very first available question from all chat stores and tasks
	let question = "";
	let earliestTimestamp = Infinity;
	
	// Get the project data to access all chat stores
	const project = projectStore.projects[projectId];
	if (project && project.chatStores) {
		Object.entries(project.chatStores).forEach(([chatStoreId, chatStoreData]: [string, any]) => {
			const timestamp = project.chatStoreTimestamps[chatStoreId] || 0;
			const chatState = chatStoreData.getState();

			if (chatState.tasks) {
				Object.values(chatState.tasks).forEach((task: any) => {
					// Check messages for user content
					if (task.messages && task.messages.length > 0) {
						const userMessage = task.messages.find((msg: any) => msg.role === 'user');
						if (userMessage && userMessage.content && timestamp < earliestTimestamp) {
							question = userMessage.content.trim();
							earliestTimestamp = timestamp;
						}
					}
				});
			}
		});
	}
	
	// Fallback to current task's first message if no question found
	if (!question && chatStore.tasks[taskId] && chatStore.tasks[taskId].messages[0]) {
		question = chatStore.tasks[taskId].messages[0].content;
		console.log("[REPLAY] question fall back to ", question);
	}

	const historyId = projectStore.getHistoryId(projectId);
	
	// Use replayProject from projectStore instead of replay from chatStore
	const taskIdsList = [taskId];
	projectStore.replayProject(taskIdsList, question, projectId, historyId || undefined);
	navigate("/");
};