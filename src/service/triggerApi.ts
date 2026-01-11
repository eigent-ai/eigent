import { proxyFetchGet, proxyFetchPost, proxyFetchPut, proxyFetchDelete } from "@/api/http";
import { Trigger, TriggerInput, TriggerUpdate, TriggerType, TriggerStatus } from "@/types";

// ==== Proxy API calls (for server) ====

export const proxyFetchTriggers = async (
  triggerType?: TriggerType,
  status?: TriggerStatus,
  page: number = 1,
  size: number = 20
) => {
  try {
    const params: Record<string, any> = {
      page,
      size
    };
    
    if (triggerType !== undefined) {
      params.trigger_type = triggerType;
    }
    
    if (status !== undefined) {
      params.status = status;
    }
    
    const res = await proxyFetchGet(`/api/trigger/`, params);
    return res;
  } catch (error) {
    console.error("Failed to fetch triggers:", error);
    throw error;
  }
};

export const proxyFetchTrigger = async (triggerId: number): Promise<Trigger> => {
  try {
    const res = await proxyFetchGet(`/api/trigger/${triggerId}`);
    return res;
  } catch (error) {
    console.error("Failed to fetch trigger:", error);
    throw error;
  }
};

export const proxyCreateTrigger = async (triggerData: TriggerInput): Promise<Trigger> => {
  try {
    const res = await proxyFetchPost(`/api/trigger/`, triggerData);
    return res;
  } catch (error) {
    console.error("Failed to create trigger:", error);
    throw error;
  }
};

export const proxyUpdateTrigger = async (triggerId: number, updateData: TriggerUpdate): Promise<Trigger> => {
  try {
    const res = await proxyFetchPut(`/api/trigger/${triggerId}`, updateData);
    return res;
  } catch (error) {
    console.error("Failed to update trigger:", error);
    throw error;
  }
};

export const proxyDeleteTrigger = async (triggerId: number): Promise<void> => {
  try {
    await proxyFetchDelete(`/api/trigger/${triggerId}`);
  } catch (error) {
    console.error("Failed to delete trigger:", error);
    throw error;
  }
};

export const proxyActivateTrigger = async (triggerId: number): Promise<Trigger> => {
  try {
    const res = await proxyFetchPost(`/api/trigger/${triggerId}/activate`);
    return res;
  } catch (error) {
    console.error("Failed to activate trigger:", error);
    throw error;
  }
};

export const proxyDeactivateTrigger = async (triggerId: number): Promise<Trigger> => {
  try {
    const res = await proxyFetchPost(`/api/trigger/${triggerId}/deactivate`);
    return res;
  } catch (error) {
    console.error("Failed to deactivate trigger:", error);
    throw error;
  }
};

export const proxyFetchTriggerExecutions = async (
  triggerId: number,
  page: number = 1,
  size: number = 20
) => {
  try {
    const params = {
      page,
      size
    };
    
    const res = await proxyFetchGet(`/api/trigger/${triggerId}/executions`, params);
    return res;
  } catch (error) {
    console.error("Failed to fetch trigger executions:", error);
    throw error;
  }
};