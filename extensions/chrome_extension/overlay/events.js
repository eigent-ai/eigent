// Event types and message bridge between background ↔ content script

const OverlayEvents = (() => {
  // Message types: Background → Content
  const TYPES = {
    AGENT_STEP: 'OVERLAY_AGENT_STEP',
    CURSOR_MOVE: 'OVERLAY_CURSOR_MOVE',
    HIGHLIGHT: 'OVERLAY_HIGHLIGHT',
    SUMMARY: 'OVERLAY_SUMMARY',
    STATE: 'OVERLAY_STATE',
    RESOLVE_TARGET: 'OVERLAY_RESOLVE_TARGET',
    RESOLVE_AND_MOVE: 'OVERLAY_RESOLVE_AND_MOVE',
    // Content → Background
    READY: 'OVERLAY_READY',
    ELEMENT_RESOLVED: 'OVERLAY_ELEMENT_RESOLVED',
  };

  function listen() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || !message.type || !message.type.startsWith('OVERLAY_')) {
        return;
      }

      switch (message.type) {
        case TYPES.AGENT_STEP:
          handleAgentStep(message);
          break;
        case 'OVERLAY_DEMO':
          if (typeof window.__eigentOverlayDemo === 'function') {
            window.__eigentOverlayDemo();
          }
          break;
        case TYPES.CURSOR_MOVE:
          console.log(
            '[Eigent Cursor] CURSOR_MOVE received:',
            message.x,
            message.y
          );
          OverlayStore.update({
            cursor: {
              x: message.x,
              y: message.y,
              state: 'moving',
              visible: true,
            },
          });
          if (typeof OverlayMotion !== 'undefined') {
            OverlayMotion.moveCursor(message.x, message.y, message.duration);
          }
          break;
        case TYPES.HIGHLIGHT:
          if (typeof OverlayHighlight !== 'undefined') {
            OverlayHighlight.highlightSelector(
              message.selector,
              message.duration
            );
          }
          break;
        case 'OVERLAY_HIGHLIGHT_RECT':
          // Highlight at a pre-resolved rect (from CDP resolution)
          if (typeof OverlayHighlight !== 'undefined' && message.rect) {
            OverlayHighlight.showRect(message.rect);
            if (message.duration > 0) {
              setTimeout(() => OverlayHighlight.hide(), message.duration);
            }
          }
          break;
        case TYPES.SUMMARY:
          OverlayStore.update({
            summary: { text: message.text, visible: !!message.text },
          });
          break;
        case TYPES.STATE: {
          const stateUpdate = {};
          if (message.enabled !== undefined) {
            stateUpdate.enabled = message.enabled;
          }
          if (message.auroraVisible !== undefined) {
            stateUpdate.aurora = { visible: message.auroraVisible };
          }
          if (message.cursorVisible !== undefined) {
            stateUpdate.cursor = { visible: message.cursorVisible };
          }
          if (message.summaryText !== undefined) {
            stateUpdate.summary = {
              text: message.summaryText,
              visible: !!message.summaryText,
            };
          }
          OverlayStore.update(stateUpdate);
          break;
        }
        case TYPES.RESOLVE_AND_MOVE: {
          // Resolve element by ARIA ref and move cursor to its center
          const ref = message.ref;
          console.log('[Eigent Cursor] RESOLVE_AND_MOVE for ref:', ref);
          const el = resolveElementByRef(ref);
          if (el) {
            const rect = el.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            console.log('[Eigent Cursor] Resolved ref', ref, 'to', cx, cy);
            OverlayStore.update({
              cursor: { visible: true, state: 'moving' },
            });
            if (typeof OverlayMotion !== 'undefined') {
              OverlayMotion.moveCursor(cx, cy);
            }
          } else {
            console.log('[Eigent Cursor] Could not resolve ref:', ref);
          }
          break;
        }
        case TYPES.RESOLVE_TARGET:
          if (typeof OverlayDomResolver !== 'undefined') {
            const result = OverlayDomResolver.resolve(message.target);
            sendResponse(result);
          }
          return true; // async response
      }
    });
  }

  function handleAgentStep(msg) {
    if (msg.summary) {
      OverlayStore.update({ summary: { text: msg.summary, visible: true } });
    }
    if (msg.cursor) {
      OverlayStore.update({ cursor: { visible: true } });
      if (typeof OverlayMotion !== 'undefined') {
        OverlayMotion.moveCursor(msg.cursor.x, msg.cursor.y);
      }
    }
    if (msg.highlight) {
      OverlayStore.update({ highlight: msg.highlight });
    }
    if (msg.state === 'done' || msg.state === 'error') {
      setTimeout(() => {
        OverlayStore.update({
          cursor: { state: msg.state === 'done' ? 'complete' : 'error' },
          summary: { visible: false },
          highlight: null,
        });
      }, 1200);
    }
  }

  // Resolve an element by ARIA ref (e.g. "e46") — same methods as the CDP highlight system
  function resolveElementByRef(ref) {
    if (!ref) return null;

    // Method 1: __ariaSnapshot.getElementByRef
    if (
      typeof __ariaSnapshot !== 'undefined' &&
      __ariaSnapshot.getElementByRef
    ) {
      try {
        const el = __ariaSnapshot.getElementByRef(ref, document.body);
        if (el) return el;
      } catch (e) {}
    }

    // Method 2: Walk DOM for _ariaRef property
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      null,
      false
    );
    let node;
    while ((node = walker.nextNode())) {
      if (node._ariaRef && node._ariaRef.ref === ref) {
        return node;
      }
    }

    // Method 3: data attributes
    const refNum = ref.replace(/^e/, '');
    const selectors = [
      `[data-ref="${ref}"]`,
      `[data-ref="${refNum}"]`,
      `[ref="${ref}"]`,
      `[aria-ref="${ref}"]`,
      `[data-camel-ref="${ref}"]`,
      `[data-camel-ref="${refNum}"]`,
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch (e) {}
    }

    // Method 4: Try as CSS selector directly
    if (ref.includes('[') || ref.includes('.') || ref.includes('#')) {
      try {
        return document.querySelector(ref);
      } catch (e) {}
    }

    return null;
  }

  function sendToBackground(type, data = {}) {
    chrome.runtime.sendMessage({ type, ...data }).catch(() => {});
  }

  function notifyReady() {
    sendToBackground(TYPES.READY);
  }

  return { TYPES, listen, sendToBackground, notifyReady };
})();
