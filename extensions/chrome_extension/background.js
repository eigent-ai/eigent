// WebSocket connection
let ws = null;
let isConnected = false;
let serverUrl = 'ws://localhost:8765';
let fullVisionMode = false;

// Track whether an agent task is currently running (for overlay state recovery)
let isAgentTaskRunning = false;

// Auto-reconnect state
let intentionalDisconnect = false;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;
let reconnectTimer = null;
let keepAliveTimer = null;
let preferredWindowId = null;

function normalizeStreamText(text) {
  if (text == null) return '';
  if (typeof text !== 'string') text = String(text);
  const normalized = text.trim();
  if (!normalized) return '';
  if (normalized.toLowerCase() === 'null') return '';
  return text;
}

function getReconnectDelay() {
  return Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
}

function isControllableUrl(url) {
  if (!url) return false;
  return !(
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('edge://') ||
    url.startsWith('devtools://')
  );
}

async function getSyncableTabs(windowId = null) {
  let tabs;
  if (windowId != null) {
    tabs = await chrome.tabs.query({ windowId });
  } else {
    tabs = await chrome.tabs.query({ lastFocusedWindow: true });
  }

  return tabs
    .filter((tab) => tab.id != null && isControllableUrl(tab.url || ''))
    .map((tab) => ({
      tabId: tab.id,
      url: tab.url || '',
      title: tab.title || '',
      active: Boolean(tab.active),
    }));
}

async function syncWindowTabs(windowId = null) {
  const tabs = await getSyncableTabs(windowId);
  sendToServer({
    type: 'WINDOW_TABS_SYNC',
    tabs: tabs,
    windowId: windowId,
  });
  return tabs;
}

// Tab operation locks - prevent concurrent attach/detach races
const tabLocks = new Map();

async function withTabLock(tabId, fn) {
  // Wait for any existing lock on this tab
  while (tabLocks.has(tabId)) {
    await tabLocks.get(tabId);
  }
  let resolve;
  const lockPromise = new Promise((r) => {
    resolve = r;
  });
  tabLocks.set(tabId, lockPromise);
  try {
    return await fn();
  } finally {
    tabLocks.delete(tabId);
    resolve();
  }
}

// Multi-tab state: Map<tabId, { attached: boolean, cdpEnabled: boolean }>
const attachedTabs = new Map();

// Restore settings from chrome.storage on startup
chrome.storage.local.get(['serverUrl', 'fullVisionMode'], (result) => {
  if (result.serverUrl) serverUrl = result.serverUrl;
  if (result.fullVisionMode !== undefined)
    fullVisionMode = result.fullVisionMode;
});

// Listen for settings changes from sidepanel
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.serverUrl) serverUrl = changes.serverUrl.newValue;
  if (changes.fullVisionMode) fullVisionMode = changes.fullVisionMode.newValue;
});

// Open side panel when action button is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Enable side panel for all URLs
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error('Error setting panel behavior:', error));

