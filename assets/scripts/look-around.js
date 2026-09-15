/*
 * One-finger pan for the fixed homepage composition on touch screens.
 *
 * Scaling this oversized SVG/canvas subtree makes Chrome re-raster it and can expose
 * blank compositor tiles on a phone. This handler therefore translates only. Two-finger
 * pinch is left to the browser so users retain page magnification.
 */
(function () {
  'use strict';

  const stage = document.getElementById('stage');
  if (!stage) return;
  if (!window.matchMedia || !window.matchMedia('(pointer: coarse)').matches) return;

  const MAX_PAN = 260;
  const DRAG_THRESHOLD = 8;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let panX = 0;
  let panY = 0;
  let dragging = false;
  let suppressClick = false;
  let settleTimer = 0;

  function paint() {
    stage.style.transform = 'translate3d(' + panX + 'px,' + panY + 'px,0)';
  }

  function finishSettle() {
    clearTimeout(settleTimer);
    stage.classList.remove('is-recentring', 'is-gesturing');
  }

  function settle() {
    panX = 0;
    panY = 0;
    stage.classList.add('is-recentring');
    paint();
    settleTimer = setTimeout(finishSettle,
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450);
  }

  stage.addEventListener('click', function (event) {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, { capture: true });

  stage.addEventListener('transitionend', function (event) {
    if (event.target === stage && event.propertyName === 'transform') finishSettle();
  });

  stage.addEventListener('pointerdown', function (event) {
    if (event.pointerType === 'mouse' || pointerId !== null) return;
    if (event.target.closest && event.target.closest('.node-panel')) return;

    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    dragging = false;
    suppressClick = false;
    clearTimeout(settleTimer);
    stage.classList.remove('is-recentring');
    stage.classList.add('is-gesturing');
  });

  stage.addEventListener('pointermove', function (event) {
    if (event.pointerId !== pointerId) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;

    if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!dragging) {
      dragging = true;
      try { stage.setPointerCapture(event.pointerId); } catch (err) { /* optional */ }
    }

    panX = Math.max(-MAX_PAN, Math.min(MAX_PAN, dx));
    panY = Math.max(-MAX_PAN, Math.min(MAX_PAN, dy));
    paint();
  });

  function release(event) {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    suppressClick = dragging;
    dragging = false;
    settle();
  }

  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  window.addEventListener('orientationchange', function () {
    pointerId = null;
    dragging = false;
    suppressClick = false;
    settle();
  });
})();
