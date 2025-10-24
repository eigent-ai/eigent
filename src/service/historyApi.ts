import { proxyFetchGet } from "@/api/http";

export const fetchHistoryTasks = async (setTasks: React.Dispatch<React.SetStateAction<any[]>>) => {
  try {
    const res = await proxyFetchGet(`/api/chat/histories`);
    setTasks(res.items)
  } catch (error) {
    console.error("Failed to fetch history tasks:", error);
    setTasks([])
  }
};