// Connect to Python backend
function connect(url, windowId = null) {
  if (url) serverUrl = url;
  if (windowId != null) preferredWindowId = windowId;

  return new Promise((resolve, reject) => {
    try {
      ws = new WebSocket(serverUrl);

      ws.onopen = () => {
        console.log('Connected to backend server');
        isConnected = true;
        reconnectAttempts = 0;
        intentionalDisconnect = false;
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        // Keep service worker alive with periodic pings
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        keepAliveTimer = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'PING' }));
          }
        }, 20000);
        broadcastToPopup({ type: 'CONNECTION_STATUS', connected: true });
        syncWindowTabs(preferredWindowId).catch((error) => {
          console.error('Failed to sync tabs on connect:', error);
        });
        resolve({ success: true });
      };

      ws.onclose = () => {
        console.log('Disconnected from backend server');
        const wasConnected = isConnected;
        isConnected = false;
        ws = null;
        if (keepAliveTimer) {
          clearInterval(keepAliveTimer);
          keepAliveTimer = null;
        }
        broadcastToPopup({ type: 'CONNECTION_STATUS', connected: false });

        // Auto-reconnect if not intentional
        if (
          !intentionalDisconnect &&
          wasConnected &&
          reconnectAttempts < maxReconnectAttempts
        ) {
          const delay = getReconnectDelay();
          reconnectAttempts++;
          console.log(
            `Auto-reconnecting in ${delay}ms (attempt ${reconnectAttempts}/${maxReconnectAttempts})`
          );
          broadcastToPopup({
            type: 'CONNECTION_STATUS',
            connected: false,
            reconnecting: true,
            attempt: reconnectAttempts,
          });
          reconnectTimer = setTimeout(() => {
            connect().catch(() => {
              console.log('Reconnect attempt failed');
            });
          }, delay);
        } else if (reconnectAttempts >= maxReconnectAttempts) {
          console.log('Max reconnect attempts reached');
          broadcastToPopup({
            type: 'CONNECTION_STATUS',
            connected: false,
            reconnecting: false,
            failed: true,
          });
          reconnectAttempts = 0;
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        isConnected = false;
        reject({
          success: false,
          error:
            'Cannot connect to server. Make sure the Python backend is running.',
        });
      };

      ws.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);
          await handleServerMessage(message);
        } catch (e) {
          console.error('Error parsing message:', e);
        }
      };

      // Timeout for connection
      setTimeout(() => {
        if (!isConnected) {
          ws?.close();
          reject({ success: false, error: 'Connection timeout' });
        }
      }, 5000);
    } catch (error) {
      reject({ success: false, error: error.message });
    }
  });
}

// Disconnect from backend
function disconnect() {
  intentionalDisconnect = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
  reconnectAttempts = 0;
  if (ws) {
    ws.close();
    ws = null;
  }
  isConnected = false;
  detachAllDebuggers();
}

