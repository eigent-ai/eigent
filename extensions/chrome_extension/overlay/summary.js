// Floating action summary bubble — attached near cursor

const OverlaySummary = (() => {
  let bubbleEl = null;
  let currentText = '';
  let followTimer = null;
  let bubbleX = 0;
  let bubbleY = 0;

  const OFFSET_X = 20; // px right of cursor
  const OFFSET_Y = 28; // px below cursor
  const MAX_CHARS = 64;
  const FOLLOW_LAG = 0; // no lag, follow cursor immediately

  function getStyles() {
    return `
      .eigent-summary {
        position: fixed;
        top: 0;
        left: 0;
        pointer-events: none;
        z-index: 2147483647;
        will-change: transform, opacity;
        max-width: 320px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font: 13px/1.3 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
        color: #fff;
        background: #155DFC;
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        border-radius: 9999px;
        padding: 8px 18px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        opacity: 0;
        transition: opacity 0.18s ease;
      }

      .eigent-summary--visible {
        opacity: 1;
      }

      .eigent-summary--entering {
        transform: translate3d(var(--summary-x), var(--summary-y), 0) translateY(4px);
      }

      .eigent-summary--active {
        transform: translate3d(var(--summary-x), var(--summary-y), 0);
      }
    `;
  }

  function init(shadowRoot) {
    bubbleEl = document.createElement('div');
    bubbleEl.className = 'eigent-summary';
    shadowRoot.appendChild(bubbleEl);

    OverlayStore.subscribe((state, changed) => {
      if (changed.summary !== undefined) {
        updateText(state.summary);
      }
      if (changed.cursor !== undefined) {
        scheduleFollow(state.cursor);
      }
      if (changed.enabled !== undefined && !state.enabled) {
        hide();
      }
    });
  }

  function updateText(summary) {
    if (!bubbleEl) return;

    if (!summary.visible || !summary.text) {
      hide();
      return;
    }

    const text =
      summary.text.length > MAX_CHARS
        ? summary.text.slice(0, MAX_CHARS - 1) + '\u2026'
        : summary.text;

    if (text !== currentText) {
      // Fade out, swap, fade in
      bubbleEl.classList.remove('eigent-summary--active');
      bubbleEl.classList.add('eigent-summary--entering');

      setTimeout(
        () => {
          bubbleEl.textContent = text;
          currentText = text;
          // Position at center-top if cursor not visible
          const { cursor } = OverlayStore.getState();
          if (!cursor.visible) {
            positionCenterTop();
          }
          bubbleEl.classList.add('eigent-summary--visible');
          requestAnimationFrame(() => {
            bubbleEl.classList.remove('eigent-summary--entering');
            bubbleEl.classList.add('eigent-summary--active');
          });
        },
        currentText ? 120 : 0
      );
    }
  }

  function scheduleFollow(cursor) {
    if (cursor.visible) {
      // Cursor is active (clicking action) — follow it
      setPosition(cursor.x + OFFSET_X, cursor.y + OFFSET_Y);
    } else {
      // No cursor (non-click action) — center top of screen, 10vh from top
      positionCenterTop();
    }
  }

  function positionCenterTop() {
    if (!bubbleEl) return;
    const vw = window.innerWidth;
    const rect = bubbleEl.getBoundingClientRect();
    const w = rect.width || 200;
    const x = (vw - w) / 2;
    const y = window.innerHeight * 0.1; // 10vh from top
    bubbleX = x;
    bubbleY = y;
    bubbleEl.style.setProperty('--summary-x', `${bubbleX}px`);
    bubbleEl.style.setProperty('--summary-y', `${bubbleY}px`);
    bubbleEl.style.transform = `translate3d(${bubbleX}px, ${bubbleY}px, 0)`;
  }

  function setPosition(x, y) {
    if (!bubbleEl) return;
    bubbleX = x;
    bubbleY = y;

    // Clamp to viewport
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const rect = bubbleEl.getBoundingClientRect();
    const w = rect.width || 200;
    const h = rect.height || 30;

    if (bubbleX + w > vw - 8) bubbleX = vw - w - 8;
    if (bubbleY + h > vh - 8) bubbleY = vh - h - 8;
    if (bubbleX < 8) bubbleX = 8;
    if (bubbleY < 8) bubbleY = 8;

    bubbleEl.style.setProperty('--summary-x', `${bubbleX}px`);
    bubbleEl.style.setProperty('--summary-y', `${bubbleY}px`);
    bubbleEl.style.transform = `translate3d(${bubbleX}px, ${bubbleY}px, 0)`;
  }

  function hide() {
    if (!bubbleEl) return;
    bubbleEl.classList.remove(
      'eigent-summary--visible',
      'eigent-summary--active'
    );
    currentText = '';
  }

  function destroy() {
    if (followTimer) clearTimeout(followTimer);
    if (bubbleEl) {
      bubbleEl.remove();
      bubbleEl = null;
    }
  }

  return { init, getStyles, hide, destroy };
})();
