import { useEffect, useRef, useCallback } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useActivityLogStore, ActivityType } from '@/store/activityLogStore';
import { useTriggerStore, WebSocketConnectionStatus } from '@/store/triggerStore';
import { queryClient, queryKeys } from '@/lib/queryClient';
import { proxyFetchTriggerConfig } from '@/service/triggerApi';
import { TriggerType } from '@/types';
import { toast } from 'sonner';

// Ping interval: send ping every 5 minutes
const PING_INTERVAL = 60 * 5 * 1000;
// Pong timeout: if no pong received within 10 seconds after ping, mark as unhealthy
const PONG_TIMEOUT = 10 * 1000;

interface ExecutionCreatedMessage {
    type: 'execution_created';
    execution_id: string;
    trigger_id: number;
    trigger_type: 'webhook' | 'schedule';
    status: string;
    execution_type: 'webhook' | 'schedule';
    input_data: any;
    user_id: number;
    project_id: string;
    timestamp: string;
}

interface ExecutionUpdatedMessage {
    type: 'execution_updated';
    execution_id: string;
    trigger_id: number;
    status: 'completed' | 'failed' | 'running';
    updated_fields: string[];
    user_id: number;
    project_id: string;
    timestamp: string;
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
    const maxReconnectAttempts = 5;
    const baseReconnectDelay = 1000;

    const { token } = useAuthStore();
    const { addLog } = useActivityLogStore();
    const { emitWebSocketEvent, triggers, setWsConnectionStatus, setLastPongTimestamp, setWsReconnectCallback } = useTriggerStore();

    // Store latest values in refs to avoid recreating connect function
    const triggersRef = useRef(triggers);
    const addLogRef = useRef(addLog);
    const emitWebSocketEventRef = useRef(emitWebSocketEvent);
    const setWsConnectionStatusRef = useRef(setWsConnectionStatus);
    const setLastPongTimestampRef = useRef(setLastPongTimestamp);

