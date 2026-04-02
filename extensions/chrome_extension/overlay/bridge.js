// Bridge script — runs in the MAIN world (page context)
// Exposes __eigentOverlayDemo to DevTools console by dispatching
// a custom DOM event that the content script (isolated world) listens for.

window.__eigentOverlayDemo = function () {
  document.dispatchEvent(new CustomEvent('eigent-cursor-demo'));
  console.log('[Eigent] Demo triggered');
};

window.__eigentOverlay = {
  demo: function () {
    document.dispatchEvent(new CustomEvent('eigent-cursor-demo'));
  },
  showCursor: function (x, y) {
    document.dispatchEvent(
      new CustomEvent('eigent-cursor-cmd', {
        detail: { cmd: 'showCursor', x: x, y: y },
      })
    );
  },
  hideCursor: function () {
    document.dispatchEvent(
      new CustomEvent('eigent-cursor-cmd', {
        detail: { cmd: 'hideCursor' },
      })
    );
  },
  summary: function (text) {
    document.dispatchEvent(
      new CustomEvent('eigent-cursor-cmd', {
        detail: { cmd: 'summary', text: text },
      })
    );
  },
};