// Handle messages from server
async function handleServerMessage(message) {
  console.log('Received from server:', message);

  switch (message.type) {
    case 'LOG':
      broadcastToPopup({
        type: 'LOG',
        level: message.level || 'info',
        message: message.message,
      });
      break;

    case 'ACTION': {
      broadcastToPopup({
        type: 'ACTION',
        action: message.action,
        detail: message.detail,
      });
      const actionTabId = message.tabId || getDefaultTabId();
      const actionDetail = message.detail || '';
      const actionName = message.action || '';
      // Strip internal ref IDs (e.g. "ref=e171") from display text
      const cleanDetail = actionDetail
        .replace(/\bref=e\d+[,\s]*/gi, '')
        .replace(/^[,|\s]+|[,|\s]+$/g, '')
        .trim();
      // Forward human-readable summary to overlay: prefer action name,
      // append short detail if available
      let summaryText = actionName;
      if (cleanDetail && cleanDetail.length <= 40) {
        summaryText = summaryText
          ? `${summaryText}: ${cleanDetail}`
          : cleanDetail;
      }
      if (summaryText.length > 70) {
        summaryText = summaryText.slice(0, 67) + '...';
      }
      sendOverlayEvent(actionTabId, {
        type: 'OVERLAY_SUMMARY',
        text: summaryText || 'Working...',
      });
      // Extract element ref from detail (e.g. "ref=e46, text=...") and resolve via CDP
      const refMatch = actionDetail.match(/ref=(e\d+)/);
      if (refMatch && actionTabId) {
        resolveElementRect(refMatch[1], actionTabId).then((rect) => {
          if (rect) {
            sendOverlayEvent(actionTabId, {
              type: 'OVERLAY_CURSOR_MOVE',
              x: rect.cx,
              y: rect.cy,
            });
          }
        });
      }
      break;
    }

    case 'ACTION_COMPLETE':
      broadcastToPopup({
        type: 'ACTION_COMPLETE',
        success: message.success,
        result: message.result,
      });
      // Notify overlay that action is done
      sendOverlayEvent(message.tabId || getDefaultTabId(), {
        type: 'OVERLAY_AGENT_STEP',
        stepId: message.id || '',
        state: message.success ? 'done' : 'error',
        summary: message.success ? 'Done' : 'Action failed',
      });
      break;

    case 'CDP_COMMAND': {
      // Execute CDP command via chrome.debugger, routed by tabId
      const targetTabId = message.tabId || getDefaultTabId();
      try {
        // Highlight before this action — prefer overlay content script, fallback to CDP
        if (message.highlight && message.highlight.selector) {
          const overlayHighlighted = await sendOverlayEvent(targetTabId, {
            type: 'OVERLAY_HIGHLIGHT',
            selector: message.highlight.selector,
            duration: message.highlight.duration || 1500,
          });
          if (!overlayHighlighted) {
            // Fallback to CDP-injected highlight
            await highlightElement(
              message.highlight.selector,
              message.highlight.duration || 1500,
              targetTabId
            );
          }
          if (message.highlight.summary) {
            sendOverlayEvent(targetTabId, {
              type: 'OVERLAY_SUMMARY',
              text: message.highlight.summary,
            });
          }
          // Small delay to let user see the highlight
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Extract cursor position from CDP commands that have coordinates
        const params = message.params || {};
        const method = message.method || '';
        if (
          method === 'Input.dispatchMouseEvent' &&
          params.x != null &&
          params.y != null
        ) {
          if (params.type === 'mousePressed') {
            sendOverlayEvent(targetTabId, {
              type: 'OVERLAY_CURSOR_MOVE',
              x: params.x,
              y: params.y,
            });
            await new Promise((resolve) => setTimeout(resolve, 80));
          }
        }

        const result = await executeCdpCommand(method, params, targetTabId);

        // Send result back to server with tabId
        sendToServer({
          type: 'CDP_RESULT',
          id: message.id,
          result: result,
          tabId: targetTabId,
        });
      } catch (error) {
        sendToServer({
          type: 'CDP_ERROR',
          id: message.id,
          error: error.message,
          tabId: targetTabId,
        });
        // Only show errors to UI (skip routine CDP noise)
        broadcastToPopup({
          type: 'LOG',
          level: 'error',
          message: `Failed: ${message.method} - ${error.message}`,
        });
      }
      break;
    }

    case 'TAB_CREATE': {
      // Create a new tab, attach debugger, and respond
      try {
        const url = message.url || 'about:blank';
        const newTab = await chrome.tabs.create({ url, active: false });
        await attachDebugger(newTab.id);
        await enableCdpDomains(newTab.id);
        sendToServer({
          type: 'TAB_CREATED',
          id: message.id,
          tabId: newTab.id,
          url: newTab.url || url,
        });
        broadcastToPopup({
          type: 'LOG',
          level: 'success',
          message: `Created tab ${newTab.id}: ${url}`,
        });
      } catch (error) {
        sendToServer({
          type: 'TAB_CREATE_ERROR',
          id: message.id,
          error: error.message,
        });
        broadcastToPopup({
          type: 'LOG',
          level: 'error',
          message: `Failed to create tab: ${error.message}`,
        });
      }
      break;
    }

    case 'TAB_CLOSE': {
      // Close a specific tab
      try {
        const tabIdToClose = message.tabId;
        await detachDebuggerFromTab(tabIdToClose);
        await chrome.tabs.remove(tabIdToClose);
        sendToServer({
          type: 'TAB_CLOSED',
          id: message.id,
          tabId: tabIdToClose,
        });
        broadcastToPopup({
          type: 'LOG',
          level: 'info',
          message: `Closed tab ${tabIdToClose}`,
        });
      } catch (error) {
        sendToServer({
          type: 'TAB_CLOSE_ERROR',
          id: message.id,
          error: error.message,
        });
      }
      break;
    }

    case 'TASK_COMPLETE': {
      broadcastToPopup({
        type: 'TASK_COMPLETE',
        result: message.result,
      });
      // Hide all overlay — agent session ended
      isAgentTaskRunning = false;
      const completeTabId = message.tabId || getDefaultTabId();
      sendOverlayEvent(completeTabId, {
        type: 'OVERLAY_STATE',
        auroraVisible: false,
        cursorVisible: false,
        summaryText: '',
      });
      // Don't detach all tabs on task complete - let server manage tab lifecycle
      break;
    }

    case 'TASK_ERROR': {
      broadcastToPopup({
        type: 'TASK_ERROR',
        error: message.error,
      });
      // Hide all overlay — agent session ended with error
      isAgentTaskRunning = false;
      const errorTabId = message.tabId || getDefaultTabId();
      sendOverlayEvent(errorTabId, {
        type: 'OVERLAY_STATE',
        auroraVisible: false,
        cursorVisible: false,
        summaryText: '',
      });
      break;
    }

    case 'STREAM_TEXT':
      {
        const normalizedText = normalizeStreamText(message.text);
        if (!normalizedText) {
          break;
        }
        // Forward streaming text to popup
        broadcastToPopup({
          type: 'STREAM_TEXT',
          text: normalizedText,
        });
      }
      break;

    case 'STREAM_START':
      broadcastToPopup({
        type: 'STREAM_START',
      });
      break;

    case 'STREAM_END':
      broadcastToPopup({
        type: 'STREAM_END',
      });
      break;

    case 'DETACH':
      if (message.tabId) {
        detachDebuggerFromTab(message.tabId);
      } else {
        detachAllDebuggers();
      }
      break;

    case 'DEBUG_RESULT':
      // Forward debug result to popup
      broadcastToPopup({
        type: 'DEBUG_RESULT',
        success: message.success,
        result: message.result,
        error: message.error,
      });
      break;

    case 'REQUEST_ATTACH':
      // Server is requesting debugger attachment to active tab
      handleAttachRequest();
      break;

    case 'HIGHLIGHT': {
      // Resolve element position via CDP, move cursor there, then highlight
      const hlTabId = message.tabId || getDefaultTabId();
      try {
        // Resolve element rect in page main world
        const rect = await resolveElementRect(message.selector, hlTabId);
        if (rect) {
          // Move overlay cursor to element center
          sendOverlayEvent(hlTabId, {
            type: 'OVERLAY_CURSOR_MOVE',
            x: rect.cx,
            y: rect.cy,
          });
          // Show highlight rect via overlay
          sendOverlayEvent(hlTabId, {
            type: 'OVERLAY_HIGHLIGHT_RECT',
            rect: rect,
            duration: message.duration || 2000,
          });
        }
        // Also run the existing CDP highlight (red ring)
        await highlightElement(
          message.selector,
          message.duration || 2000,
          hlTabId
        );
        sendToServer({
          type: 'HIGHLIGHT_RESULT',
          id: message.id,
          success: true,
          tabId: hlTabId,
        });
      } catch (error) {
        console.error('Highlight failed:', error);
        sendToServer({
          type: 'HIGHLIGHT_RESULT',
          id: message.id,
          success: false,
          error: error.message,
          tabId: hlTabId,
        });
      }
      break;
    }
  }
}

// Get the first attached tab as default (backward compatibility)
function getDefaultTabId() {
  if (attachedTabs.size > 0) {
    return attachedTabs.keys().next().value;
  }
  return null;
}

// Enable CDP domains for a specific tab
async function enableCdpDomains(tabId) {
  const tabState = attachedTabs.get(tabId);
  if (tabState && tabState.cdpEnabled) {
    return;
  }
  await executeCdpCommand('Page.enable', {}, tabId);
  await executeCdpCommand('DOM.enable', {}, tabId);
  await executeCdpCommand('Runtime.enable', {}, tabId);
  if (tabState) {
    tabState.cdpEnabled = true;
  }
}

// Resolve element ref to bounding rect via CDP (runs in page main world)
// Returns { x, y, width, height, cx, cy } or null
async function resolveElementRect(selector, tabId) {
  const targetTabId = tabId || getDefaultTabId();
  if (!targetTabId) return null;

  const script = `
    (function() {
      const sel = ${JSON.stringify(selector)};
      let element = null;

      // Method 1: ariaSnapshot
      if (typeof __ariaSnapshot !== 'undefined' && __ariaSnapshot.getElementByRef) {
        try { element = __ariaSnapshot.getElementByRef(sel, document.body); } catch(e) {}
      }

      // Method 2: _ariaRef DOM walk
      if (!element) {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null, false);
        let node;
        while (node = walker.nextNode()) {
          if (node._ariaRef && node._ariaRef.ref === sel) { element = node; break; }
        }
      }

      // Method 3: data attributes
      if (!element) {
        const refNum = sel.replace(/^e/, '');
        const selectors = [
          '[data-ref="' + sel + '"]', '[data-ref="' + refNum + '"]',
          '[ref="' + sel + '"]', '[aria-ref="' + sel + '"]',
          '[data-camel-ref="' + sel + '"]', '[data-camel-ref="' + refNum + '"]'
        ];
        for (const s of selectors) {
          try { element = document.querySelector(s); if (element) break; } catch(e) {}
        }
      }

      // Method 4: CSS selector
      if (!element && (sel.includes('[') || sel.includes('.') || sel.includes('#'))) {
        try { element = document.querySelector(sel); } catch(e) {}
      }

      if (!element) return null;

      const rect = element.getBoundingClientRect();
      return {
        x: rect.left, y: rect.top, width: rect.width, height: rect.height,
        cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2
      };
    })();
  `;

  try {
    const result = await executeCdpCommand(
      'Runtime.evaluate',
      {
        expression: script,
        returnByValue: true,
      },
      targetTabId
    );

    if (result && result.result && result.result.value) {
      return result.result.value;
    }
  } catch (e) {
    console.log('resolveElementRect failed:', e.message);
  }
  return null;
}

// Highlight element on page with animation
// Uses resolveElementRect to find the element, then injects highlight visuals.
async function highlightElement(selector, duration = 600, tabId = null) {
  const targetTabId = tabId || getDefaultTabId();
  if (!targetTabId) return null;

  // Reuse shared element resolver
  const rect = await resolveElementRect(selector, targetTabId);
  if (!rect) return { found: false, selector, message: 'Element not found' };

  const highlightScript = `
    (function() {
      const rect = ${JSON.stringify(rect)};

      // Add animation keyframes if not exists
      if (!document.getElementById('__agent_highlight_styles__')) {
        const style = document.createElement('style');
        style.id = '__agent_highlight_styles__';
        style.textContent = \`
          @keyframes __agent_pulse__ {
            0% { box-shadow: 0 0 0 4px rgba(21, 93, 252, 1), 0 0 15px rgba(21, 93, 252, 0.7); }
            50% { box-shadow: 0 0 0 6px rgba(21, 93, 252, 0.7), 0 0 25px rgba(21, 93, 252, 0.5); }
            100% { box-shadow: 0 0 0 4px rgba(21, 93, 252, 1), 0 0 15px rgba(21, 93, 252, 0.7); }
          }
          @keyframes __agent_ripple__ {
            0% { transform: scale(0.8); opacity: 1; }
            100% { transform: scale(2); opacity: 0; }
          }
        \`;
        document.head.appendChild(style);
      }

      // Remove any existing overlays
      const existing = document.getElementById('__agent_highlight_overlay__');
      if (existing) existing.remove();
      const existingRipple = document.getElementById('__agent_ripple__');
      if (existingRipple) existingRipple.remove();

      // Create highlight overlay
      const overlay = document.createElement('div');
      overlay.id = '__agent_highlight_overlay__';
      overlay.style.cssText = \`
        position: fixed;
        top: \${rect.y - 8}px;
        left: \${rect.x - 8}px;
        width: \${rect.width + 16}px;
        height: \${rect.height + 16}px;
        border: 4px solid #155DFC;
        border-radius: 8px;
        background: rgba(21, 93, 252, 0.15);
        pointer-events: none;
        z-index: 2147483647;
        animation: __agent_pulse__ 0.2s ease-in-out infinite;
      \`;
      document.body.appendChild(overlay);

      // Add ripple effect
      const ripple = document.createElement('div');
      ripple.id = '__agent_ripple__';
      ripple.style.cssText = \`
        position: fixed;
        top: \${rect.cy - 25}px;
        left: \${rect.cx - 25}px;
        width: 50px;
        height: 50px;
        border: 3px solid #155DFC;
        border-radius: 50%;
        pointer-events: none;
        z-index: 2147483646;
        animation: __agent_ripple__ 0.3s ease-out forwards;
      \`;
      document.body.appendChild(ripple);

      // Auto remove after duration (fast)
      const dur = ${duration};
      setTimeout(() => {
        const ol = document.getElementById('__agent_highlight_overlay__');
        if (ol) {
          ol.style.transition = 'opacity 0.1s ease';
          ol.style.opacity = '0';
          setTimeout(() => ol.remove(), 100);
        }
      }, dur);

      setTimeout(() => {
        const rp = document.getElementById('__agent_ripple__');
        if (rp) rp.remove();
      }, 300);

      return { found: true, rect: rect };
    })();
  `;

  try {
    const result = await executeCdpCommand(
      'Runtime.evaluate',
      {
        expression: highlightScript,
        returnByValue: true,
      },
      targetTabId
    );
    return result;
  } catch (error) {
    console.error('Highlight CDP error:', error);
    return null;
  }
}

// Handle attach request from server
async function handleAttachRequest() {
  try {
    // Get current active tab
    let query = { active: true, currentWindow: true };
    if (preferredWindowId != null) {
      query = { active: true, windowId: preferredWindowId };
    }
    let [tab] = await chrome.tabs.query(query);
    if (!tab && preferredWindowId != null) {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    }
    if (!tab) {
      sendToServer({
        type: 'ATTACH_RESULT',
        success: false,
        error: 'No active tab found',
      });
      return;
    }

    // If current tab is a restricted page, navigate to about:blank first
    if (
      tab.url &&
      (tab.url.startsWith('chrome://') ||
        tab.url.startsWith('chrome-extension://') ||
        tab.url.startsWith('edge://') ||
        tab.url.startsWith('about:'))
    ) {
      await chrome.tabs.update(tab.id, { url: 'about:blank' });
      await new Promise((resolve) => {
        const listener = (id, changeInfo) => {
          if (id === tab.id && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }, 3000);
      });
    }

    // Attach debugger if not already attached to this tab
    if (!attachedTabs.has(tab.id) || !attachedTabs.get(tab.id).attached) {
      await attachDebugger(tab.id);
      await enableCdpDomains(tab.id);
    }

    sendToServer({
      type: 'ATTACH_RESULT',
      success: true,
      tabId: tab.id,
      url: tab.url,
    });

    broadcastToPopup({
      type: 'LOG',
      level: 'success',
      message: 'Debugger attached to: ' + tab.url,
    });
  } catch (error) {
    sendToServer({
      type: 'ATTACH_RESULT',
      success: false,
      error: error.message,
    });
    broadcastToPopup({
      type: 'LOG',
      level: 'error',
      message: 'Failed to attach debugger: ' + error.message,
    });
  }
}

// Execute CDP command routed to a specific tab
async function executeCdpCommand(method, params, tabId) {
  if (!tabId || !attachedTabs.has(tabId) || !attachedTabs.get(tabId).attached) {
    throw new Error(`Debugger not attached to tab ${tabId}`);
  }

  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId: tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

// Attach debugger to tab (supports multiple concurrent attachments)
async function attachDebugger(tabId) {
  return withTabLock(tabId, async () => {
    // Already attached to this tab
    if (attachedTabs.has(tabId) && attachedTabs.get(tabId).attached) {
      return true;
    }

    // Do NOT detach other tabs - support concurrent attachments
    return new Promise((resolve, reject) => {
      chrome.debugger.attach({ tabId: tabId }, '1.3', () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          attachedTabs.set(tabId, { attached: true, cdpEnabled: false });
          console.log(
            'Debugger attached to tab:',
            tabId,
            'Total attached:',
            attachedTabs.size
          );
          resolve(true);
        }
      });
    });
  });
}

