// Agent cursor — custom SVG cursor with state-based animations

const OverlayCursor = (() => {
  let cursorEl = null;
  let shadowRoot = null;

  // Custom cursor SVG from design
  const CURSOR_SVG = `
    <svg width="32" height="32" viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg">
      <g clip-path="url(#clip0_cursor)">
        <g filter="url(#filter0_cursor)">
          <path d="M43.1519 31.002C48.4436 28.1565 51.0894 26.7338 51.7589 25.021C52.3399 23.5348 52.1764 21.8606 51.3191 20.5147C50.3311 18.9638 47.4601 18.0794 41.7181 16.3106L20.0154 9.62537C15.1706 8.13297 12.7482 7.3868 11.1463 7.99175C9.75183 8.51835 8.66505 9.63962 8.18225 11.0498C7.62763 12.6699 8.44913 15.0678 10.0922 19.8636L17.37 41.1073C19.3909 47.0063 20.4014 49.956 22.0131 50.8935C23.4108 51.7065 25.1154 51.7935 26.5886 51.1268C28.2874 50.358 29.5926 47.5265 32.2034 41.8635L34.1321 37.6798C34.5476 36.7783 34.7554 36.3275 35.0399 35.934C35.2921 35.5845 35.5886 35.2695 35.9216 34.996C36.2971 34.688 36.7341 34.453 37.6084 33.983L43.1519 31.002Z" fill="#155DFC"/>
          <path d="M43.1519 31.002C48.4436 28.1565 51.0894 26.7338 51.7589 25.021C52.3399 23.5348 52.1764 21.8606 51.3191 20.5147C50.3311 18.9638 47.4601 18.0794 41.7181 16.3106L20.0154 9.62537C15.1706 8.13297 12.7482 7.3868 11.1463 7.99175C9.75183 8.51835 8.66505 9.63962 8.18225 11.0498C7.62763 12.6699 8.44913 15.0678 10.0922 19.8636L17.37 41.1073C19.3909 47.0063 20.4014 49.956 22.0131 50.8935C23.4108 51.7065 25.1154 51.7935 26.5886 51.1268C28.2874 50.358 29.5926 47.5265 32.2034 41.8635L34.1321 37.6798C34.5476 36.7783 34.7554 36.3275 35.0399 35.934C35.2921 35.5845 35.5886 35.2695 35.9216 34.996C36.2971 34.688 36.7341 34.453 37.6084 33.983L43.1519 31.002Z" stroke="white" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
        </g>
      </g>
      <defs>
        <filter id="filter0_cursor" x="0.509766" y="2.28125" width="59.0918" height="58.7903" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
          <feFlood flood-opacity="0" result="BackgroundImageFix"/>
          <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
          <feOffset dy="2"/>
          <feGaussianBlur stdDeviation="2.5"/>
          <feComposite in2="hardAlpha" operator="out"/>
          <feColorMatrix type="matrix" values="0 0 0 0 0.113725 0 0 0 0 0.113725 0 0 0 0 0.113725 0 0 0 0.4 0"/>
          <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_cursor"/>
          <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_cursor" result="shape"/>
        </filter>
        <clipPath id="clip0_cursor">
          <rect width="60" height="60" fill="white"/>
        </clipPath>
      </defs>
    </svg>
  `;

  function getStyles() {
    return `
      .eigent-cursor {
        position: fixed;
        top: 0;
        left: 0;
        width: 32px;
        height: 32px;
        pointer-events: none;
        z-index: 2147483647;
        will-change: transform, opacity;
        transition: opacity 0.2s ease;
        opacity: 0;
      }

      .eigent-cursor--visible {
        opacity: 1;
      }

      .eigent-cursor--idle {
        animation: eigent-cursor-pulse 2s ease-in-out infinite;
      }

      .eigent-cursor--clicking {
        animation: eigent-cursor-click 0.3s ease forwards;
      }

      .eigent-cursor--thinking {
        animation: eigent-cursor-think 1.2s linear infinite;
      }

      @keyframes eigent-cursor-pulse {
        0%, 100% { transform: var(--cursor-translate) scale(1); }
        50% { transform: var(--cursor-translate) scale(1.08); }
      }

      @keyframes eigent-cursor-click {
        0% { transform: var(--cursor-translate) scale(1); }
        40% { transform: var(--cursor-translate) scale(0.82); }
        100% { transform: var(--cursor-translate) scale(1); }
      }

      @keyframes eigent-cursor-think {
        0% { transform: var(--cursor-translate) rotate(0deg); }
        25% { transform: var(--cursor-translate) rotate(6deg); }
        75% { transform: var(--cursor-translate) rotate(-6deg); }
        100% { transform: var(--cursor-translate) rotate(0deg); }
      }
    `;
  }

  function init(root) {
    shadowRoot = root;

    cursorEl = document.createElement('div');
    cursorEl.className = 'eigent-cursor';
    cursorEl.innerHTML = CURSOR_SVG;

    shadowRoot.appendChild(cursorEl);

    OverlayStore.subscribe((state, changed) => {
      if (changed.cursor !== undefined || changed.enabled !== undefined) {
        render();
      }
    });

    render();
  }

  function render() {
    if (!cursorEl) return;
    const { cursor, enabled, reducedMotion } = OverlayStore.getState();

    const visible = enabled && cursor.visible;
    cursorEl.classList.toggle('eigent-cursor--visible', visible);

    cursorEl.style.setProperty(
      '--cursor-translate',
      `translate3d(${cursor.x}px, ${cursor.y}px, 0)`
    );
    cursorEl.style.transform = `translate3d(${cursor.x}px, ${cursor.y}px, 0)`;

    const states = [
      'idle',
      'moving',
      'hovering',
      'clicking',
      'thinking',
      'complete',
      'error',
    ];
    for (const s of states) {
      cursorEl.classList.toggle(`eigent-cursor--${s}`, cursor.state === s);
    }

    if (reducedMotion) {
      cursorEl.style.animation = 'none';
    }
  }

  function animateClick() {
    OverlayStore.update({ cursor: { state: 'clicking' } });
    setTimeout(() => {
      OverlayStore.update({ cursor: { state: 'idle' } });
    }, 300);
  }

  function show() {
    OverlayStore.update({ cursor: { visible: true } });
  }

  function hide() {
    OverlayStore.update({ cursor: { visible: false } });
  }

  function destroy() {
    if (cursorEl) {
      cursorEl.remove();
      cursorEl = null;
    }
  }

  return { init, getStyles, animateClick, show, hide, destroy };
})();
