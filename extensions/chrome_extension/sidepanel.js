// State
let isConnected = false;
let currentTabId = null;
let currentTabUrl = '';
let currentWindowId = null;
let isDebugMode = false;
let fullVisionMode = false;
let isTaskRunning = false;
let actionJustCompleted = false;

// Message queue - queue messages while task is running
let messageQueue = [];

// Output truncation
const MAX_OUTPUT_LENGTH = 120000;
function truncateOutput(text, maxLen = MAX_OUTPUT_LENGTH) {
  if (typeof text !== 'string') return text;
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + '...[truncated]';
}

function normalizeStreamText(text) {
  if (text == null) return '';
  if (typeof text !== 'string') text = String(text);
  const normalized = text.trim();
  if (!normalized) return '';
  if (normalized.toLowerCase() === 'null') return '';
  return text;
}

// Check if a character is CJK (Chinese/Japanese/Korean)
function isCJK(ch) {
  if (!ch) return false;
  const code = ch.codePointAt(0);
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||   // CJK Unified Ideographs
    (code >= 0x3400 && code <= 0x4dbf) ||   // CJK Extension A
    (code >= 0x3000 && code <= 0x303f) ||   // CJK Punctuation
    (code >= 0xff00 && code <= 0xffef) ||   // Fullwidth Forms
    (code >= 0x3040 && code <= 0x309f) ||   // Hiragana
    (code >= 0x30a0 && code <= 0x30ff) ||   // Katakana
    (code >= 0xac00 && code <= 0xd7af)      // Hangul
  );
}

// Check if text ends with a natural break point
function endsWithBreak(text) {
  if (!text) return false;
  const trimmed = text.trimEnd();
  if (!trimmed) return false;
  const last = trimmed.slice(-1);
  return /[.!?。！？\n:：;；)\]}>）】」』]/.test(last);
}

function shouldInsertChunkSpacer(_existingText, _nextText) {
  // Streaming chunks already contain correct spacing;
  // inserting extra spaces breaks words mid-stream (e.g. "wea" + "ther").
  return false;
}

function appendChunkText(target, text) {
  if (!target || !text) return;
  const currentText = target.dataset.rawText || '';
  let nextText = text;
  if (currentText && actionJustCompleted && !text.startsWith('\n') && endsWithBreak(currentText)) {
    nextText = `\n\n${text}`;
  } else if (currentText && shouldInsertChunkSpacer(currentText, text)) {
    nextText = ` ${text}`;
  }
  const combinedText = currentText + nextText;
  target.dataset.rawText = combinedText;
  target.innerHTML = renderMarkdown(combinedText);
  actionJustCompleted = false;
}

function sanitizeMarkdownUrl(url) {
  if (!url) return '';
  const trimmed = url.trim();
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) {
    return trimmed;
  }
  return '';
}

function renderInlineMarkdown(text) {
  if (!text) return '';

  const codeSpans = [];
  let html = escapeHtml(text);

  html = html.replace(/`([^`]+)`/g, (_match, code) => {
    const placeholder = `__CODE_SPAN_${codeSpans.length}__`;
    codeSpans.push(`<code>${code}</code>`);
    return placeholder;
  });

  html = html.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_match, label, url) => {
      const safeUrl = sanitizeMarkdownUrl(url);
      if (!safeUrl) return escapeHtml(label);
      return `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer noopener">${label}</a>`;
    }
  );

  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  codeSpans.forEach((codeHtml, index) => {
    html = html.replace(`__CODE_SPAN_${index}__`, codeHtml);
  });

  return html;
}