// Detach debugger from a specific tab
async function detachDebuggerFromTab(tabId) {
  return withTabLock(tabId, async () => {
    if (!attachedTabs.has(tabId)) return;

    return new Promise((resolve) => {
      chrome.debugger.detach({ tabId: tabId }, () => {
        if (chrome.runtime.lastError) {
          console.log(
            'Detach error (may already be detached):',
            chrome.runtime.lastError.message
          );
        }
        attachedTabs.delete(tabId);
        console.log(
          'Debugger detached from tab:',
          tabId,
          'Remaining:',
          attachedTabs.size
        );
        resolve();
      });
    });
  });
}

// Detach debugger from all tabs
async function detachAllDebuggers() {
  const tabIds = [...attachedTabs.keys()];
  for (const tabId of tabIds) {
    await detachDebuggerFromTab(tabId);
  }
  console.log('All debuggers detached');
}

// Send message to server
function sendToServer(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// Broadcast message to popup
function broadcastToPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // Popup might be closed, ignore error
  });
}

// Send overlay event to content script on a specific tab
// Returns true if message was delivered, false if no content script listening
async function sendOverlayEvent(tabId, event) {
  if (!tabId) return false;
  try {
    await chrome.tabs.sendMessage(tabId, event);
    return true;
  } catch (e) {
    // Content script not injected on this tab (restricted page, etc.)
    return false;
  }
}

