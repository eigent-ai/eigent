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
	projectStore: any,
	navigate: NavigateFunction,
	projectId: string,
	question: string,
	historyId: string
) => {
	/**
	 * TODO(history): For now all replaying is appending to the same instance
	 * of task_id (to be renamed projectId). Later we need to filter task_id from
	 * /api/chat/histories by project_id then feed it here.
	 */
	const taskIdsList = [projectId];
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
	chatStore: any,
	projectStore: any,
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
			
			if (chatStoreData.tasks) {
				Object.values(chatStoreData.tasks).forEach((task: any) => {
					// Check messages for user content
					if (task.messages && task.messages.length > 0) {
						const userMessage = task.messages.find((msg: any) => msg.role === 'user');
						if (userMessage && userMessage.content && timestamp < earliestTimestamp) {
							question = userMessage.content.trim();
							earliestTimestamp = timestamp;
						}
					}
					
					// Check task info for original questions
					if (task.taskInfo && task.taskInfo.length > 0) {
						task.taskInfo.forEach((info: any) => {
							if (info.content && timestamp < earliestTimestamp) {
								question = info.content;
								earliestTimestamp = timestamp;
							}
						});
					}
					
					// Check agent logs for original task content
					if (task.taskAssigning) {
						task.taskAssigning.forEach((agent: any) => {
							if (agent.log) {
								agent.log.forEach((logEntry: any) => {
									if (logEntry.data && logEntry.data.message) {
										const match = logEntry.data.message.match(/==============================\n(.*?)\n==============================/s);
										if (match && match[1] && timestamp < earliestTimestamp) {
											question = match[1].trim();
											earliestTimestamp = timestamp;
										}
									}
								});
							}
						});
					}
				});
			}
		});
	}
	
	// Fallback to current task's first message if no question found
	if (!question && chatStore.tasks[taskId] && chatStore.tasks[taskId].messages[0]) {
		question = chatStore.tasks[taskId].messages[0].content;
	}

	const historyId = projectStore.getHistoryId(projectId);
	
	// Use replayProject from projectStore instead of replay from chatStore
	const taskIdsList = [taskId];
	projectStore.replayProject(taskIdsList, question, projectId, historyId || undefined);
	navigate("/");
};