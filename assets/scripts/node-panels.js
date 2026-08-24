/*
 * Shimti Multimedia: node panels
 *
 * Turns the branding panel and the welcome panel into draggable nodes wired back to the
 * radial menu, the way a visual scripting editor behaves - Blender's node editor,
 * Unreal Blueprints, Houdini. Grab a node, move it anywhere, and the wire re-routes to
 * follow it.
 *
 * Wires are ORTHOGONAL. Every segment is horizontal or vertical, meeting at right
 * angles, like a circuit trace. No curves anywhere: the previous bottom connector was a
 * quadratic Bezier, which is the one thing this must not look like.
 *
 * Design notes:
 *
 * - This module is the single owner of connector geometry. The connectors used to be
 *   built inside ui-elements.js and duplicated across its build and resize-rebuild
 *   paths, so there were two copies of the same geometry and neither could follow a
 *   moving panel. They are drawn here instead, into #nodeWires, which nothing else
 *   touches.
 *
 * - The wheel's position is measured from the rendered #wheelMenu rather than read from
 *   a shared constant, so the wires stay attached if the wheel's size or centre ever
 *   changes. It falls back to the viewport centre before the wheel is built.
 *
 * - Dragging has a keyboard equivalent. WCAG 2.2 SC 2.5.7 (Dragging Movements) requires
 *   that anything achievable by dragging is achievable without it; the panels are
 *   focusable and move with the arrow keys.
 *
 * @requires DOM: #shimtiPanel, #shimtiPanelBottom, #nodeWires, #wheelMenu
 */

'use strict';