// Listen for debugger events - forward from ALL attached tabs
chrome.debugger.onEvent.addListener((source, method, params) => {
  if (attachedTabs.has(source.tabId)) {
    sendToServer({
      type: 'CDP_EVENT',
      method: method,
      params: params,
      tabId: source.tabId,
    });
  }
});

// Handle debugger detach - remove specific tab from map
chrome.debugger.onDetach.addListener((source, reason) => {
  if (attachedTabs.has(source.tabId)) {
    console.log('Debugger detached from tab:', source.tabId, 'reason:', reason);
    attachedTabs.delete(source.tabId);
    sendToServer({
      type: 'TAB_DETACHED',
      tabId: source.tabId,
      reason: reason,
    });
    broadcastToPopup({
      type: 'LOG',
      level: 'info',
      message: `Debugger detached from tab ${source.tabId}: ${reason}`,
    });
  }
});

// Message handler from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message from popup:', message);

  switch (message.type) {
    case 'OVERLAY_READY':
      // Content script reloaded (page navigation) — restore overlay state
      if (isAgentTaskRunning && sender.tab) {
        sendOverlayEvent(sender.tab.id, {
          type: 'OVERLAY_STATE',
          enabled: true,
          auroraVisible: true,
        });
      }
      break;

    case 'GET_STATUS':
      sendResponse({
        connected: isConnected,
        attachedTabs: attachedTabs.size,
      });
      break;

    case 'CONNECT':
      connect(message.serverUrl)
        .then((result) => sendResponse(result))
        .catch((error) => sendResponse(error));
      return true; // Keep channel open for async response

    case 'DISCONNECT':
      disconnect();
      sendResponse({ success: true });
      break;

    case 'EXECUTE_TASK':
      if (message.fullVisionMode !== undefined) {
        fullVisionMode = message.fullVisionMode;
      }
      executeTask(message.task, message.tabId, message.url)
        .then(() => sendResponse({ success: true }))
        .catch((error) =>
          sendResponse({ success: false, error: error.message })
        );
      return true;

    case 'STOP_TASK':
      sendToServer({ type: 'STOP_TASK' });
      isAgentTaskRunning = false;
      // Only detach the specific tab if provided, otherwise detach all
      if (message.tabId && attachedTabs.has(message.tabId)) {
        detachDebuggerFromTab(message.tabId);
      }
      sendResponse({ success: true });
      break;

    case 'CLEAR_CONTEXT':
      sendToServer({ type: 'CLEAR_CONTEXT' });
      sendResponse({ success: true });
      break;

    case 'SET_FULL_VISION':
      fullVisionMode = message.enabled;
      chrome.storage.local.set({ fullVisionMode });
      console.log('Full vision mode:', fullVisionMode);
      sendResponse({ success: true });
      break;

    case 'DEBUG_COMMAND':
      executeDebugCommand(message.command, message.tabId, message.url)
        .then(() => sendResponse({ success: true }))
        .catch((error) =>
          sendResponse({ success: false, error: error.message })
        );
      return true;
  }
});

