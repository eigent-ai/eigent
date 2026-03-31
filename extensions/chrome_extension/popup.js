// State
let isConnected = false;
let currentTabId = null;
let currentTabUrl = '';
let currentWindowId = null;
let _conversationHistory = [];

// DOM Elements
const settingsPage = document.getElementById('settingsPage');
const chatPage = document.getElementById('chatPage');
const settingsBtn = document.getElementById('settingsBtn');
const backToChat = document.getElementById('backToChat');
const connectBtn = document.getElementById('connectBtn');
const connectionDot = document.getElementById('connectionDot');
const connectionText = document.getElementById('connectionText');
const serverUrlInput = document.getElementById('serverUrl');
const currentPageUrl = document.getElementById('currentPageUrl');
const messagesContainer = document.getElementById('messagesContainer');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const statusHint = document.getElementById('statusHint');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Get current tab info
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    currentTabId = tab.id;
    currentTabUrl = tab.url;
    currentWindowId = tab.windowId;
    currentPageUrl.textContent = truncateUrl(tab.url, 50);
    currentPageUrl.title = tab.url;
  }

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

function setupEventListeners() {
  // Settings toggle
  settingsBtn.addEventListener('click', () => {
    settingsPage.classList.remove('hidden');
    chatPage.classList.add('hidden');
  });

  backToChat.addEventListener('click', () => {
    chatPage.classList.remove('hidden');
    settingsPage.classList.add('hidden');
  });

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
    messageInput.style.height = Math.min(messageInput.scrollHeight, 100) + 'px';
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
}

async function handleConnect() {
  const btnText = connectBtn.querySelector('.btn-text');
  const btnLoader = connectBtn.querySelector('.btn-loader');

  if (isConnected) {
    chrome.runtime.sendMessage({ type: 'DISCONNECT' });
    updateConnectionStatus(false);
  } else {
    btnText.textContent = 'Connecting...';
    btnLoader.classList.remove('hidden');
    connectBtn.disabled = true;

    chrome.runtime.sendMessage(
      {
        type: 'CONNECT',
        serverUrl: serverUrlInput.value,
        windowId: currentWindowId,
      },
      (response) => {
        btnLoader.classList.add('hidden');
        connectBtn.disabled = false;

        if (response && response.success) {
          updateConnectionStatus(true);
        } else {
          updateConnectionStatus(false);
          showError(response?.error || 'Connection failed');
        }
      }
    );
  }
}

function updateConnectionStatus(connected) {
  isConnected = connected;

  // Update settings page
  connectionDot.classList.toggle('connected', connected);
  connectionText.textContent = connected ? 'Connected' : 'Disconnected';

  const btnText = connectBtn.querySelector('.btn-text');
  btnText.textContent = connected ? 'Disconnect' : 'Connect';

  // Update chat page
  statusHint.classList.toggle('connected', connected);
  statusHint.innerHTML = connected
    ? '<span class="hint-dot"></span>Connected'
    : '<span class="hint-dot"></span>Not connected';

  updateSendButton();
}

function updateSendButton() {
  const hasText = messageInput.value.trim().length > 0;
  sendBtn.disabled = !hasText || !isConnected;
}