function renderMarkdown(text) {
  if (!text) return '';

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const htmlParts = [];
  let paragraphLines = [];
  let listItems = [];
  let listType = null;
  let inCodeBlock = false;
  let codeLines = [];

  function flushParagraph() {
    if (!paragraphLines.length) return;
    const paragraphText = paragraphLines.join(' ').trim();
    if (paragraphText) {
      htmlParts.push(`<p>${renderInlineMarkdown(paragraphText)}</p>`);
    }
    paragraphLines = [];
  }

  function flushList() {
    if (!listItems.length || !listType) return;
    const itemsHtml = listItems
      .map((item) => `<li>${renderInlineMarkdown(item)}</li>`)
      .join('');
    htmlParts.push(`<${listType}>${itemsHtml}</${listType}>`);
    listItems = [];
    listType = null;
  }

  function flushCodeBlock() {
    if (!codeLines.length) return;
    htmlParts.push(
      `<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`
    );
    codeLines = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (/^\s*```/.test(line)) {
      flushParagraph();
      flushList();
      if (inCodeBlock) {
        flushCodeBlock();
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(rawLine);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      htmlParts.push(
        `<h${level}>${renderInlineMarkdown(headingMatch[2].trim())}</h${level}>`
      );
      continue;
    }

    const unorderedMatch = line.match(/^[-*+]\s+(.*)$/);
    if (unorderedMatch) {
      flushParagraph();
      if (listType && listType !== 'ul') {
        flushList();
      }
      listType = 'ul';
      listItems.push(unorderedMatch[1].trim());
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      flushParagraph();
      if (listType && listType !== 'ol') {
        flushList();
      }
      listType = 'ol';
      listItems.push(orderedMatch[1].trim());
      continue;
    }

    flushList();
    paragraphLines.push(line.trim());
  }

  if (inCodeBlock) {
    flushCodeBlock();
  }
  flushParagraph();
  flushList();

  return htmlParts.join('');
}

// DOM Elements
const settingsPanel = document.getElementById('settingsPanel');
const settingsBtn = document.getElementById('settingsBtn');
const closeSettings = document.getElementById('closeSettings');
const clearBtn = document.getElementById('clearBtn');
const connectBtn = document.getElementById('connectBtn');
const connectionDot = document.getElementById('connectionDot');
const connectionText = document.getElementById('connectionText');
const serverUrlInput = document.getElementById('serverUrl');
const currentPageUrl = document.getElementById('currentPageUrl');
const messagesContainer = document.getElementById('messagesContainer');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const statusHint = document.getElementById('statusHint');
const debugModeToggle = document.getElementById('debugModeToggle');
const debugPanel = document.getElementById('debugPanel');
const closeDebug = document.getElementById('closeDebug');
const debugInput = document.getElementById('debugInput');
const debugSendBtn = document.getElementById('debugSendBtn');
const debugOutput = document.getElementById('debugOutput');
const fullVisionToggle = document.getElementById('fullVisionToggle');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await updateCurrentTab();

  // Restore settings from chrome.storage
  chrome.storage.local.get(
    ['serverUrl', 'fullVisionMode', 'debugMode'],
    (result) => {
      if (result.serverUrl && serverUrlInput) {
        serverUrlInput.value = result.serverUrl;
      }
      if (result.fullVisionMode !== undefined && fullVisionToggle) {
        fullVisionMode = result.fullVisionMode;
        fullVisionToggle.checked = fullVisionMode;
      }
      if (result.debugMode !== undefined && debugModeToggle) {
        isDebugMode = result.debugMode;
        debugModeToggle.checked = isDebugMode;
        if (isDebugMode) debugPanel.classList.remove('hidden');
      }
    }
  );

  // Listen for tab changes
  chrome.tabs.onActivated.addListener(updateCurrentTab);
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) updateCurrentTab();
  });

  // Check connection status
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (response && response.connected) {
      updateConnectionStatus(true);
    }
  });

  // Listen for messages from background
  chrome.runtime.onMessage.addListener(handleBackgroundMessage);

  // Setup event listeners
  setupEventListeners();
});

async function updateCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    currentTabId = tab.id;
    currentTabUrl = tab.url;
    currentWindowId = tab.windowId;
    currentPageUrl.textContent = tab.url;
    currentPageUrl.title = tab.url;
  }
}

function setupEventListeners() {
  // Settings toggle
  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.remove('hidden');
  });

  closeSettings.addEventListener('click', () => {
    settingsPanel.classList.add('hidden');
  });

  // Clear chat
  clearBtn.addEventListener('click', clearChat);

  // Connect button
  connectBtn.addEventListener('click', handleConnect);

  // Send message
  sendBtn.addEventListener('click', sendMessage);
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea
  messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 80) + 'px';
    updateSendButton();
  });

  // Suggestion chips
  document.querySelectorAll('.suggestion-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      messageInput.value = chip.dataset.text;
      updateSendButton();
      messageInput.focus();
    });
  });

  // Full vision mode toggle
  fullVisionToggle.addEventListener('change', (e) => {
    fullVisionMode = e.target.checked;
    chrome.storage.local.set({ fullVisionMode });
    chrome.runtime.sendMessage({
      type: 'SET_FULL_VISION',
      enabled: fullVisionMode,
    });
  });

  // Debug mode toggle
  debugModeToggle.addEventListener('change', (e) => {
    isDebugMode = e.target.checked;
    chrome.storage.local.set({ debugMode: isDebugMode });
    if (isDebugMode) {
      debugPanel.classList.remove('hidden');
      settingsPanel.classList.add('hidden');
    } else {
      debugPanel.classList.add('hidden');
    }
  });

  // Close debug panel
  closeDebug.addEventListener('click', () => {
    debugPanel.classList.add('hidden');
    isDebugMode = false;
    debugModeToggle.checked = false;
  });

  // Debug command input
  debugSendBtn.addEventListener('click', sendDebugCommand);
  debugInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendDebugCommand();
    }
  });
}

async function handleConnect() {
  if (isConnected) {
    chrome.runtime.sendMessage({ type: 'DISCONNECT' });
    updateConnectionStatus(false);
  } else {
    connectBtn.textContent = 'Connecting...';
    connectBtn.disabled = true;

    const urlToConnect = serverUrlInput.value;
    chrome.storage.local.set({ serverUrl: urlToConnect });
    chrome.runtime.sendMessage(
      {
        type: 'CONNECT',
        serverUrl: urlToConnect,
        windowId: currentWindowId,
      },
      (response) => {
        connectBtn.disabled = false;

        if (response && response.success) {
          updateConnectionStatus(true);
        } else {
          updateConnectionStatus(false);
          showSystemMessage(
            'Connection failed: ' + (response?.error || 'Unknown error'),
            'error'
          );
        }
      }
    );
  }
}

function updateConnectionStatus(connected) {
  isConnected = connected;

  // Update settings panel
  connectionDot.classList.toggle('connected', connected);
  connectionText.textContent = connected ? 'Connected' : 'Disconnected';
  connectBtn.textContent = connected ? 'Disconnect' : 'Connect';
  connectBtn.classList.toggle('connected', connected);

  // Update status hint
  statusHint.classList.toggle('connected', connected);
  statusHint.querySelector('.hint-text').textContent = connected
    ? 'Connected'
    : 'Not connected';

  updateSendButton();
}

function updateSendButton() {
  if (isTaskRunning) {
    const hasText = messageInput.value.trim().length > 0;
    // Keep input enabled for queueing
    messageInput.disabled = false;

    if (hasText) {
      // Show send icon (will queue the message)
      sendBtn.classList.remove('stop-mode');
      sendBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="22" y1="2" x2="11" y2="13"/>
          <polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      `;
      sendBtn.disabled = !isConnected;
    } else {
      // Show stop icon when no text
      sendBtn.disabled = false;
      sendBtn.classList.add('stop-mode');
      sendBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <rect x="6" y="6" width="12" height="12" rx="2"/>
        </svg>
      `;
    }

    // Show queue badge
    updateQueueBadge();
  } else {
    sendBtn.classList.remove('stop-mode');
    sendBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="22" y1="2" x2="11" y2="13"/>
        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>
    `;
    messageInput.disabled = false;
    const hasText = messageInput.value.trim().length > 0;
    sendBtn.disabled = !hasText || !isConnected;
    updateQueueBadge();
  }
}

function updateQueueBadge() {
  let badge = document.getElementById('queueBadge');
  if (messageQueue.length > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'queueBadge';
      badge.style.cssText =
        'position:absolute;top:-6px;right:-6px;background:var(--primary);color:white;border-radius:50%;width:18px;height:18px;font-size:11px;display:flex;align-items:center;justify-content:center;font-weight:600;';
      sendBtn.style.position = 'relative';
      sendBtn.appendChild(badge);
    }
    badge.textContent = messageQueue.length;
  } else if (badge) {
    badge.remove();
  }
}

