/*
 * Pan and zoom the homepage on a touch screen, the way a phone treats a photograph.
 *
 * The composition is deliberately larger than a phone: the ring field runs 1200px around
 * a wheel that stays 250px on every screen, so a phone shows the middle of something
 * bigger. One finger drags that middle around; two fingers pinch it larger or smaller.
 *
 * Why this is scripted rather than left to the browser
 * ---------------------------------------------------
 * The browser's own pinch-zoom is normally the better answer and was tried first. It does
 * not work on this page, and the reason is structural: every layer here is position:
 * fixed. Native zoom moves the VISUAL viewport, while fixed elements are positioned
 * against the LAYOUT viewport, so as soon as the two diverge the layers stop agreeing
 * with each other - the wheel sits still while the background slides, and the page comes
 * apart. That is the glitch, and no amount of CSS fixes it while the layers are fixed.
 *
 * A transform on one element cannot desynchronise, because there is only one thing to
 * synchronise. Everything inside #stage keeps the exact geometry it computed - the wheel,
 * the wires, the panels - and the whole picture is scaled and moved as a single painted
 * layer. Nothing is re-laid-out, so nothing can break.
 *
 * This does mean #stage sets touch-action: none, which turns the browser's own zoom off
 * over the composition. That would be a bad trade if it removed the ability to magnify
 * the page - WCAG 1.4.4 exists for good reason - but it does not: it replaces a zoom that
 * visibly breaks this layout with one that works, over a wider range than the browser
 * offers, and it is the only page on the site that does this. Every other page is an
 * ordinary document where native zoom behaves correctly and is left alone.
 */
(function () {
  'use strict';

  const stage = document.getElementById('stage');
  if (!stage) return;

  // Touch only. A mouse can already reach everything, and hijacking click-drag on the
  // background would be a surprise rather than a feature.
  if (!window.matchMedia || !window.matchMedia('(pointer: coarse)').matches) return;

  // Hard limits, in both directions.
  //
  // Out is capped at 0.55 because past that the icons stop being reliable touch targets -
  // at 0.5 a 50px icon is 25px, which is below the 24px floor the rest of the site was
  // just brought up to. In is capped at 3 because beyond it the SVG's own stroke widths
  // start to read as slabs rather than lines.
  const MIN_SCALE = 0.55;
  const MAX_SCALE = 3;

  // How far the composition may be pulled at scale 1. Grows with the scale, because a
  // larger picture has correspondingly more of itself off the screen.
  const BASE_PAN = 260;

  // Below this a gesture is a tap, not a drag - otherwise the few pixels a finger moves
  // while tapping a menu sector would be read as a drag and swallow the tap.
  const DRAG_THRESHOLD = 8;

  // Within this of 1, treat the scale as 1 and return to the resting composition, so the
  // page always has a way back to how it is meant to look.
  const SNAP_BAND = 0.06;

  const pointers = new Map();

  let scale = 1;
  let panX = 0;
  let panY = 0;

  let dragStartX = 0;
  let dragStartY = 0;
  let dragOriginX = 0;
  let dragOriginY = 0;
  let dragging = false;

  let pinchStartDistance = 0;
  let pinchStartScale = 1;

  function maxPan() {
    return BASE_PAN * Math.max(1, scale);
  }

  function clampPan(value) {
    const limit = maxPan();
    return Math.max(-limit, Math.min(limit, value));
  }

  function paint() {
    stage.style.transform =
      'translate3d(' + panX + 'px,' + panY + 'px,0) scale(' + scale + ')';
  }

  function settle() {
    // A scale that has come back to roughly 1 returns the whole composition to rest,
    // which is the only way back to the intended layout without a reload.
    if (Math.abs(scale - 1) < SNAP_BAND) {
      scale = 1;
      panX = 0;
      panY = 0;
      stage.classList.add('is-recentring');
    } else {
      panX = clampPan(panX);
      panY = clampPan(panY);
    }
    paint();
  }

  stage.addEventListener('transitionend', function (event) {
    if (event.propertyName === 'transform') stage.classList.remove('is-recentring');
  });

  function centreOf(list) {
    let x = 0;
    let y = 0;
    list.forEach(function (p) { x += p.x; y += p.y; });
    return { x: x / list.length, y: y / list.length };
  }

  function distanceOf(list) {
    return Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y);
  }

  stage.addEventListener('pointerdown', function (event) {
    if (event.pointerType === 'mouse') return;
    // The panels are their own draggable objects and own this gesture.
    if (event.target.closest && event.target.closest('.node-panel')) return;

    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    stage.classList.remove('is-recentring');

    const list = Array.from(pointers.values());
    if (list.length === 1) {
      dragging = false;
      dragStartX = event.clientX;
      dragStartY = event.clientY;
      dragOriginX = panX;
      dragOriginY = panY;
    } else if (list.length === 2) {
      dragging = false;
      pinchStartDistance = distanceOf(list);
      pinchStartScale = scale;
    }
  });

  stage.addEventListener('pointermove', function (event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    const list = Array.from(pointers.values());

    if (list.length >= 2) {
      const distance = distanceOf(list);
      if (pinchStartDistance > 0) {
        const next = pinchStartScale * (distance / pinchStartDistance);
        scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
        panX = clampPan(panX);
        panY = clampPan(panY);
        paint();
      }
      return;
    }

    const dx = event.clientX - dragStartX;
    const dy = event.clientY - dragStartY;

    if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!dragging) {
      dragging = true;
      try { stage.setPointerCapture(event.pointerId); } catch (err) { /* optional */ }
    }

    panX = clampPan(dragOriginX + dx);
    panY = clampPan(dragOriginY + dy);
    paint();
  });

  function release(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);

    if (dragging) {
      // A drag that happens to end over a menu sector must not also navigate.
      stage.addEventListener('click', function swallow(clickEvent) {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
      }, { capture: true, once: true });
    }

    if (pointers.size === 0) {
      dragging = false;
      pinchStartDistance = 0;
      settle();
    } else if (pointers.size === 1) {
      // Second finger lifted mid-pinch: continue as a drag from where that finger is,
      // rather than jumping the composition by the difference.
      const remaining = Array.from(pointers.entries())[0];
      dragStartX = remaining[1].x;
      dragStartY = remaining[1].y;
      dragOriginX = panX;
      dragOriginY = panY;
      dragging = false;
      pinchStartDistance = 0;
    }
  }

  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);

  // Orientation change re-lays-out everything underneath; the transform is no longer
  // meaningful against the new geometry, so the composition returns to rest.
  window.addEventListener('orientationchange', function () {
    scale = 1;
    panX = 0;
    panY = 0;
    pointers.clear();
    stage.classList.add('is-recentring');
    paint();
  });
})();
