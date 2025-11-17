import { proxyFetchGet } from "@/api/http";
import { HistoryTask, ProjectGroup, GroupedHistoryResponse } from "@/types/history";

// Group tasks by project_id and add project-level metadata
const groupTasksByProject = (tasks: HistoryTask[]): ProjectGroup[] => {
  const projectMap = new Map<string, ProjectGroup>();

  tasks.forEach(task => {
    const projectId = task.project_id;
    
    if (!projectMap.has(projectId)) {
      projectMap.set(projectId, {
        project_id: projectId,
        project_name: task.project_name || `Project ${projectId}`,
        total_tokens: 0,
        task_count: 0,
        latest_task_date: task.created_at || new Date().toISOString(),
        tasks: [],
        total_completed_tasks: 0,
        total_ongoing_tasks: 0,
        average_tokens_per_task: 0,
        last_prompt: task.question || "",
      });
    }

    const project = projectMap.get(projectId)!;
    project.tasks.push(task);
    project.task_count++;
    project.total_tokens += task.tokens || 0;
    
    // ChatStatus enum: ongoing = 1, done = 2
    if (task.status === 2) { // ChatStatus.done (completed)
      project.total_completed_tasks++;
    } else if (task.status === 1) { // ChatStatus.ongoing (pending/running etc..)
      project.total_ongoing_tasks++;
    }
  
    // Update latest task date
    if (task.created_at && task.created_at > project.latest_task_date) {
      project.latest_task_date = task.created_at;
    }
  });

  // Calculate averages and sort tasks within each project
  projectMap.forEach(project => {
    project.average_tokens_per_task = project.task_count > 0 
      ? Math.round(project.total_tokens / project.task_count) 
      : 0;
    
    // Sort tasks by creation date (newest first)
    project.tasks.sort((a, b) => {
      const dateA = new Date(a.created_at || 0).getTime();
      const dateB = new Date(b.created_at || 0).getTime();
      return dateB - dateA;
    });
  });

  // Convert to array and sort by latest task date (newest first)
  return Array.from(projectMap.values()).sort((a, b) => {
    const dateA = new Date(a.latest_task_date).getTime();
    const dateB = new Date(b.latest_task_date).getTime();
    return dateB - dateA;
  });
};

export const fetchHistoryTasks = async (setTasks: React.Dispatch<React.SetStateAction<any[]>>) => {
  try {
    const res = await proxyFetchGet(`/api/chat/histories`);
    setTasks(res.items)
  } catch (error) {
    console.error("Failed to fetch history tasks:", error);
    setTasks([])
  }
};

// New function to fetch grouped history tasks from the backend endpoint
export const fetchGroupedHistoryTasks = async (setProjects: React.Dispatch<React.SetStateAction<ProjectGroup[]>>) => {
  try {
    const res = await proxyFetchGet(`/api/chat/histories/grouped?include_tasks=true`);
    // If the response doesn't have projects field, fall back to legacy grouping
    if(!res || !res.projects) {
      await fetchGroupedHistoryTasksLegacy(setProjects);
    } else {
      setProjects(res.projects);
    }
  } catch (error) {
    console.error("Failed to fetch grouped history tasks, falling back to legacy:", error);
    // Fall back to legacy grouping if the new endpoint fails
    await fetchGroupedHistoryTasksLegacy(setProjects);
  }
};

// Function to fetch grouped history summaries only (without individual tasks for better performance)
export const fetchGroupedHistorySummaries = async (setProjects: React.Dispatch<React.SetStateAction<ProjectGroup[]>>) => {
  try {
    const res = await proxyFetchGet(`/api/chat/histories/grouped?include_tasks=false`);
    // If the response doesn't have projects field, fall back to legacy grouping
    if(!res || !res.projects) {
      await fetchGroupedHistoryTasksLegacy(setProjects);
    } else {
      setProjects(res.projects);
    }
  } catch (error) {
    console.error("Failed to fetch grouped history summaries, falling back to legacy:", error);
    // Fall back to legacy grouping if the new endpoint fails
    await fetchGroupedHistoryTasksLegacy(setProjects);
  }
};

// Legacy function for backward compatibility - groups on frontend
export const fetchGroupedHistoryTasksLegacy = async (setProjects: React.Dispatch<React.SetStateAction<ProjectGroup[]>>) => {
  try {
    const res = await proxyFetchGet(`/api/chat/histories`);
    const groupedProjects = groupTasksByProject(res.items);
    setProjects(groupedProjects);
  } catch (error) {
    console.error("Failed to fetch grouped history tasks:", error);
    setProjects([]);
  }
};

// Utility function to get all tasks from grouped data (for backward compatibility)
export const flattenProjectTasks = (projects: ProjectGroup[]): HistoryTask[] => {
  return projects.flatMap(project => project.tasks);
};