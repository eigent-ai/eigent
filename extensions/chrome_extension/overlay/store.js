// Overlay state store — simple pub/sub, no framework
// Shared across all overlay modules via content script injection order

const OverlayStore = (() => {
  const state = {
    enabled: true,
    reducedMotion: false,
    aurora: { visible: false, intensity: 0.7 },
    cursor: { x: 0, y: 0, state: 'idle', visible: false },
    summary: { text: '', visible: false },
    highlight: null, // { x, y, width, height } or null
  };

  const listeners = new Set();
  let notifying = false;
  let pendingUpdate = null;

  function getState() {
    return state;
  }

  function update(partial) {
    // Apply state changes immediately
    for (const key of Object.keys(partial)) {
      if (
        typeof partial[key] === 'object' &&
        partial[key] !== null &&
        !Array.isArray(partial[key])
      ) {
        state[key] = { ...state[key], ...partial[key] };
      } else {
        state[key] = partial[key];
      }
    }

    // Re-entrancy guard: if a subscriber calls update(), batch it
    if (notifying) {
      pendingUpdate = pendingUpdate || {};
      Object.assign(pendingUpdate, partial);
      return;
    }

    notifying = true;
    try {
      for (const fn of listeners) {
        try {
          fn(state, partial);
        } catch (e) {
          console.error('[Eigent Cursor] Store listener error:', e);
        }
      }
    } finally {
      notifying = false;
    }

    // Flush any updates that were queued during notification
    if (pendingUpdate) {
      const queued = pendingUpdate;
      pendingUpdate = null;
      update(queued);
    }
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { getState, update, subscribe };
})();
