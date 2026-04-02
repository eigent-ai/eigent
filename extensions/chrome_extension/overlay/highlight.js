// Target element highlight — Atlas-style blue glow

const OverlayHighlight = (() => {
  let highlightEl = null;
  let shadowRoot = null;
  let scrollListener = null;
  let resizeListener = null;
  let currentTarget = null; // DOM element being tracked
  let updateFrame = null;

  function getStyles() {
    return `
      .eigent-highlight {
        position: fixed;
        top: 0;
        left: 0;
        pointer-events: none;
        z-index: 2147483646;
        border: 2px solid rgba(120, 180, 255, 0.6);
        border-radius: 8px;
        background: rgba(120, 180, 255, 0.08);
        box-shadow: 0 0 12px rgba(120, 180, 255, 0.3), inset 0 0 8px rgba(120, 180, 255, 0.1);
        will-change: transform, opacity, width, height;
        opacity: 0;
        transition: opacity 0.2s ease, transform 0.15s ease, width 0.15s ease, height 0.15s ease;
      }

      .eigent-highlight--visible {
        opacity: 1;
      }

      .eigent-highlight--pulse {
        animation: eigent-highlight-pulse 1.4s ease-in-out infinite;
      }

      @keyframes eigent-highlight-pulse {
        0%, 100% {
          box-shadow: 0 0 12px rgba(120, 180, 255, 0.3), inset 0 0 8px rgba(120, 180, 255, 0.1);
        }
        50% {
          box-shadow: 0 0 20px rgba(120, 180, 255, 0.5), inset 0 0 12px rgba(120, 180, 255, 0.15);
        }
      }
    `;
  }

  function init(root) {
    shadowRoot = root;

    highlightEl = document.createElement('div');
    highlightEl.className = 'eigent-highlight';
    shadowRoot.appendChild(highlightEl);

    // Track scroll and resize for position updates
    scrollListener = () => updatePosition();
    resizeListener = () => updatePosition();
    window.addEventListener('scroll', scrollListener, {
      passive: true,
      capture: true,
    });
    window.addEventListener('resize', resizeListener, { passive: true });

    OverlayStore.subscribe((state, changed) => {
      if (changed.highlight !== undefined) {
        if (state.highlight) {
          showRect(state.highlight);
        } else {
          hide();
        }
      }
      if (changed.enabled !== undefined && !state.enabled) {
        hide();
      }
    });
  }

  // Show highlight at a specific rect { x, y, width, height }
  function showRect(rect) {
    if (!highlightEl) return;
    const padding = 6;
    highlightEl.style.transform = `translate3d(${rect.x - padding}px, ${rect.y - padding}px, 0)`;
    highlightEl.style.width = `${rect.width + padding * 2}px`;
    highlightEl.style.height = `${rect.height + padding * 2}px`;
    highlightEl.classList.add(
      'eigent-highlight--visible',
      'eigent-highlight--pulse'
    );
  }

  // Highlight a DOM element by selector — resolves and tracks it
  function highlightSelector(selector, duration = 2000) {
    const element = resolveElement(selector);
    if (!element) {
      console.warn('[Eigent Cursor] Highlight target not found:', selector);
      hide();
      return null;
    }

    currentTarget = element;
    updatePosition();
    highlightEl.classList.add(
      'eigent-highlight--visible',
      'eigent-highlight--pulse'
    );

    // Update store with rect
    const rect = element.getBoundingClientRect();
    OverlayStore.update({
      highlight: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
    });

    // Auto-hide after duration
    if (duration > 0) {
      setTimeout(() => {
        if (currentTarget === element) {
          hide();
        }
      }, duration);
    }

    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  // Resolve element from various descriptor types
  function resolveElement(descriptor) {
    if (typeof descriptor === 'string') {
      // Try CSS selector
      try {
        const el = document.querySelector(descriptor);
        if (el && isVisible(el)) return el;
      } catch (e) {}

      // Try text content match
      return findByText(descriptor);
    }

    if (typeof descriptor === 'object') {
      // Try selector first
      if (descriptor.selector) {
        try {
          const el = document.querySelector(descriptor.selector);
          if (el && isVisible(el)) return el;
        } catch (e) {}
      }
      // Try ARIA label
      if (descriptor.ariaLabel) {
        const el = document.querySelector(
          `[aria-label="${CSS.escape(descriptor.ariaLabel)}"]`
        );
        if (el && isVisible(el)) return el;
      }
      // Try role + text
      if (descriptor.role) {
        const candidates = document.querySelectorAll(
          `[role="${descriptor.role}"]`
        );
        for (const el of candidates) {
          if (
            descriptor.text &&
            el.textContent.includes(descriptor.text) &&
            isVisible(el)
          ) {
            return el;
          }
          if (!descriptor.text && isVisible(el)) return el;
        }
      }
      // Try text
      if (descriptor.text) {
        return findByText(descriptor.text);
      }
    }

    return null;
  }

  function findByText(text) {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT
    );
    let node;
    while ((node = walker.nextNode())) {
      if (node.children.length === 0 || node.childNodes.length === 1) {
        const content = (node.textContent || '').trim();
        if (content === text || content.includes(text)) {
          if (isVisible(node)) return node;
        }
      }
    }
    return null;
  }

  function isVisible(el) {
    const style = getComputedStyle(el);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0'
    ) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function updatePosition() {
    if (!currentTarget || !highlightEl) return;
    if (updateFrame) cancelAnimationFrame(updateFrame);

    updateFrame = requestAnimationFrame(() => {
      if (!currentTarget) return;
      const rect = currentTarget.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        hide();
        return;
      }
      const padding = 6;
      highlightEl.style.transform = `translate3d(${rect.left - padding}px, ${rect.top - padding}px, 0)`;
      highlightEl.style.width = `${rect.width + padding * 2}px`;
      highlightEl.style.height = `${rect.height + padding * 2}px`;
    });
  }

  function hide() {
    if (!highlightEl) return;
    highlightEl.classList.remove(
      'eigent-highlight--visible',
      'eigent-highlight--pulse'
    );
    currentTarget = null;
    // Only update store if highlight isn't already null (avoid re-entrant loop)
    if (OverlayStore.getState().highlight !== null) {
      OverlayStore.update({ highlight: null });
    }
  }

  function destroy() {
    if (scrollListener)
      window.removeEventListener('scroll', scrollListener, { capture: true });
    if (resizeListener) window.removeEventListener('resize', resizeListener);
    if (updateFrame) cancelAnimationFrame(updateFrame);
    if (highlightEl) {
      highlightEl.remove();
      highlightEl = null;
    }
    currentTarget = null;
  }

  return {
    init,
    getStyles,
    highlightSelector,
    showRect,
    hide,
    resolveElement,
    destroy,
  };
})();