// Execute debug command
async function executeDebugCommand(command, tabId, url) {
  try {
    // Attach debugger if not already attached
    if (!attachedTabs.has(tabId) || !attachedTabs.get(tabId).attached) {
      await attachDebugger(tabId);
      await enableCdpDomains(tabId);
    }

    // Send debug command to server
    sendToServer({
      type: 'DEBUG_COMMAND',
      command: command,
      url: url,
      tabId: tabId,
    });
  } catch (error) {
    broadcastToPopup({
      type: 'DEBUG_RESULT',
      success: false,
      error: error.message,
    });
    throw error;
  }
}

// Navigation re-attach: re-enable CDP after page navigation
chrome.webNavigation.onCompleted.addListener(async (details) => {
  // Only main frame, only tabs we have debugger attached to
  if (details.frameId !== 0) return;
  const tabState = attachedTabs.get(details.tabId);
  if (!tabState || !tabState.attached) return;

  // Skip restricted pages
  if (
    details.url &&
    (details.url.startsWith('chrome://') ||
      details.url.startsWith('chrome-extension://') ||
      details.url.startsWith('edge://'))
  ) {
    return;
  }

  console.log(
    'Navigation completed on attached tab:',
    details.tabId,
    details.url
  );
  // Small delay to let the page settle
  await new Promise((r) => setTimeout(r, 500));

  // Re-enable CDP domains (debugger stays attached, but domains may reset)
  try {
    tabState.cdpEnabled = false;
    await enableCdpDomains(details.tabId);
    console.log(
      'CDP domains re-enabled after navigation on tab:',
      details.tabId
    );
  } catch (e) {
    console.log('Failed to re-enable CDP after navigation:', e.message);
  }
});