function setTaskRunning(running) {
  isTaskRunning = running;
  updateSendButton();
}

async function sendMessage() {
  const text = messageInput.value.trim();

  // If task is running
  if (isTaskRunning) {
    if (text) {
      // Queue the message
      messageQueue.push(text);
      messageInput.value = '';
      messageInput.style.height = 'auto';
      showSystemMessage(
        `Message queued (${messageQueue.length} in queue)`,
        'info'
      );
      updateSendButton();
      return;
    } else {
      // No text = stop task (stop button)
      chrome.runtime.sendMessage({ type: 'STOP_TASK', tabId: currentTabId });
      setTaskRunning(false);
      messageQueue = []; // Clear queue on stop
      completeAgentMessage('Task stopped by user.');
      updateSendButton();
      return;
    }
  }

  if (!text || !isConnected) return;

  await executeMessage(text);
}

async function executeMessage(text) {
  // Update current tab info before sending
  await updateCurrentTab();

  // Clear input
  messageInput.value = '';
  messageInput.style.height = 'auto';

  // Set task running
  setTaskRunning(true);

  // Hide welcome message
  const welcome = messagesContainer.querySelector('.welcome-message');
  if (welcome) welcome.remove();

  // Add user message
  addMessage('user', text);

  // Add agent response placeholder
  addAgentMessage();

  // Send to background
  chrome.runtime.sendMessage({
    type: 'EXECUTE_TASK',
    task: text,
    tabId: currentTabId,
    url: currentTabUrl,
    windowId: currentWindowId,
    fullVisionMode: fullVisionMode,
  });
}