(function () {
  const wireLayer = document.getElementById('nodeWires');
  if (!wireLayer) return;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const EDGE_MARGIN = 8;      // Keeps a node clear of the very edge of the screen.
  const KEY_STEP = 8;         // Pixels moved per arrow-key press.
  const KEY_STEP_LARGE = 32;  // With Shift held.
  const PORT_RADIUS = 5;

  // `home` is the node's resting position: 12 o'clock above the wheel, 6 o'clock below.
  const NODES = [
    { id: 'shimtiPanel', label: 'Shimti Multimedia panel', home: 'top' },
    { id: 'shimtiPanelBottom', label: 'Welcome panel', home: 'bottom' },
  ];

  const HOME_MARGIN_TOP = 20;
  const HOME_MARGIN_BOTTOM = 12;

  const nodes = [];

  /* ---------------------------------------------------------------- geometry */

  /*
   * Cached geometry.
   *
   * Nothing here reads layout while a drag is in progress. Measuring inside pointermove
   * is what made the wire trail behind the panel: each move wrote style.left/top and
   * then called getBoundingClientRect, forcing a synchronous reflow on every event.
   * Two panels plus an SVG bounding-box read per move overruns the frame budget, so the
   * panel - which the compositor can move cheaply - paints while the wire arrives a
   * frame or two later.
   *
   * Sizes and the wheel's position cannot change during a drag, so they are measured
   * once and reused. Both the panel's style and its wire are then derived from the same
   * in-memory numbers, which is what guarantees they land in the same frame.
   */
  let wheelCache = null;

  function measureWheel() {
    const wheel = document.getElementById('wheelMenu');
    const box = wheel && wheel.getBoundingClientRect();
    wheelCache = (box && box.width > 0)
      ? { cx: box.left + box.width / 2, cy: box.top + box.height / 2, r: box.width / 2 }
      : { cx: window.innerWidth / 2, cy: window.innerHeight / 2, r: 180 };
    return wheelCache;
  }

  function wheelGeometry() {
    return wheelCache || measureWheel();
  }

  /** Caches a node's rendered size. Called only when it can actually have changed. */
  function measureNode(node) {
    const r = node.el.getBoundingClientRect();
    node.w = r.width;
    node.h = r.height;
  }

  /** A node's box built from cached numbers, with no layout read. */
  function nodeBox(node) {
    return {
      left: node.left,
      top: node.top,
      width: node.w,
      height: node.h,
      right: node.left + node.w,
      bottom: node.top + node.h,
    };
  }

  /**
   * The node's resting position, computed rather than measured.
   *
   * Reading the stylesheet-rendered position instead was subtly wrong: the branding
   * panel is centred with translateX(-50%), and its width depends on the Orbitron
   * webfont. Measuring before that font loads captures a narrower box, so the stored
   * left ended up around 12px off centre and stayed there. Deriving the position from
   * the current width is correct whenever it runs.
   */
  function homePosition(node) {
    const left = (window.innerWidth - node.w) / 2;
    const top = node.home === 'bottom'
      ? window.innerHeight - node.h - HOME_MARGIN_BOTTOM
      : HOME_MARGIN_TOP;
    return { left, top };
  }

  /** Returns a node to its resting position, unless the visitor has moved it. */
  function applyHome(node) {
    if (node.userMoved) return;
    measureNode(node);
    const { left, top } = homePosition(node);
    place(node, left, top);
  }

  /** Re-measures everything. For resize, wheel rebuilds and content changes. */
  function remeasure() {
    measureWheel();
    for (const node of nodes) measureNode(node);
    drawWires();
  }

  /**
   * Builds an orthogonal route from a node to the wheel.
   *
   * Picks the wheel port on the side the node actually sits on, leaves the node from the
   * edge facing that port, and connects the two with a right-angled Z: out, across, in.
   * That is the "step" wire style of a node editor, and it stays readable wherever the
   * node is dragged.
   */
  function route(nodeRect, wheel) {
    const nx = nodeRect.left + nodeRect.width / 2;
    const ny = nodeRect.top + nodeRect.height / 2;
    const dx = nx - wheel.cx;
    const dy = ny - wheel.cy;

    // The axis the node sits furthest out on decides which port it plugs into. At the
    // resting positions - 12 and 6 o'clock - that is the vertical axis, so the wire runs
    // straight down out of the title's bottom edge into the top of the wheel, and
    // straight up out of the welcome panel's top edge into the bottom of it.
    if (Math.abs(dy) >= Math.abs(dx)) {
      const side = Math.sign(dy) || -1;
      const port = { x: wheel.cx, y: wheel.cy + side * wheel.r };
      // Leave from the node edge facing the wheel, at its horizontal centre.
      const start = { x: nx, y: side > 0 ? nodeRect.top : nodeRect.bottom };

      // Centred on the port: one unbroken vertical line, with no redundant command.
      if (Math.abs(start.x - port.x) < 0.5) {
        return { d: `M ${port.x} ${start.y} V ${port.y}`, start: { x: port.x, y: start.y }, port };
      }

      // Dragged off the axis: drop halfway, step across, continue down. The crossing
      // happens at the midpoint between node and wheel, which is clear of the wheel
      // because the node is above or below it.
      const mid = (start.y + port.y) / 2;
      return { d: `M ${start.x} ${start.y} V ${mid} H ${port.x} V ${port.y}`, start, port };
    }

    // Node is out to one side: use the left or right port instead.
    const side = Math.sign(dx) || 1;
    const port = { x: wheel.cx + side * wheel.r, y: wheel.cy };
    const start = { x: side > 0 ? nodeRect.left : nodeRect.right, y: ny };

    if (Math.abs(start.y - port.y) < 0.5) {
      return { d: `M ${start.x} ${port.y} H ${port.x}`, start: { x: start.x, y: port.y }, port };
    }

    // Run to the port's own column before turning. Bending at the midpoint would put the
    // vertical segment inside the wheel; the port sits on the wheel's extremity, so its
    // column is tangent to the circle and always clear.
    return { d: `M ${start.x} ${start.y} H ${port.x} V ${port.y}`, start, port };
  }

  /**
   * Orthogonal route between two rectangles, for wiring a satellite panel to its host
   * node. Same right-angled Z as route(), but ending on a box edge rather than a point
   * on the wheel.
   */
  function routeBetween(from, to) {
    const fy = from.top + from.height / 2;
    const ty = to.top + to.height / 2;

    // Side ports only, matching route(). Which side depends on where the satellite ended
    // up relative to its host, so the wire leaves the facing edge of each box.
    const right = to.left + to.width / 2 >= from.left + from.width / 2;
    const start = { x: right ? from.right : from.left, y: fy };
    const end = { x: right ? to.left : to.right, y: ty };
    const mid = (start.x + end.x) / 2;

    return { d: `M ${start.x} ${start.y} H ${mid} V ${end.y} H ${end.x}`, start, port: end };
  }

  /* -------------------------------------------------------------- satellites */

  /*
   * A satellite is a panel that hangs off a node rather than off the wheel - the section
   * previews attached to the branding panel.
   *
   * It is placed beside its host and wired to it, and it follows whenever the host is
   * dragged. Placement is clamped to the viewport and falls back through candidate sides
   * so the panel can never end up hanging off the edge of the screen, no matter where
   * the host has been moved to.
   */
  const satellites = [];
  const SATELLITE_GAP = 18;
  // Below this width the stylesheet turns the previews into a bottom sheet, which is far
  // more usable on a phone than a panel tethered to a node. Anchoring is skipped there.
  const ANCHOR_MIN_WIDTH = 901;

  function anchoringEnabled() {
    return window.innerWidth >= ANCHOR_MIN_WIDTH;
  }

  function positionSatellite(sat) {
    const host = nodes.find((n) => n.id === sat.hostId);
    if (!host) return;

    // Cached size, never measured here. positionSatellite runs on every drag frame via
    // drawWires, so a getBoundingClientRect in this function would reintroduce exactly
    // the per-move synchronous reflow that made the wires lag in the first place.
    // A panel's size is fixed once it is open, so measuring at anchor time is enough.
    const w = sat.w;
    const h = sat.h;
    const hostBox = nodeBox(host);

    // Candidate placements, in order of preference: right of the host, left of it, below,
    // then above. The first that fits entirely on screen wins.
    const candidates = [
      { left: hostBox.right + SATELLITE_GAP, top: hostBox.top },
      { left: hostBox.left - w - SATELLITE_GAP, top: hostBox.top },
      { left: hostBox.left, top: hostBox.bottom + SATELLITE_GAP },
      { left: hostBox.left, top: hostBox.top - h - SATELLITE_GAP },
    ];

    const fits = (c) =>
      c.left >= EDGE_MARGIN &&
      c.top >= EDGE_MARGIN &&
      c.left + w <= window.innerWidth - EDGE_MARGIN &&
      c.top + h <= window.innerHeight - EDGE_MARGIN;

    // If none fits outright, clamp the first candidate. Clamping always yields a fully
    // on-screen box, so the panel is never cut off - it just sits closer to the host.
    const chosen = candidates.find(fits) || candidates[0];
    const left = clamp(chosen.left, EDGE_MARGIN, Math.max(EDGE_MARGIN, window.innerWidth - w - EDGE_MARGIN));
    const top = clamp(chosen.top, EDGE_MARGIN, Math.max(EDGE_MARGIN, window.innerHeight - h - EDGE_MARGIN));

    sat.el.style.left = `${left}px`;
    sat.el.style.top = `${top}px`;

    const satBox = { left, top, width: w, height: h, right: left + w, bottom: top + h };
    const { d, start, port } = routeBetween(hostBox, satBox);
    sat.wire.path.setAttribute('d', d);
    sat.wire.from.setAttribute('cx', start.x);
    sat.wire.from.setAttribute('cy', start.y);
    sat.wire.to.setAttribute('cx', port.x);
    sat.wire.to.setAttribute('cy', port.y);
  }

  function updateSatellites() {
    for (const sat of satellites) if (sat.active) positionSatellite(sat);
  }

  /* ------------------------------------------------------------------ wires */

  function makeWire() {
    const g = document.createElementNS(SVG_NS, 'g');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('class', 'node-wire');
    const from = document.createElementNS(SVG_NS, 'circle');
    from.setAttribute('class', 'node-port');
    from.setAttribute('r', PORT_RADIUS);
    const to = document.createElementNS(SVG_NS, 'circle');
    to.setAttribute('class', 'node-port');
    to.setAttribute('r', PORT_RADIUS);
    g.append(path, from, to);
    wireLayer.appendChild(g);
    return { path, from, to };
  }

  function drawWires() {
    const wheel = wheelGeometry();
    for (const node of nodes) {
      const { d, start, port } = route(nodeBox(node), wheel);
      node.wire.path.setAttribute('d', d);
      node.wire.from.setAttribute('cx', start.x);
      node.wire.from.setAttribute('cy', start.y);
      node.wire.to.setAttribute('cx', port.x);
      node.wire.to.setAttribute('cy', port.y);
    }
    updateSatellites();
  }

  /* -------------------------------------------------------------- positioning */

  function clamp(value, min, max) {
    // max can fall below min on a very small viewport; min wins so the node stays
    // reachable rather than being pushed off the top-left.
    return Math.max(min, Math.min(value, max));
  }

  /**
   * Moves a node to an absolute viewport position, never allowing it off screen.
   *
   * Uses the cached size rather than measuring, so this stays a pure write during a
   * drag: no layout is read, and the panel's style and its wire are both derived from
   * node.left/node.top in the same pass.
   */
  function place(node, left, top) {
    const maxLeft = window.innerWidth - node.w - EDGE_MARGIN;
    const maxTop = window.innerHeight - node.h - EDGE_MARGIN;
    node.left = clamp(left, EDGE_MARGIN, maxLeft);
    node.top = clamp(top, EDGE_MARGIN, maxTop);
    node.el.style.left = `${node.left}px`;
    node.el.style.top = `${node.top}px`;
    drawWires();
  }

  /**
   * Switches a node from its stylesheet position to explicit coordinates.
   *
   * Both panels are laid out by the stylesheet - one with top/left, the other centred
   * with bottom plus translateX(-50%). Dragging needs a single, absolute frame of
   * reference, so the current rendered position is measured once and becomes the
   * starting left/top, with the centring transform cleared so it cannot fight the drag.
   */
  function detach(node) {
    const r = node.el.getBoundingClientRect();
    node.el.style.transform = 'none';
    node.el.style.right = 'auto';
    node.el.style.bottom = 'auto';
    node.el.style.left = `${r.left}px`;
    node.el.style.top = `${r.top}px`;
    node.left = r.left;
    node.top = r.top;
    node.w = r.width;
    node.h = r.height;
  }

  /*
   * Layout is deliberately NOT persisted.
   *
   * The 12 and 6 o'clock composition is part of the design, so every visit opens on it.
   * Saving positions meant that once a visitor nudged a panel, every later visit began
   * with it displaced and nothing on screen explaining why - and a stored layout only
   * means anything relative to the defaults it was saved against, so changing those
   * defaults silently stranded it. Dragging is exploration; a reload restores the
   * intended arrangement.
   */

  function resetAll() {
    for (const node of nodes) {
      node.el.style.cssText = node.originalCss;
      node.userMoved = false;
      detach(node);
      applyHome(node);
    }
    drawWires();
  }

  /* ------------------------------------------------------------------ dragging */

  function startDrag(node, event) {
    // Never begin a drag from something interactive inside the node.
    if (event.target.closest('a, button, input, select, textarea')) return;
    if (event.button !== undefined && event.button !== 0) return;

    event.preventDefault();
    // setPointerCapture throws NotFoundError if the pointer is no longer active - a
    // pointer released between the event firing and this handler running, for instance.
    // Optional chaining does not help: it guards a missing method, not a thrown error.
    // Capture is an optimisation, so losing it must not abort the drag.
    try {
      node.el.setPointerCapture(event.pointerId);
    } catch {
      /* Drag still works via the listeners below. */
    }
    node.el.classList.add('is-dragging');

    // Cached position, not a measurement: the drag must not touch layout at all.
    const grabX = event.clientX - node.left;
    const grabY = event.clientY - node.top;

    const move = (e) => place(node, e.clientX - grabX, e.clientY - grabY);

    const end = (e) => {
      try {
        node.el.releasePointerCapture(e.pointerId);
      } catch {
        /* Capture may never have been taken; releasing it is best-effort. */
      }
      node.el.classList.remove('is-dragging');
      node.el.removeEventListener('pointermove', move);
      node.el.removeEventListener('pointerup', end);
      node.el.removeEventListener('pointercancel', end);
      node.userMoved = true;
    };

    node.el.addEventListener('pointermove', move);
    node.el.addEventListener('pointerup', end);
    node.el.addEventListener('pointercancel', end);
  }

  function onKey(node, event) {
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    let dx = 0;
    let dy = 0;
    if (event.key === 'ArrowLeft') dx = -step;
    else if (event.key === 'ArrowRight') dx = step;
    else if (event.key === 'ArrowUp') dy = -step;
    else if (event.key === 'ArrowDown') dy = step;
    else if (event.key === 'Home') { resetAll(); event.preventDefault(); return; }
    else return;

    event.preventDefault();
    node.userMoved = true;
    place(node, node.left + dx, node.top + dy);
  }

  /* ---------------------------------------------------------------------- init */

  function init() {
    for (const spec of NODES) {
      const el = document.getElementById(spec.id);
      if (!el) continue;

      const node = { id: spec.id, home: spec.home, el, wire: makeWire(), originalCss: el.style.cssText };
      nodes.push(node);

      detach(node);
      applyHome(node);

      el.classList.add('node-panel');
      el.tabIndex = 0;
      el.setAttribute('role', 'group');
      el.setAttribute('aria-roledescription', 'draggable panel');
      el.setAttribute('aria-label', `${spec.label}. Use the arrow keys to move it, Home to reset.`);

      el.addEventListener('pointerdown', (e) => startDrag(node, e));
      el.addEventListener('keydown', (e) => onKey(node, e));
      el.addEventListener('dblclick', resetAll);
    }

    drawWires();

    // Orbitron loads after first paint and changes the branding panel's width, which
    // moves its centre. Re-home once the font is ready so 12 o'clock is exact.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        for (const node of nodes) applyHome(node);
      });
    }

    // Re-clamp on resize: a node parked against the right edge would otherwise end up
    // outside a narrowed window, unreachable and unrecoverable.
    window.addEventListener('resize', () => {
      // The wheel re-centres and the panels can reflow, so the caches are stale here.
      measureWheel();
      for (const node of nodes) {
        measureNode(node);
        if (node.userMoved) place(node, node.left, node.top);
        else applyHome(node);
      }
    });

    // The wheel is built about a second after DOMContentLoaded and rebuilt on resize.
    // Redraw whenever it changes so the wires stay attached to where it actually is.
    const uiSvg = document.getElementById('uiSvg');
    if (uiSvg) {
      new MutationObserver(remeasure).observe(uiSvg, { childList: true, subtree: true });
    }

    // The welcome carousel changes the bottom panel's text, which can change its width.
    const welcome = document.getElementById('welcomeText');
    if (welcome) {
      new MutationObserver(remeasure).observe(welcome, { childList: true, characterData: true, subtree: true });
    }
  }

  /* ------------------------------------------------------------------- api */

  /*
   * Exposed so section-panels.js can attach a preview to a node without duplicating any
   * geometry. Keeping every position and every wire in one module is what stopped the
   * original connectors from being computed in two places that could disagree.
   */
  window.ShimtiNodes = {
    /** Attaches `el` beside the node `hostId`, wired to it, and keeps it there. */
    anchorTo(hostId, el) {
      if (!el) return;
      let sat = satellites.find((s) => s.el === el);
      if (!sat) {
        sat = { el, hostId, wire: makeWire(), active: false };
        satellites.push(sat);
      }
      sat.hostId = hostId;

      if (!anchoringEnabled()) {
        // Narrow viewport: the stylesheet's bottom sheet takes over, so drop the inline
        // position it would otherwise fight and hide the wire.
        el.style.left = '';
        el.style.top = '';
        sat.wire.path.setAttribute('d', '');
        sat.wire.from.setAttribute('cx', -9999);
        sat.wire.to.setAttribute('cx', -9999);
        sat.active = false;
        return;
      }

      // Measure once, here, while it is safe to touch layout.
      const r = el.getBoundingClientRect();
      sat.w = r.width;
      sat.h = r.height;
      sat.active = true;
      positionSatellite(sat);
    },

    /** Detaches `el`, hiding its wire. */
    release(el) {
      const sat = satellites.find((s) => s.el === el);
      if (!sat) return;
      sat.active = false;
      sat.wire.path.setAttribute('d', '');
      sat.wire.from.setAttribute('cx', -9999);
      sat.wire.to.setAttribute('cx', -9999);
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