// Execute task
async function executeTask(task, tabId, url) {
  try {
    // If current tab is a restricted page, navigate to about:blank first
    if (
      url &&
      (url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('edge://') ||
        url.startsWith('about:'))
    ) {
      await chrome.tabs.update(tabId, { url: 'about:blank' });
      // Wait for navigation to complete
      await new Promise((resolve) => {
        const listener = (id, changeInfo) => {
          if (id === tabId && changeInfo.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }, 3000);
      });
      url = 'about:blank';
    }

    // Attach debugger to the tab (only if not already attached)
    if (!attachedTabs.has(tabId) || !attachedTabs.get(tabId).attached) {
      await attachDebugger(tabId);

      // Enable necessary CDP domains
      await enableCdpDomains(tabId);
    }

    // Send task to server
    broadcastToPopup({
      type: 'LOG',
      level: 'info',
      message: 'Sending task to AI...',
    });

    // Show aurora overlay — agent session started
    isAgentTaskRunning = true;
    sendOverlayEvent(tabId, {
      type: 'OVERLAY_STATE',
      enabled: true,
      auroraVisible: true,
    });

    sendToServer({
      type: 'START_TASK',
      task: task,
      url: url,
      tabId: tabId,
      fullVisionMode: fullVisionMode,
    });
  } catch (error) {
    broadcastToPopup({
      type: 'TASK_ERROR',
      error: error.message,
    });
    throw error;
  }
}