// Process next message in queue
function processMessageQueue() {
  if (messageQueue.length > 0 && !isTaskRunning && isConnected) {
    const nextMessage = messageQueue.shift();
    updateQueueBadge();
    executeMessage(nextMessage);
  }
}

function addMessage(type, text) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `message message-${type}`;
  msgDiv.innerHTML = `
    <div class="message-content">
      <div class="message-text">${escapeHtml(text)}</div>
    </div>
  `;
  messagesContainer.appendChild(msgDiv);
  scrollToBottom();
  return msgDiv;
}

function addAgentMessage() {
  const msgId = 'agent-msg-' + Date.now();
  const msgDiv = document.createElement('div');
  msgDiv.className = 'message message-agent';
  msgDiv.id = msgId;
  msgDiv.innerHTML = `
    <div class="message-content">
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
      <div class="actions-container">
        <div class="actions-header">
          <div class="actions-header-left">
            <div class="actions-status-icon running">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
              </svg>
            </div>
            <span class="actions-title">Running Actions</span>
            <span class="actions-count">(0)</span>
          </div>
          <div class="actions-toggle">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>
        </div>
        <div class="current-action-display"></div>
        <div class="actions-body">
          <div class="actions-list"></div>
        </div>
      </div>
      <div class="response-shell">
        <div class="response-label">Agent Response</div>
        <div class="streaming-text"></div>
      </div>
    </div>
  `;
  messagesContainer.appendChild(msgDiv);

  // Add click listener for expand/collapse
  const header = msgDiv.querySelector('.actions-header');
  header.addEventListener('click', () => {
    const container = header.closest('.actions-container');
    container.classList.toggle('expanded');
  });

  // Store action count
  msgDiv.actionCount = 0;

  scrollToBottom();
  return msgId;
}

