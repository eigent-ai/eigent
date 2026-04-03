// Aurora gradient corner effect — soft ambient glow at all 4 corners

const OverlayAurora = (() => {
  let container = null;
  let blobs = [];
  let reducedMotion = false;

  // Each corner: a triangle of color that fades diagonally to transparent.
  // The opposite corner of the rectangle is fully transparent.
  const BLOB_CONFIGS = [
    {
      corner: 'top-left',
      css: 'top: 0; left: 0; width: 40vw; height: 50vh;',
      gradient: `linear-gradient(135deg, rgba(150,130,255,0.9) 0%, rgba(120,180,255,0.4) 25%, transparent 50%)`,
      delay: '0s',
    },
    {
      corner: 'top-right',
      css: 'top: 0; right: 0; width: 40vw; height: 50vh;',
      gradient: `linear-gradient(225deg, rgba(120,170,255,0.9) 0%, rgba(150,120,255,0.4) 25%, transparent 50%)`,
      delay: '-2s',
    },
    {
      corner: 'bottom-left',
      css: 'bottom: 0; left: 0; width: 40vw; height: 50vh;',
      gradient: `linear-gradient(45deg, rgba(120,190,255,0.9) 0%, rgba(155,130,255,0.4) 25%, transparent 50%)`,
      delay: '-4s',
    },
    {
      corner: 'bottom-right',
      css: 'bottom: 0; right: 0; width: 40vw; height: 50vh;',
      gradient: `linear-gradient(315deg, rgba(255,130,210,0.9) 0%, rgba(150,120,255,0.4) 25%, transparent 50%)`,
      delay: '-6s',
    },
  ];

  function getStyles() {
    return `
      .eigent-aurora-container {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        pointer-events: none;
        z-index: 2147483646;
        opacity: 0;
        transition: opacity 0.8s ease;
      }

      .eigent-aurora-container--visible {
        opacity: 1;
      }

      .eigent-aurora-blob {
        position: absolute;
        will-change: opacity;
        animation: eigent-aurora-glow 8s ease-in-out infinite;
      }

      @keyframes eigent-aurora-glow {
        0%, 100% { opacity: var(--aurora-intensity); }
        50% { opacity: calc(var(--aurora-intensity) * 0.5); }
      }
    `;
  }

  function init(shadowRoot) {
    reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    window
      .matchMedia('(prefers-reduced-motion: reduce)')
      .addEventListener('change', (e) => {
        reducedMotion = e.matches;
        updateAnimation();
      });

    container = document.createElement('div');
    container.className = 'eigent-aurora-container';

    const state = OverlayStore.getState();
    const intensity = state.aurora.intensity || 0.7;

    BLOB_CONFIGS.forEach((config) => {
      const blob = document.createElement('div');
      blob.className = 'eigent-aurora-blob';
      blob.style.cssText = `
        ${config.css}
        background: ${config.gradient};
        --aurora-intensity: ${intensity};
        animation-delay: ${config.delay};
        ${reducedMotion ? 'animation: none; opacity: ' + intensity + ';' : ''}
      `;
      blobs.push(blob);
      container.appendChild(blob);
    });

    shadowRoot.appendChild(container);

    OverlayStore.subscribe((state, changed) => {
      if (changed.aurora !== undefined || changed.enabled !== undefined) {
        updateVisibility();
      }
    });

    updateVisibility();
  }

  function updateVisibility() {
    if (!container) return;
    const state = OverlayStore.getState();
    const visible = state.enabled && state.aurora.visible;
    container.classList.toggle('eigent-aurora-container--visible', visible);

    const intensity = state.aurora.intensity || 0.7;
    blobs.forEach((blob) => {
      blob.style.setProperty('--aurora-intensity', String(intensity));
    });
  }

  function updateAnimation() {
    const state = OverlayStore.getState();
    const intensity = state.aurora.intensity || 0.7;
    blobs.forEach((blob) => {
      if (reducedMotion) {
        blob.style.animation = 'none';
        blob.style.opacity = String(intensity);
      } else {
        blob.style.animation = '';
      }
    });
  }

  function destroy() {
    if (container) {
      container.remove();
      container = null;
      blobs = [];
    }
  }

  return { init, getStyles, destroy };
})();
