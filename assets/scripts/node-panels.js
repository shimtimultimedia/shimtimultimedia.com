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
  const STORAGE_KEY = 'shimti.nodePositions';

  const NODES = [
    { id: 'shimtiPanel', label: 'Shimti Multimedia panel' },
    { id: 'shimtiPanelBottom', label: 'Welcome panel' },
  ];

  const nodes = [];

  /* ---------------------------------------------------------------- geometry */

  /**
   * The rendered wheel, in screen pixels. Measured rather than assumed: #wheelMenu is
   * the group holding the six sectors, so its box is the wheel.
   */
  function wheelGeometry() {
    const wheel = document.getElementById('wheelMenu');
    const box = wheel && wheel.getBoundingClientRect();
    if (box && box.width > 0) {
      return { cx: box.left + box.width / 2, cy: box.top + box.height / 2, r: box.width / 2 };
    }
    return { cx: window.innerWidth / 2, cy: window.innerHeight / 2, r: 180 };
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

    // Whichever axis the node is further out on decides which port it plugs into.
    if (Math.abs(dx) >= Math.abs(dy)) {
      const side = Math.sign(dx) || 1;
      const port = { x: wheel.cx + side * wheel.r, y: wheel.cy };
      // Leave from the node edge that faces the wheel.
      const start = { x: side > 0 ? nodeRect.left : nodeRect.right, y: ny };
      const mid = (start.x + port.x) / 2;
      return {
        d: `M ${start.x} ${start.y} H ${mid} V ${port.y} H ${port.x}`,
        start,
        port,
      };
    }

    const side = Math.sign(dy) || 1;
    const port = { x: wheel.cx, y: wheel.cy + side * wheel.r };
    const start = { x: nx, y: side > 0 ? nodeRect.top : nodeRect.bottom };
    const mid = (start.y + port.y) / 2;
    return {
      d: `M ${start.x} ${start.y} V ${mid} H ${port.x} V ${port.y}`,
      start,
      port,
    };
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
      const r = node.el.getBoundingClientRect();
      const { d, start, port } = route(r, wheel);
      node.wire.path.setAttribute('d', d);
      node.wire.from.setAttribute('cx', start.x);
      node.wire.from.setAttribute('cy', start.y);
      node.wire.to.setAttribute('cx', port.x);
      node.wire.to.setAttribute('cy', port.y);
    }
  }

  /* -------------------------------------------------------------- positioning */

  function clamp(value, min, max) {
    // max can fall below min on a very small viewport; min wins so the node stays
    // reachable rather than being pushed off the top-left.
    return Math.max(min, Math.min(value, max));
  }

  /** Moves a node to an absolute viewport position, never allowing it off screen. */
  function place(node, left, top) {
    const r = node.el.getBoundingClientRect();
    const maxLeft = window.innerWidth - r.width - EDGE_MARGIN;
    const maxTop = window.innerHeight - r.height - EDGE_MARGIN;
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
  }

  /* -------------------------------------------------------------- persistence */

  function save() {
    try {
      const data = {};
      for (const n of nodes) data[n.id] = { left: n.left, top: n.top };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Private browsing or a full quota. Layout is a convenience, not state worth
      // interrupting anyone over.
    }
  }

  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function resetAll() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    for (const node of nodes) {
      node.el.style.cssText = node.originalCss;
      detach(node);
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

    const r = node.el.getBoundingClientRect();
    const grabX = event.clientX - r.left;
    const grabY = event.clientY - r.top;

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
      save();
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
    place(node, node.left + dx, node.top + dy);
    save();
  }

  /* ---------------------------------------------------------------------- init */

  function init() {
    const saved = load();

    for (const spec of NODES) {
      const el = document.getElementById(spec.id);
      if (!el) continue;

      const node = { id: spec.id, el, wire: makeWire(), originalCss: el.style.cssText };
      nodes.push(node);

      detach(node);
      const pos = saved[spec.id];
      if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
        place(node, pos.left, pos.top);
      }

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

    // Re-clamp on resize: a node parked against the right edge would otherwise end up
    // outside a narrowed window, unreachable and unrecoverable.
    window.addEventListener('resize', () => {
      for (const node of nodes) place(node, node.left, node.top);
    });

    // The wheel is built about a second after DOMContentLoaded and rebuilt on resize.
    // Redraw whenever it changes so the wires stay attached to where it actually is.
    const uiSvg = document.getElementById('uiSvg');
    if (uiSvg) {
      new MutationObserver(drawWires).observe(uiSvg, { childList: true, subtree: true });
    }

    // The welcome carousel changes the bottom panel's text, which can change its width.
    const welcome = document.getElementById('welcomeText');
    if (welcome) {
      new MutationObserver(drawWires).observe(welcome, { childList: true, characterData: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