async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !isConnected) return;

  // Clear input
  messageInput.value = '';
  messageInput.style.height = 'auto';
  updateSendButton();

  // Hide welcome message
  const welcome = messagesContainer.querySelector('.welcome-message');
  if (welcome) welcome.remove();

  // Add user message
  addMessage('user', text);

  // Add agent response placeholder
  const agentMsgId = addAgentMessage();

  // Send to background
  chrome.runtime.sendMessage({
    type: 'EXECUTE_TASK',
    task: text,
    tabId: currentTabId,
    url: currentTabUrl,
    windowId: currentWindowId,
  });
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
      <div class="action-steps" style="display:none;"></div>
    </div>
  `;
  messagesContainer.appendChild(msgDiv);
  scrollToBottom();
  return msgId;
}

function addActionStep(msgId, action, status = 'running') {
  const msgDiv =
    document.getElementById(msgId) ||
    document.querySelector('.message-agent:last-child');
  if (!msgDiv) return;

  const stepsContainer = msgDiv.querySelector('.action-steps');
  const typingIndicator = msgDiv.querySelector('.typing-indicator');

  // Hide typing indicator, show steps
  if (typingIndicator) typingIndicator.style.display = 'none';
  stepsContainer.style.display = 'block';

  const stepId = 'step-' + Date.now();
  const stepDiv = document.createElement('div');
  stepDiv.className = 'action-step';
  stepDiv.id = stepId;
  stepDiv.innerHTML = `
    <div class="action-icon ${status}">
      ${getStatusIcon(status)}
    </div>
    <div class="action-info">
      <div class="action-name">${escapeHtml(action.name || action)}</div>
      ${action.detail ? `<div class="action-detail">${escapeHtml(action.detail)}</div>` : ''}
    </div>
  `;
  stepsContainer.appendChild(stepDiv);
  scrollToBottom();
  return stepId;
}

function updateActionStep(stepId, status) {
  const stepDiv = document.getElementById(stepId);
  if (!stepDiv) return;

  const iconDiv = stepDiv.querySelector('.action-icon');
  iconDiv.className = `action-icon ${status}`;
  iconDiv.innerHTML = getStatusIcon(status);
}

function completeAgentMessage(msgId, text) {
  const msgDiv =
    document.getElementById(msgId) ||
    document.querySelector('.message-agent:last-child');
  if (!msgDiv) return;

  const typingIndicator = msgDiv.querySelector('.typing-indicator');
  if (typingIndicator) typingIndicator.remove();

  if (text) {
    const content = msgDiv.querySelector('.message-content');
    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    textDiv.style.marginTop = '12px';
    textDiv.textContent = text;
    content.appendChild(textDiv);
  }

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
      break;

    case 'LOG':
      handleLogMessage(message);
      break;

    case 'ACTION':
      const stepId = addActionStep(
        null,
        {
          name: message.action,
          detail: message.detail,
        },
        'running'
      );
      // Store step ID for later update
      window.currentStepId = stepId;
      break;

    case 'ACTION_COMPLETE':
      if (window.currentStepId) {
        updateActionStep(
          window.currentStepId,
          message.success ? 'success' : 'error'
        );
      }
      break;

    case 'TASK_COMPLETE':
      completeAgentMessage(null, message.result);
      break;

    case 'TASK_ERROR':
      if (window.currentStepId) {
        updateActionStep(window.currentStepId, 'error');
      }
      completeAgentMessage(null, 'Error: ' + message.error);
      break;
  }
}

function handleLogMessage(message) {
  const level = message.level || 'info';
  const text = message.message;

  // Parse action from log
  if (text.includes('CDP command:') || text.includes('Executing:')) {
    const actionName = text.split(':').pop().trim();
    const stepId = addActionStep(null, { name: actionName }, 'running');
    window.currentStepId = stepId;
  } else if (
    text.includes('success') ||
    text.includes('Success') ||
    text.includes('Clicked') ||
    text.includes('Typed')
  ) {
    if (window.currentStepId) {
      updateActionStep(window.currentStepId, 'success');
    }
    // Add new step for the action
    addActionStep(null, { name: text }, 'success');
  } else if (level === 'error') {
    if (window.currentStepId) {
      updateActionStep(window.currentStepId, 'error');
    }
    addActionStep(null, { name: text }, 'error');
  } else if (
    text.includes('AI') ||
    text.includes('Analyzing') ||
    text.includes('Processing')
  ) {
    addActionStep(null, { name: text }, 'running');
  }
}

function showError(message) {
  // Add error message to chat
  const errorDiv = document.createElement('div');
  errorDiv.className = 'message message-agent';
  errorDiv.innerHTML = `
    <div class="message-content" style="background: #ffe3e3; color: var(--error);">
      <div class="message-text">${escapeHtml(message)}</div>
    </div>
  `;
  messagesContainer.appendChild(errorDiv);
  scrollToBottom();
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function truncateUrl(url, maxLen) {
  if (url.length <= maxLen) return url;
  return url.substring(0, maxLen - 3) + '...';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