    // Update refs on every render
    useEffect(() => {
        triggersRef.current = triggers;
        addLogRef.current = addLog;
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
                    console.warn('[ExecutionSubscription] No pong received, marking connection as unhealthy');
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
        if (wsRef.current && (wsRef.current.readyState === WebSocket.CONNECTING || wsRef.current.readyState === WebSocket.OPEN)) {
            console.log('[ExecutionSubscription] Connection already exists (state:', wsRef.current.readyState, '), skipping');
            return;
        }

        if (!enabled || !token) {
            console.log('[ExecutionSubscription] Skipping connection - enabled:', enabled, 'hasToken:', !!token);
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
            const wsURL = baseURL.replace(/^https?:\/\//, '');  // Remove protocol
            const fullURL = `${wsProtocol}://${wsURL}/api/execution/subscribe`;

            console.log('[ExecutionSubscription] Connecting to:', fullURL);
            
            const ws = new WebSocket(fullURL);
            wsRef.current = ws;

            ws.onopen = () => {
                console.log('[ExecutionSubscription] WebSocket connected');
                reconnectAttemptsRef.current = 0;

                // Send subscription message - server expects token WITHOUT "Bearer" prefix
                const subscribeMessage = {
                    type: 'subscribe',
                    session_id: sessionIdRef.current,
                    auth_token: token  // ⚠️ Remove "Bearer " prefix
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
                            console.log(`[ExecutionSubscription] Connected with session: ${message.session_id}`);
                            setWsConnectionStatusRef.current('connected');
                            toast.success('Connected to execution listener');
                            break;

                        case 'execution_created': {
                            // Use ref to access latest triggers without adding to dependencies
                            const trigger = triggersRef.current.find(t => t.id === message.trigger_id);
                            const triggerName = trigger?.name || `Trigger #${message.trigger_id}`;
                            
                            console.log(`[ExecutionSubscription] Execution created: ${message.execution_id}`);
                            
                            // Send acknowledgment immediately
                            if (ws.readyState === WebSocket.OPEN) {
                                ws.send(JSON.stringify({
                                    type: 'ack',
                                    execution_id: message.execution_id
                                }));
                            }

                            addLogRef.current({
                                type: ActivityType.TriggerExecuted,
                                message: `"${triggerName}" execution started`,
                                triggerId: message.trigger_id,
                                triggerName: triggerName,
                                executionId: message.execution_id,
                            });

                            if (trigger) {
                                // Emit WebSocket event with full context for task execution
                                emitWebSocketEventRef.current({
                                    triggerId: message.trigger_id,
                                    triggerName: triggerName,
                                    taskPrompt: trigger.task_prompt || '',
                                    executionId: message.execution_id,
                                    timestamp: Date.now(),
                                    // New fields for programmatic task execution
                                    triggerType: message.execution_type || 'webhook',
                                    projectId: message.project_id, // Future: triggers will be associated with projects
                                    inputData: message.input_data || {},
                                });
                            }
                            break;
                        }

                        case 'ack_confirmed':
                            console.log(`[ExecutionSubscription] ACK confirmed for: ${message.execution_id}`);
                            break;

                        case 'execution_updated': {
                            // Use ref to access latest triggers without adding to dependencies
                            const trigger = triggersRef.current.find(t => t.id === message.trigger_id);
                            const triggerName = trigger?.name || `Trigger #${message.trigger_id}`;
                            
                            console.log(`[ExecutionSubscription] Execution updated: ${message.execution_id} - ${message.status}`);
                            
                            if (message.status === 'completed') {
                                addLogRef.current({
                                    type: ActivityType.ExecutionSuccess,
                                    message: `"${triggerName}" execution completed`,
                                    triggerId: message.trigger_id,
                                    triggerName: triggerName,
                                    executionId: message.execution_id,
                                });
                                toast.success(`Execution completed: ${triggerName}`);
                            } else if (message.status === 'failed') {
                                addLogRef.current({
                                    type: ActivityType.ExecutionFailed,
                                    message: `"${triggerName}" execution failed`,
                                    triggerId: message.trigger_id,
                                    triggerName: triggerName,
                                    executionId: message.execution_id,
                                });
                                toast.error(`Execution failed: ${triggerName}`);
                            }
                            break;
                        }

                        case 'project_created':
                            console.log(`[ExecutionSubscription] Project created: ${message.project_id} - ${message.project_name}`);
                            break;

                        case 'trigger_activated': {
                            console.log(`[ExecutionSubscription] Trigger activated: ${message.trigger_id}`);
                            
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
                            console.error('[ExecutionSubscription] Server error:', message.message);
                            toast.error(`Listener error: ${message.message}`);
                            // Close and reconnect on auth errors
                            if (message.message?.includes('Authentication')) {
                                ws.close();
                            }
                            break;
                    }
                } catch (error) {
                    console.error('[ExecutionSubscription] Failed to parse message:', error);
                }
            };

            ws.onerror = (error) => {
                console.error('[ExecutionSubscription] WebSocket error:', error);
                setWsConnectionStatusRef.current('unhealthy');
            };

            ws.onclose = (event) => {
                console.log('[ExecutionSubscription] WebSocket closed:', event.code, event.reason);
                wsRef.current = null;
                stopPingInterval();
                setWsConnectionStatusRef.current('disconnected');

                // Don't reconnect on authentication failures (code 1008)
                if (event.code === 1008) {
                    console.error('[ExecutionSubscription] Authentication failed - not reconnecting');
                    toast.error('Authentication failed for execution listener');
                    return;
                }

                // Attempt reconnection with exponential backoff
                if (enabled && reconnectAttemptsRef.current < maxReconnectAttempts) {
                    const delay = baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current);
                    console.log(`[ExecutionSubscription] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1}/${maxReconnectAttempts})`);
                    
                    reconnectTimeoutRef.current = setTimeout(() => {
                        reconnectAttemptsRef.current++;
                        connect();
                    }, delay);
                } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
                    console.error('[ExecutionSubscription] Max reconnection attempts reached');
                    toast.error('Lost connection to execution listener');
                }
            };
        } catch (error) {
            console.error('[ExecutionSubscription] Failed to establish connection:', error);
            setWsConnectionStatusRef.current('disconnected');
        }
    }, [enabled, token, startPingInterval, stopPingInterval]); // Only depend on enabled and token - primitives that rarely change

    const disconnect = useCallback(() => {
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
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
        reconnect: manualReconnect
    };
}
