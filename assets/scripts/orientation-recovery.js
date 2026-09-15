/*
 * Android Chrome can preserve the landscape layout viewport when returning to portrait.
 * On the Galaxy A57 this leaves innerWidth at 755 while documentElement.clientWidth is
 * 384, and Chrome scales the whole page to 0.5087. A fresh load immediately restores the
 * correct 384px viewport.
 *
 * Reload only after an orientation transition and only when that exact mismatch exists.
 * Ordinary resizes, correct rotations, desktop browsers and accessibility zoom never
 * enter this path.
 */

'use strict';

(function () {
  if (!window.matchMedia || !window.matchMedia('(pointer: coarse)').matches) return;

  let armedUntil = 0;
  let checkTimer = 0;

  function checkViewport() {
    checkTimer = 0;
    if (performance.now() > armedUntil) return;

    const layoutWidth = document.documentElement.clientWidth;
    const visualScale = window.visualViewport ? window.visualViewport.scale : 1;
    const retainedLandscapeWidth = window.innerWidth > layoutWidth * 1.25;
    const browserScaledPage = visualScale < 0.8;

    if (retainedLandscapeWidth && browserScaledPage) window.location.reload();
  }

  function scheduleCheck() {
    clearTimeout(checkTimer);
    checkTimer = window.setTimeout(checkViewport, 120);
  }

  window.addEventListener('orientationchange', () => {
    armedUntil = performance.now() + 1500;
    scheduleCheck();
  });
  window.addEventListener('resize', scheduleCheck);
})();
