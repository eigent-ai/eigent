// Content script — Shadow DOM overlay mount + orchestrator
// Runs after all overlay/*.js modules are loaded by manifest

// Prevent double injection
if (document.getElementById('eigent-agent-overlay')) {
  // already injected
} else if (
  window.location.href.startsWith('chrome://') ||
  window.location.href.startsWith('chrome-extension://') ||
  window.location.href.startsWith('edge://') ||
  window.location.href.startsWith('about:')
) {
  // skip restricted pages
} else {
  console.log('[Eigent Cursor] Initializing content script...');

  // Verify all modules loaded
  const modules = {
    OverlayStore,
    OverlayEvents,
    OverlayMotion,
    OverlayAurora,
    OverlayCursor,
    OverlaySummary,
    OverlayHighlight,
  };
  for (const [name, mod] of Object.entries(modules)) {
    if (!mod) {
      console.error(`[Eigent Cursor] Module ${name} not loaded!`);
    } else {
      console.log(`[Eigent Cursor] Module ${name} OK`);
    }
  }

  // Create overlay host — full viewport, no interaction blocking
  const host = document.createElement('div');
  host.id = 'eigent-agent-overlay';
  host.style.cssText =
    'position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 2147483646; pointer-events: none; overflow: visible;';
  document.documentElement.appendChild(host);

  // Attach Shadow DOM for style isolation
  const shadow = host.attachShadow({ mode: 'open' });

  // Inject all overlay styles into shadow root
  const styleEl = document.createElement('style');
  styleEl.textContent = [
    OverlayAurora.getStyles(),
    OverlayCursor.getStyles(),
    OverlaySummary.getStyles(),
    OverlayHighlight.getStyles(),
  ].join('\n');
  shadow.appendChild(styleEl);

  console.log(
    '[Eigent Cursor] Styles injected, length:',
    styleEl.textContent.length
  );

  // Detect reduced motion preference
  const reducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches;
  OverlayStore.update({ reducedMotion });
  window
    .matchMedia('(prefers-reduced-motion: reduce)')
    .addEventListener('change', (e) => {
      OverlayStore.update({ reducedMotion: e.matches });
    });

  // Initialize all overlay layers (order matters for z-stacking)
  OverlayAurora.init(shadow);
  OverlayHighlight.init(shadow);
  OverlayCursor.init(shadow);
  OverlaySummary.init(shadow);

  console.log('[Eigent Cursor] All layers initialized');
  console.log(
    '[Eigent Cursor] Shadow root children:',
    shadow.childNodes.length
  );
  console.log(
    '[Eigent Cursor] Host element in DOM:',
    !!document.getElementById('eigent-agent-overlay')
  );

  // Start listening for messages from background
  OverlayEvents.listen();
  OverlayEvents.notifyReady();

  // --- DOM Target Resolution (Milestone 2) ---
  const OverlayDomResolver = {
    resolve(target) {
      const element = OverlayHighlight.resolveElement(target);
      if (!element) {
        return { found: false, target };
      }

      const rect = element.getBoundingClientRect();

      // Scroll into view if off-screen
      if (
        rect.top < 0 ||
        rect.bottom > window.innerHeight ||
        rect.left < 0 ||
        rect.right > window.innerWidth
      ) {
        element.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'center',
        });
        // Re-measure after scroll
        return new Promise((resolve) => {
          setTimeout(() => {
            const newRect = element.getBoundingClientRect();
            resolve({
              found: true,
              target,
              rect: {
                x: newRect.left,
                y: newRect.top,
                width: newRect.width,
                height: newRect.height,
              },
              center: {
                x: newRect.left + newRect.width / 2,
                y: newRect.top + newRect.height / 2,
              },
            });
          }, 400);
        });
      }

      return {
        found: true,
        target,
        rect: {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        },
        center: {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        },
      };
    },
  };

  // Expose resolver globally for events.js
  window.__eigentDomResolver = OverlayDomResolver;

  // --- Scripted Demo Mode ---
  window.__eigentOverlayDemo = async function () {
    const store = OverlayStore;
    const motion = OverlayMotion;
    const cursor = OverlayCursor;
    const highlight = OverlayHighlight;

    console.log('[Eigent Demo] Starting overlay demo...');

    // Step 1: Show aurora (simulates agent session start)
    store.update({ aurora: { visible: true }, enabled: true });
    await sleep(800);

    // Step 2: Show cursor at top-left area
    store.update({ cursor: { x: 100, y: 100, visible: true, state: 'idle' } });
    motion.setPosition(100, 100);
    await sleep(600);

    // Step 3: Look for a search input or first input on page
    const searchInput =
      document.querySelector('input[type="search"]') ||
      document.querySelector('input[type="text"]') ||
      document.querySelector('input:not([type="hidden"])') ||
      document.querySelector('textarea');

    if (searchInput) {
      const rect = searchInput.getBoundingClientRect();
      const targetX = rect.left + rect.width / 2;
      const targetY = rect.top + rect.height / 2;

      // Move cursor to search input
      store.update({
        summary: { text: 'Looking for search field\u2026', visible: true },
      });
      await motion.moveCursor(targetX, targetY);
      await motion.settle(180);

      // Highlight target
      highlight.highlightSelector(
        'input[type="search"], input[type="text"], input:not([type="hidden"]), textarea',
        2500
      );
      store.update({ cursor: { state: 'hovering' } });
      await sleep(800);

      // Click
      store.update({
        summary: { text: 'Typing search query\u2026', visible: true },
      });
      cursor.animateClick();
      await sleep(1200);
    } else {
      // Fallback: move to center of page
      store.update({ summary: { text: 'Scanning page\u2026', visible: true } });
      await motion.moveCursor(window.innerWidth / 2, window.innerHeight / 3);
      await sleep(1000);
    }

    // Step 4: Find a button or link
    const button =
      document.querySelector('button:not([disabled])') ||
      document.querySelector('a[href]') ||
      document.querySelector('[role="button"]');

    if (button) {
      const rect = button.getBoundingClientRect();
      const targetX = rect.left + rect.width / 2;
      const targetY = rect.top + rect.height / 2;

      store.update({
        summary: {
          text:
            'Clicking ' + (button.textContent || 'button').trim().slice(0, 30),
          visible: true,
        },
      });
      await motion.moveCursor(targetX, targetY);
      await motion.settle(150);

      highlight.highlightSelector(button.tagName.toLowerCase(), 2000);
      cursor.animateClick();
      await sleep(1500);
    }

    // Step 5: Done
    store.update({
      summary: { text: 'Done', visible: true },
      cursor: { state: 'complete' },
    });
    await sleep(2000);

    // Fade out everything (simulates agent session end)
    store.update({
      summary: { visible: false },
      cursor: { visible: false },
      highlight: null,
      aurora: { visible: false },
    });

    console.log('[Eigent Demo] Demo complete.');
  };

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Listen for custom events from the MAIN world bridge (overlay/bridge.js)
  document.addEventListener('eigent-cursor-demo', () => {
    console.log('[Eigent Cursor] Demo event received from bridge');
    if (typeof window.__eigentOverlayDemo === 'function') {
      window.__eigentOverlayDemo();
    }
  });

  document.addEventListener('eigent-cursor-cmd', (e) => {
    const detail = e.detail || {};
    switch (detail.cmd) {
      case 'showCursor':
        OverlayStore.update({
          cursor: {
            x: detail.x || 200,
            y: detail.y || 200,
            visible: true,
            state: 'idle',
          },
        });
        OverlayMotion.setPosition(detail.x || 200, detail.y || 200);
        break;
      case 'hideCursor':
        OverlayStore.update({ cursor: { visible: false } });
        break;
      case 'summary':
        OverlayStore.update({
          summary: { text: detail.text || '', visible: !!detail.text },
        });
        break;
    }
  });

  console.log('[Eigent Cursor] Content script loaded, overlay mounted.');
} // end else block