function addActionStep(action, status = 'running') {
  const msgDiv = document.querySelector('.message-agent:last-child');
  if (!msgDiv) return null;

  const actionsContainer = msgDiv.querySelector('.actions-container');
  const actionsList = msgDiv.querySelector('.actions-list');
  const currentActionDisplay = msgDiv.querySelector('.current-action-display');
  const typingIndicator = msgDiv.querySelector('.typing-indicator');

  // Hide typing indicator
  if (typingIndicator) typingIndicator.style.display = 'none';

  // Show actions container
  if (actionsContainer) {
    actionsContainer.style.display = 'block';
  }

  const stepId = 'step-' + Date.now();
  const actionData =
    typeof action === 'string'
      ? { name: action, detail: '' }
      : {
          name: action?.name || action?.action || 'Tool Action',
          detail: action?.detail || '',
        };
  const actionName = escapeHtml(actionData.name);
  const actionDetail = escapeHtml(actionData.detail);
  const actionTime = new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // Create action step for the expanded list
  const stepDiv = document.createElement('div');
  stepDiv.className = 'action-step';
  stepDiv.id = stepId;
  stepDiv.innerHTML = `
    <div class="action-icon ${status}">
      ${getStatusIcon(status)}
    </div>
    <div class="action-info">
      <div class="action-name-row">
        <div class="action-name">${actionName}</div>
        <span class="action-time">${actionTime}</span>
      </div>
      ${actionDetail ? `<div class="action-detail">${actionDetail}</div>` : ''}
    </div>
  `;
  actionsList.appendChild(stepDiv);

  // Update action count
  msgDiv.actionCount = (msgDiv.actionCount || 0) + 1;
  const countSpan = msgDiv.querySelector('.actions-count');
  if (countSpan) {
    countSpan.textContent = `(${msgDiv.actionCount})`;
  }

  // Update current action display with animation (only when collapsed)
  if (currentActionDisplay) {
    // Get previous action if exists
    const prevAction = currentActionDisplay.querySelector('.current-action');

    if (prevAction) {
      // Move previous to fade out
      prevAction.classList.remove('current-action');
      prevAction.classList.add('previous-action');

      // Remove after animation
      setTimeout(() => prevAction.remove(), 300);
    }

    // Add new current action
    const newAction = document.createElement('div');
    newAction.className = 'current-action';
    newAction.innerHTML = `
      <div class="current-action-icon ${status}">
        ${getStatusIcon(status)}
      </div>
      <div class="current-action-copy">
        <span class="current-action-text">${actionName}</span>
        ${actionDetail ? `<span class="current-action-subtext">${actionDetail}</span>` : ''}
      </div>
    `;
    newAction.dataset.stepId = stepId;
    currentActionDisplay.appendChild(newAction);
  }

  // Update header status icon
  updateActionsHeaderStatus(msgDiv, status);

  scrollToBottom();
  return stepId;
}

function updateActionStep(stepId, status) {
  const stepDiv = document.getElementById(stepId);
  if (!stepDiv) return;

  // Update in actions list
  const iconDiv = stepDiv.querySelector('.action-icon');
  iconDiv.className = `action-icon ${status}`;
  iconDiv.innerHTML = getStatusIcon(status);

  // Update in current action display if this is the current one
  const msgDiv = stepDiv.closest('.message-agent');
  if (msgDiv) {
    const currentAction = msgDiv.querySelector(
      `.current-action[data-step-id="${stepId}"]`
    );
    if (currentAction) {
      const currentIcon = currentAction.querySelector('.current-action-icon');
      if (currentIcon) {
        currentIcon.className = `current-action-icon ${status}`;
        currentIcon.innerHTML = getStatusIcon(status);
      }
    }

    // Update header status based on overall state
    updateActionsHeaderStatus(msgDiv, status);
  }
}

// Update the actions header status icon
function updateActionsHeaderStatus(msgDiv, _latestStatus) {
  const statusIcon = msgDiv.querySelector('.actions-status-icon');
  const titleSpan = msgDiv.querySelector('.actions-title');

  if (!statusIcon) return;

  // Check if any action is still running
  const runningActions = msgDiv.querySelectorAll('.action-icon.running');
  const hasRunning = runningActions.length > 0;

  // Check for errors
  const errorActions = msgDiv.querySelectorAll('.action-icon.error');
  const hasError = errorActions.length > 0;

  let overallStatus = 'success';
  let title = 'Actions Complete';

  if (hasRunning) {
    overallStatus = 'running';
    title = 'Running Actions';
  } else if (hasError) {
    overallStatus = 'error';
    title = 'Actions (with errors)';
  }

  statusIcon.className = `actions-status-icon ${overallStatus}`;
  statusIcon.innerHTML = getHeaderStatusIcon(overallStatus);

  if (titleSpan) {
    titleSpan.textContent = title;
  }
}

// Get status icon for header
function getHeaderStatusIcon(status) {
  switch (status) {
    case 'running':
      return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>';
    case 'success':
      return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
    case 'error':
      return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    default:
      return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>';
  }
}

// Append streaming text to the current agent message
function appendStreamingText(text) {
  text = normalizeStreamText(text);
  if (!text) return;

  const msgDiv = document.querySelector('.message-agent:last-child');
  if (!msgDiv) return;

  const typingIndicator = msgDiv.querySelector('.typing-indicator');
  if (typingIndicator) typingIndicator.style.display = 'none';

  const responseShell = msgDiv.querySelector('.response-shell');
  let streamingDiv = msgDiv.querySelector('.streaming-text');
  if (!streamingDiv) {
    const content = msgDiv.querySelector('.message-content');
    const shell = responseShell || document.createElement('div');
    if (!responseShell) {
      shell.className = 'response-shell';
      shell.innerHTML =
        '<div class="response-label">Agent Response</div><div class="streaming-text"></div>';
      content.appendChild(shell);
    }
    streamingDiv = document.createElement('div');
    streamingDiv.className = 'streaming-text';
    shell.appendChild(streamingDiv);
  }

  if (responseShell) {
    responseShell.classList.add('visible');
  }

  appendChunkText(streamingDiv, text);
  scrollToBottom();
}

