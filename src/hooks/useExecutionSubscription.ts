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

import { queryClient, queryKeys } from '@/lib/queryClient';
import {
  proxyFetchTriggerConfig,
  proxyUpdateTriggerExecution,
} from '@/service/triggerApi';
import { ActivityType, useActivityLogStore } from '@/store/activityLogStore';
import { useAuthStore } from '@/store/authStore';
import { useTriggerStore } from '@/store/triggerStore';
import { ExecutionStatus, ExecutionType, TriggerType } from '@/types';
import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';

// Ping interval: send ping every 2 minutes
const PING_INTERVAL = 60 * 2 * 1000;
// Pong timeout: if no pong received within 10 seconds after ping, mark as unhealthy
const PONG_TIMEOUT = 10 * 1000;

interface ExecutionCreatedMessage {
  type: 'execution_created';
  execution_id: string;
  trigger_id: number;
  trigger_type: TriggerType;
  status: ExecutionStatus;
  execution_type: ExecutionType;
  input_data: any;
  user_id: number;
  project_id: string;
  timestamp: string;
  task_prompt?: string;
}

interface ExecutionUpdatedMessage {
  type: 'execution_updated';
  execution_id: string;
  trigger_id: number;
  status: ExecutionStatus;
  updated_fields: string[];
  user_id: number;
  project_id: string;
  timestamp: string;
  task_prompt?: string;
}

interface ProjectCreatedMessage {
  type: 'project_created';
  project_id: string;
  project_name: string;
  chat_history_id: number;
  trigger_name: string;
  user_id: string;
  created_at: string | null;
}

interface WebhookAuthenticatedMessage {
  type: 'trigger_activated';
  trigger_id: number;
  trigger_type: 'webhook' | 'schedule';
  user_id: string;
  project_id: string;
  webhook_uuid: string;
}

interface AckConfirmedMessage {
  type: 'ack_confirmed';
  execution_id: string;
  status: 'running';
}

interface ConnectedMessage {
  type: 'connected';
  session_id: string;
  timestamp: string;
}

interface HeartbeatMessage {
  type: 'heartbeat';
  timestamp: string;
}

interface ErrorMessage {
  type: 'error';
  message: string;
}

interface PongMessage {
  type: 'pong';
}

type WebSocketMessage =
  | ExecutionCreatedMessage
  | ExecutionUpdatedMessage
  | ProjectCreatedMessage
  | WebhookAuthenticatedMessage
  | AckConfirmedMessage
  | ConnectedMessage
  | HeartbeatMessage
  | ErrorMessage
  | PongMessage;

/**
 * Hook for subscribing to trigger execution events via WebSocket
 */
