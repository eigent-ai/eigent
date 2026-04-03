// Animation utilities — spring easing, cursor motion, tab visibility

const OverlayMotion = (() => {
  let cursorAnimFrame = null;
  let cursorCurrentX = 0;
  let cursorCurrentY = 0;
  let tabVisible = true;

  // Track tab visibility to pause animations
  document.addEventListener('visibilitychange', () => {
    tabVisible = !document.hidden;
  });

  // Easing functions
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function easeOutQuart(t) {
    return 1 - Math.pow(1 - t, 4);
  }

  // Spring approximation — overdamp for smooth settle
  function springEase(t) {
    const c4 = (2 * Math.PI) / 3;
    return t === 0
      ? 0
      : t === 1
        ? 1
        : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  }

  // Compute duration based on distance (300ms min, 900ms max)
  function durationForDistance(x1, y1, x2, y2) {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    return Math.min(900, Math.max(300, dist * 1.2));
  }

  // Animate a value from → to using requestAnimationFrame
  function animate({
    from,
    to,
    duration,
    easing = easeOutCubic,
    onUpdate,
    onComplete,
  }) {
    const start = performance.now();
    let frame;

    function tick(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easing(progress);

      // Interpolate
      if (typeof from === 'number') {
        onUpdate(from + (to - from) * easedProgress);
      } else {
        // Object with x, y
        onUpdate({
          x: from.x + (to.x - from.x) * easedProgress,
          y: from.y + (to.y - from.y) * easedProgress,
        });
      }

      if (progress < 1 && tabVisible) {
        frame = requestAnimationFrame(tick);
      } else if (progress >= 1) {
        if (onComplete) onComplete();
      }
    }

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }

  // Move cursor to target position with smooth animation
  function moveCursor(targetX, targetY, customDuration) {
    if (cursorAnimFrame) {
      cancelAnimationFrame(cursorAnimFrame);
      cursorAnimFrame = null;
    }

    const duration =
      customDuration ||
      durationForDistance(cursorCurrentX, cursorCurrentY, targetX, targetY);
    const startX = cursorCurrentX;
    const startY = cursorCurrentY;
    const startTime = performance.now();

    return new Promise((resolve) => {
      function tick(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = easeOutQuart(progress);

        cursorCurrentX = startX + (targetX - startX) * eased;
        cursorCurrentY = startY + (targetY - startY) * eased;

        // Update store (cursor module reads from store)
        OverlayStore.update({
          cursor: {
            x: cursorCurrentX,
            y: cursorCurrentY,
            state: progress < 1 ? 'moving' : 'idle',
          },
        });

        if (progress < 1 && tabVisible) {
          cursorAnimFrame = requestAnimationFrame(tick);
        } else {
          cursorAnimFrame = null;
          resolve();
        }
      }

      cursorAnimFrame = requestAnimationFrame(tick);
    });
  }

  // Settle delay — pause before click action
  function settle(ms = 150) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getCurrentPosition() {
    return { x: cursorCurrentX, y: cursorCurrentY };
  }

  function setPosition(x, y) {
    cursorCurrentX = x;
    cursorCurrentY = y;
  }

  return {
    animate,
    moveCursor,
    settle,
    easeOutCubic,
    easeOutQuart,
    springEase,
    getCurrentPosition,
    setPosition,
    durationForDistance,
  };
})();