function completeAgentMessage(text) {
  const msgDiv = document.querySelector('.message-agent:last-child');
  if (!msgDiv) return;

  const typingIndicator = msgDiv.querySelector('.typing-indicator');
  if (typingIndicator) typingIndicator.remove();

  // Update header to show completion
  const actionsContainer = msgDiv.querySelector('.actions-container');
  if (actionsContainer) {
    // Mark all running actions as complete
    const runningIcons = msgDiv.querySelectorAll('.action-icon.running');
    runningIcons.forEach((icon) => {
      icon.className = 'action-icon success';
      icon.innerHTML = getStatusIcon('success');
    });

    // Update current action icons
    const runningCurrentIcons = msgDiv.querySelectorAll(
      '.current-action-icon.running'
    );
    runningCurrentIcons.forEach((icon) => {
      icon.className = 'current-action-icon success';
      icon.innerHTML = getStatusIcon('success');
    });

    // Update header status
    updateActionsHeaderStatus(msgDiv, 'success');
  }

  const responseShell = msgDiv.querySelector('.response-shell');
  const streamingDiv = msgDiv.querySelector('.streaming-text');
  const finalText = streamingDiv?.dataset.rawText || normalizeStreamText(text);
  if (streamingDiv && finalText) {
    if (!streamingDiv.dataset.rawText) {
      streamingDiv.dataset.rawText = finalText;
      streamingDiv.innerHTML = renderMarkdown(finalText);
    }
    streamingDiv.classList.add('finalized');
    if (responseShell) {
      responseShell.classList.add('visible');
    }
  }

  scrollToBottom();
}

function showSystemMessage(text, type = 'info') {
  const msgDiv = document.createElement('div');
  msgDiv.className = 'message message-agent';
  const bgColor =
    type === 'error'
      ? '#ffe3e3'
      : type === 'success'
        ? '#d3f9d8'
        : 'var(--bg-secondary)';
  const textColor =
    type === 'error'
      ? 'var(--error)'
      : type === 'success'
        ? 'var(--success)'
        : 'var(--text-primary)';
  msgDiv.innerHTML = `
    <div class="message-content" style="background: ${bgColor}; color: ${textColor};">
      <div class="message-text">${escapeHtml(text)}</div>
    </div>
  `;
  messagesContainer.appendChild(msgDiv);
  scrollToBottom();
}

function getStatusIcon(status) {
  switch (status) {
    case 'running':
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>';
    case 'success':
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
    case 'error':
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    default:
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/></svg>';
  }
}

function handleBackgroundMessage(message) {
  console.log('Message from background:', message);

  switch (message.type) {
    case 'CONNECTION_STATUS':
      updateConnectionStatus(message.connected);
      if (message.reconnecting) {
        statusHint.querySelector('.hint-text').textContent =
          `Reconnecting (attempt ${message.attempt})...`;
      } else if (message.failed) {
        statusHint.querySelector('.hint-text').textContent =
          'Reconnection failed';
      }
      break;

    case 'LOG':
      handleLogMessage(message);
      break;

    case 'ACTION':
      window.currentStepId = addActionStep(
        {
          name: message.action,
          detail: message.detail,
        },
        'running'
      );
      break;

    case 'ACTION_COMPLETE':
      if (window.currentStepId) {
        updateActionStep(
          window.currentStepId,
          message.success ? 'success' : 'error'
        );
      }
      actionJustCompleted = true;
      break;

    case 'STREAM_TEXT':
      // Handle streaming text from agent (with truncation)
      appendStreamingText(truncateOutput(normalizeStreamText(message.text)));
      break;

    case 'STREAM_START':
      // Clear any existing streaming text for new stream
      actionJustCompleted = false;
      const msgDiv = document.querySelector('.message-agent:last-child');
      if (msgDiv) {
        const streamingDiv = msgDiv.querySelector('.streaming-text');
        if (streamingDiv) {
          streamingDiv.dataset.rawText = '';
          streamingDiv.innerHTML = '';
          streamingDiv.classList.remove('finalized');
        }
      }
      break;

    case 'STREAM_END':
      // Stream ended, finalize the message
      completeAgentMessage(null);
      break;

    case 'TASK_COMPLETE':
      completeAgentMessage(message.result);
      setTaskRunning(false);
      // Process next queued message
      setTimeout(processMessageQueue, 500);
      break;

    case 'TASK_ERROR':
      if (window.currentStepId) {
        updateActionStep(window.currentStepId, 'error');
      }
      completeAgentMessage('Error: ' + message.error);
      setTaskRunning(false);
      // Process next queued message
      setTimeout(processMessageQueue, 500);
      break;

    case 'DEBUG_RESULT':
      handleDebugResult(message);
      break;
  }
}