export function useExecutionSubscription(enabled: boolean = true) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pongTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastCloseTimestampRef = useRef<number>(0);
  const authFailedRef = useRef<boolean>(false);
  const maxReconnectAttempts = 5;
  const debounceDelay = 5000; // 5 seconds debounce period
  const baseReconnectDelay = 1000;

  const { token } = useAuthStore();
  const { modifyLog } = useActivityLogStore();
  const {
    emitWebSocketEvent,
    triggers,
    setWsConnectionStatus,
    setLastPongTimestamp,
    setWsReconnectCallback,
  } = useTriggerStore();

  // Store latest values in refs to avoid recreating connect function
  const triggersRef = useRef(triggers);
  const modifyLogRef = useRef(modifyLog);
  const emitWebSocketEventRef = useRef(emitWebSocketEvent);
  const setWsConnectionStatusRef = useRef(setWsConnectionStatus);
  const setLastPongTimestampRef = useRef(setLastPongTimestamp);

  const markExecutionRunningRef = useRef(
    (
      executionId: string,
      projectId?: string,
      triggerName?: string,
      triggerId?: number
    ) => {
      proxyUpdateTriggerExecution(
        executionId,
        { status: 'running' },
        { projectId, triggerId, triggerName }
      ).catch((err) =>
        console.warn(
          '[ExecutionSubscription] Failed to mark execution running:',
          err
        )
      );
    }
  );

  // Update refs on every render
  useEffect(() => {
    triggersRef.current = triggers;
    modifyLogRef.current = modifyLog;
    emitWebSocketEventRef.current = emitWebSocketEvent;
    setWsConnectionStatusRef.current = setWsConnectionStatus;
    setLastPongTimestampRef.current = setLastPongTimestamp;
  });

  // Helper to start ping interval
  const startPingInterval = useCallback((ws: WebSocket) => {
    // Clear any existing interval
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
    }
    if (pongTimeoutRef.current) {
      clearTimeout(pongTimeoutRef.current);
    }

    pingIntervalRef.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));

        // Set timeout to wait for pong
        pongTimeoutRef.current = setTimeout(() => {
          console.warn(
            '[ExecutionSubscription] No pong received, marking connection as unhealthy'
          );
          setWsConnectionStatusRef.current('unhealthy');
        }, PONG_TIMEOUT);
      }
    }, PING_INTERVAL);
  }, []);

  // Helper to stop ping interval
  const stopPingInterval = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (pongTimeoutRef.current) {
      clearTimeout(pongTimeoutRef.current);
      pongTimeoutRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    // Prevent duplicate connections - check all non-closed states
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.CONNECTING ||
        wsRef.current.readyState === WebSocket.OPEN)
    ) {
      console.log(
        '[ExecutionSubscription] Connection already exists (state:',
        wsRef.current.readyState,
        '), skipping'
      );
      return;
    }

    if (!enabled || !token) {
      console.log(
        '[ExecutionSubscription] Skipping connection - enabled:',
        enabled,
        'hasToken:',
        !!token
      );
      setWsConnectionStatusRef.current('disconnected');
      return;
    }

    setWsConnectionStatusRef.current('connecting');

    try {
      const baseURL = import.meta.env.DEV
        ? import.meta.env.VITE_PROXY_URL
        : import.meta.env.VITE_BASE_URL;

      // Convert http/https to ws/wss
      const wsProtocol = baseURL.startsWith('https') ? 'wss' : 'ws';
      const wsURL = baseURL.replace(/^https?:\/\//, ''); // Remove protocol
      const fullURL = `${wsProtocol}://${wsURL}/api/execution/subscribe`;

      console.log('[ExecutionSubscription] Connecting to:', fullURL);

      const ws = new WebSocket(fullURL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[ExecutionSubscription] WebSocket connected');
        reconnectAttemptsRef.current = 0;
        authFailedRef.current = false; // Reset auth failure flag on new connection

        // Clear any pending debounce timer since we're now connected
        if (debounceTimeoutRef.current) {
          clearTimeout(debounceTimeoutRef.current);
          debounceTimeoutRef.current = null;
        }

        // Send subscription message - server expects token WITHOUT "Bearer" prefix
        const subscribeMessage = {
          type: 'subscribe',
          session_id: sessionIdRef.current,
          auth_token: token, // ⚠️ Remove "Bearer " prefix
        };

        ws.send(JSON.stringify(subscribeMessage));
        console.log('[ExecutionSubscription] Sent subscription message');

        // Start ping interval to check connection health
        startPingInterval(ws);
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);

          switch (message.type) {
            case 'connected':
              console.log(
                `[ExecutionSubscription] Connected with session: ${message.session_id}`
              );
              setWsConnectionStatusRef.current('connected');
              // toast.success('Connected to execution listener');
              break;

            case 'execution_created': {
              // Use ref to access latest triggers without adding to dependencies
              const trigger = triggersRef.current.find(
                (t) => t.id === message.trigger_id
              );
              const triggerName =
                trigger?.name || `Trigger #${message.trigger_id}`;
              // Use task_prompt from server message (primary), fallback to local trigger data
              const taskPrompt =
                message.task_prompt || trigger?.task_prompt || '';

              console.log(
                `[ExecutionSubscription] Execution created: ${message.execution_id}`
              );

              // Send acknowledgment immediately
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                  JSON.stringify({
                    type: 'ack',
                    execution_id: message.execution_id,
                  })
                );
              }

              modifyLogRef.current(
                message.execution_id,
                {
                  type: ActivityType.TriggerExecuted,
                  message: `"${triggerName}" execution started`,
                  triggerId: message.trigger_id,
                  triggerName: triggerName,
                  ...(message.project_id && { projectId: message.project_id }),
                },
                {
                  matchTypes: [ActivityType.TriggerExecuted],
                  addIfNotFound: true,
                }
              );

              markExecutionRunningRef.current(
                message.execution_id,
                message.project_id,
                triggerName,
                message.trigger_id
              );

              // Emit WebSocket event with full context for task execution
              // server provides task_prompt
              emitWebSocketEventRef.current({
                triggerId: message.trigger_id,
                triggerName: triggerName,
                taskPrompt: taskPrompt,
                executionId: message.execution_id,
                timestamp: Date.now(),
                // New fields for programmatic task execution
                triggerType: message.trigger_type,
                projectId: message.project_id, // Future: triggers will be associated with projects
                inputData: message.input_data || {},
              });
              break;
            }

            case 'ack_confirmed':
              console.log(
                `[ExecutionSubscription] ACK confirmed for: ${message.execution_id}`
              );
              break;

            case 'execution_updated': {
              // Use ref to access latest triggers without adding to dependencies
              const trigger = triggersRef.current.find(
                (t) => t.id === message.trigger_id
              );
              const triggerName =
                trigger?.name || `Trigger #${message.trigger_id}`;

              console.log(
                `[ExecutionSubscription] Execution updated: ${message.execution_id} - ${message.status}`
              );

              modifyLogRef.current(
                message.execution_id,
                {
                  type:
                    message.status === 'completed'
                      ? ActivityType.ExecutionSuccess
                      : ActivityType.ExecutionFailed,
                  message:
                    message.status === 'completed'
                      ? `"${triggerName}" execution completed`
                      : `"${triggerName}" execution failed`,
                  triggerId: message.trigger_id,
                  triggerName: triggerName,
                  ...(message.project_id && { projectId: message.project_id }),
                },
                {
                  matchTypes: [
                    ActivityType.ExecutionSuccess,
                    ActivityType.ExecutionFailed,
                  ],
                  addIfNotFound: true,
                }
              );

              if (message.status === 'completed') {
                toast.success(`Execution completed: ${triggerName}`);
              } else if (message.status === 'failed') {
                toast.error(`Execution failed: ${triggerName}`);
              }
              break;
            }

            case 'project_created':
              console.log(
                `[ExecutionSubscription] Project created: ${message.project_id} - ${message.project_name}`
              );
              break;

            case 'trigger_activated': {
              console.log(
                `[ExecutionSubscription] Trigger activated: ${message.trigger_id}`
              );

              // Invalidate trigger list cache to refresh triggers
              queryClient.invalidateQueries({
                queryKey: queryKeys.triggers.list(message.project_id),
              });

              // Also invalidate all trigger lists in case project_id is different
              queryClient.invalidateQueries({
                queryKey: queryKeys.triggers.all,
                predicate: (query) => query.queryKey[1] === 'list',
              });

              // Prefetch/refresh trigger type config for caching
              const triggerType = message.trigger_type as TriggerType;
              queryClient.prefetchQuery({
                queryKey: queryKeys.triggers.configs(triggerType),
                queryFn: () => proxyFetchTriggerConfig(triggerType),
                staleTime: 1000 * 60 * 10, // 10 minutes
              });

              toast.success(`Trigger verified: #${message.trigger_id}`);
              break;
            }

            case 'heartbeat':
              // Server is alive - also treat as healthy connection
              if (pongTimeoutRef.current) {
                clearTimeout(pongTimeoutRef.current);
                pongTimeoutRef.current = null;
              }
              setWsConnectionStatusRef.current('connected');
              break;

            case 'pong':
              // Clear pong timeout - connection is healthy
              if (pongTimeoutRef.current) {
                clearTimeout(pongTimeoutRef.current);
                pongTimeoutRef.current = null;
              }
              setLastPongTimestampRef.current(Date.now());
              setWsConnectionStatusRef.current('connected');
              break;

            case 'error':
              console.error(
                '[ExecutionSubscription] Server error:',
                message.message
              );
              toast.error(`Listener error: ${message.message}`);
              // Mark auth failure and close connection
              if (message.message?.toLowerCase().includes('authentication')) {
                authFailedRef.current = true;
                ws.close();
              }
              break;
          }
        } catch (error) {
          console.error(
            '[ExecutionSubscription] Failed to parse message:',
            error
          );
        }
      };

      ws.onerror = (error) => {
        console.error('[ExecutionSubscription] WebSocket error:', error);
        setWsConnectionStatusRef.current('unhealthy');
      };

      ws.onclose = (event) => {
        console.log(
          '[ExecutionSubscription] WebSocket closed:',
          event.code,
          event.reason
        );
        wsRef.current = null;
        stopPingInterval();
        setWsConnectionStatusRef.current('disconnected');

        // Don't reconnect on authentication failures
        if (
          event.code === 1008 ||
          event.reason?.toLowerCase().includes('auth') ||
          authFailedRef.current
        ) {
          console.error(
            '[ExecutionSubscription] Authentication failed - not reconnecting'
          );
          toast.error('Authentication failed for execution listener');
          authFailedRef.current = false; // Reset flag
          return;
        }

        // Clear any existing debounce timer
        if (debounceTimeoutRef.current) {
          clearTimeout(debounceTimeoutRef.current);
          debounceTimeoutRef.current = null;
        }

        // Clear any pending reconnect timer from previous debounce
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }

        // Debounced reconnection: wait for debounceDelay ms of inactivity before reconnecting
        const now = Date.now();
        lastCloseTimestampRef.current = now;

        console.log(
          `[ExecutionSubscription] Debouncing reconnection for ${debounceDelay}ms`
        );

        debounceTimeoutRef.current = setTimeout(() => {
          // Only reconnect if this is still the most recent close event
          if (lastCloseTimestampRef.current === now && enabled) {
            if (reconnectAttemptsRef.current < maxReconnectAttempts) {
              const delay =
                baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current);
              console.log(
                `[ExecutionSubscription] Reconnecting after debounce in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1}/${maxReconnectAttempts})`
              );

              reconnectTimeoutRef.current = setTimeout(() => {
                reconnectAttemptsRef.current++;
                connect();
              }, delay);
            } else {
              console.error(
                '[ExecutionSubscription] Max reconnection attempts reached'
              );
              toast.error('Lost connection to execution listener');
            }
          }
        }, debounceDelay);
      };
    } catch (error) {
      console.error(
        '[ExecutionSubscription] Failed to establish connection:',
        error
      );
      setWsConnectionStatusRef.current('disconnected');
    }
  }, [enabled, token, startPingInterval, stopPingInterval]); // Only depend on enabled and token - primitives that rarely change

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }

    stopPingInterval();

    if (wsRef.current) {
      console.log('[ExecutionSubscription] Disconnecting...');
      wsRef.current.close(1000, 'Client disconnect'); // Normal closure
      wsRef.current = null;
    }

    reconnectAttemptsRef.current = 0; // Reset reconnect attempts
    setWsConnectionStatusRef.current('disconnected');
  }, [stopPingInterval]);

  useEffect(() => {
    // Always disconnect first to prevent duplicate connections
    disconnect();

    if (enabled && token) {
      // Small delay to ensure previous connection is fully closed
      const connectTimer = setTimeout(() => {
        connect();
      }, 100);

      return () => {
        clearTimeout(connectTimer);
        disconnect();
      };
    }

    return () => {
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, token]); // Only reconnect when enabled or token changes

  // Manual reconnect function that fully disconnects and reconnects
  const manualReconnect = useCallback(() => {
    console.log('[ExecutionSubscription] Manual reconnect triggered');
    disconnect();
    // Small delay to ensure clean disconnect
    setTimeout(() => {
      connect();
    }, 200);
  }, [disconnect, connect]);

  // Register reconnect callback in store
  useEffect(() => {
    setWsReconnectCallback(manualReconnect);
    return () => {
      setWsReconnectCallback(null);
    };
  }, [manualReconnect, setWsReconnectCallback]);

  return {
    isConnected: wsRef.current?.readyState === WebSocket.OPEN,
    disconnect,
    reconnect: manualReconnect,
  };
}
