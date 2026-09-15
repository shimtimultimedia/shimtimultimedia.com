/* Mobile SVG motion without one compositor layer per transformed SVG node. */
(function () {
  'use strict';
  if (!window.matchMedia || !window.matchMedia('(pointer: coarse)').matches) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const motions = new Map();
  let previousFrame = 0;

  function specification(element) {
    if (element.classList.contains('ring-spin-cw')) {
      return { duration: parseFloat(element.style.animationDuration) || 60, direction: 1 };
    }
    if (element.classList.contains('ring-spin-ccw')) {
      return { duration: parseFloat(element.style.animationDuration) || 60, direction: -1 };
    }
    if (element.classList.contains('ring-marker-spin')) return { duration: 6, direction: 1 };
    if (element.classList.contains('rotating-squares')) return { duration: 60, direction: 1 };
    if (element.classList.contains('rotating-square')) return { duration: 2, direction: -1 };
    if (element.matches('.segmented-ring.ring-0')) return { duration: 100, direction: 1 };
    if (element.matches('.segmented-ring.ring-1')) return { duration: 80, direction: -1 };
    if (element.matches('.segmented-ring.ring-2')) return { duration: 60, direction: -1 };
    return null;
  }

  function register(root) {
    root.querySelectorAll([
      '.ring-spin-cw', '.ring-spin-ccw', '.ring-marker-spin',
      '.rotating-squares', '.rotating-square', '.segmented-ring'
    ].join(',')).forEach(function (element) {
      if (motions.has(element)) return;
      const motion = specification(element);
      if (!motion) return;
      motion.delay = parseFloat(element.style.animationDelay) || 0;
      // CSS animation time begins when the element itself enters the document. Dynamic
      // wheel rings are added about a second after navigation, so a page-global clock
      // shifts their pose relative to desktop even when speed and axis are correct.
      motion.start = performance.now() / 1000;
      motions.set(element, motion);
    });
  }

  function draw(now) {
    if (now - previousFrame >= 1000 / 30) {
      previousFrame = now;
      motions.forEach(function (motion, element) {
        if (!element.isConnected) {
          motions.delete(element);
          return;
        }
        const elapsed = now / 1000 - motion.start - motion.delay;
        const angle = motion.direction * (elapsed % motion.duration) / motion.duration * 360;
        // Use the same CSS property as desktop so transform-box and transform-origin
        // retain the exact axis defined by the existing stylesheet.
        element.style.transform = 'rotate(' + angle + 'deg)';
      });
    }
    window.requestAnimationFrame(draw);
  }

  register(document);
  if (typeof MutationObserver === 'function') {
    new MutationObserver(function (records) {
      records.forEach(record => record.addedNodes.forEach(node => {
        if (node.nodeType === 1) register(node.parentElement || document);
      }));
    }).observe(document.getElementById('stage'), { childList: true, subtree: true });
  }
  window.requestAnimationFrame(draw);
})();