function handleLogMessage(message) {
  const level = message.level || 'info';
  const text = message.message;

  // Parse action from log message
  if (text.includes('Executing:')) {
    const actionName = text.replace('Executing:', '').trim();
    window.currentStepId = addActionStep({ name: actionName }, 'running');
  } else if (text.includes('Completed:')) {
    if (window.currentStepId) {
      updateActionStep(window.currentStepId, 'success');
    }
  } else if (text.includes('Failed:')) {
    if (window.currentStepId) {
      updateActionStep(window.currentStepId, 'error');
    }
    addActionStep({ name: text }, 'error');
  } else if (level === 'success' && !text.includes('Debugger')) {
    addActionStep({ name: text }, 'success');
  } else if (level === 'error') {
    addActionStep({ name: text }, 'error');
  } else if (
    text.includes('AI') ||
    text.includes('Sending task') ||
    text.includes('Processing') ||
    text.includes('Analyzing')
  ) {
    window.currentStepId = addActionStep({ name: text }, 'running');
  } else if (text.includes('Attaching') || text.includes('attached')) {
    addActionStep({ name: text }, level === 'success' ? 'success' : 'running');
  }
}

function clearChat() {
  messagesContainer.innerHTML = `
    <div class="welcome-message">
      <div class="welcome-icon">
        <img src="adgm-logo.png" alt="ADGM Co-work Agent logo">
      </div>
      <h3>Welcome to ADGM Co-work Agent</h3>
      <p>Describe what you want to do on this page.</p>
      <div class="suggestions">
        <button class="suggestion-chip" data-text="Click the first link on this page">Click first link</button>
        <button class="suggestion-chip" data-text="Scroll down to see more content">Scroll down</button>
        <button class="suggestion-chip" data-text="Fill the form on this page">Fill form</button>
        <button class="suggestion-chip" data-text="Extract all text content from this page">Extract text</button>
      </div>
    </div>
  `;

  // Re-attach suggestion chip listeners
  document.querySelectorAll('.suggestion-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      messageInput.value = chip.dataset.text;
      updateSendButton();
      messageInput.focus();
    });
  });

  // Notify backend to clear context
  if (isConnected) {
    chrome.runtime.sendMessage({ type: 'CLEAR_CONTEXT' });
  }
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Debug mode functions
async function sendDebugCommand() {
  const command = debugInput.value.trim();
  if (!command || !isConnected) return;

  // Clear input
  debugInput.value = '';

  // Add command to output
  addDebugLine(command, 'command');

  // Update current tab info
  await updateCurrentTab();

  // Send to background
  chrome.runtime.sendMessage({
    type: 'DEBUG_COMMAND',
    command: command,
    tabId: currentTabId,
    url: currentTabUrl,
  });
}

function addDebugLine(text, type = 'result') {
  const line = document.createElement('div');
  line.className = `debug-line ${type}`;
  line.textContent = text;
  debugOutput.appendChild(line);
  debugOutput.scrollTop = debugOutput.scrollHeight;
}

function handleDebugResult(message) {
  if (message.success) {
    if (message.result) {
      // Format the result
      let resultText = message.result;
      if (typeof resultText === 'object') {
        resultText = JSON.stringify(resultText, null, 2);
      }
      addDebugLine(resultText, 'success');
    } else {
      addDebugLine('Command executed successfully', 'success');
    }
  } else {
    addDebugLine(`Error: ${message.error}`, 'error');
  }
}
