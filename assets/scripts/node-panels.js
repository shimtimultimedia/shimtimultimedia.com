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

  /*
   * `home` is the node's resting position: 12 o'clock above the wheel, 6 o'clock below.
   *
   * `resizes` marks a node whose own content changes its width while the page is open,
   * and is therefore worth watching with a ResizeObserver. Only the welcome panel does:
   * it shrink-wraps a greeting that cycles through 36 languages. The title's text is
   * fixed, so observing it would be watching for something that cannot happen. Its width
   * still moves once when the webfont loads and again if the viewport crosses the point
   * where its clamped font-size starts scaling - both already handled, by
   * document.fonts.ready and by the resize handler.
   */
  const NODES = [
    { id: 'shimtiPanel', label: 'Shimti Multimedia panel', home: 'top', resizes: false },
    { id: 'shimtiPanelBottom', label: 'Welcome panel', home: 'bottom', resizes: true },
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
    place(node, left, top, true);
  }

  /** Re-measures everything. For wheel rebuilds, where only the wires need updating. */
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

  /* ------------------------------------------------------- orthogonal routing */

  const OBSTACLE_CLEARANCE = 26;

  /** Does an axis-aligned segment pass through the interior of a box? */
  function segmentHitsBox(x1, y1, x2, y2, box) {
    const e = 0.5;
    if (x1 === x2) {
      const [a, b] = y1 < y2 ? [y1, y2] : [y2, y1];
      return x1 > box.left + e && x1 < box.right - e && b > box.top + e && a < box.bottom - e;
    }
    const [a, b] = x1 < x2 ? [x1, x2] : [x2, x1];
    return y1 > box.top + e && y1 < box.bottom - e && b > box.left + e && a < box.right - e;
  }

  function pathHitsBox(points, box) {
    for (let i = 1; i < points.length; i += 1) {
      if (segmentHitsBox(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, box)) return true;
    }
    return false;
  }

  /** Total length of an orthogonal point run, for preferring the shortest clear route. */
  function pathLength(points) {
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
      total += Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
    }
    return total;
  }

  /** Collapses repeated and collinear points, then emits H/V commands only. */
  function toPath(points) {
    const pts = [points[0]];
    for (const p of points.slice(1)) {
      const last = pts[pts.length - 1];
      if (Math.abs(p.x - last.x) < 0.5 && Math.abs(p.y - last.y) < 0.5) continue;
      pts.push(p);
    }
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i += 1) {
      d += Math.abs(pts[i].x - pts[i - 1].x) < 0.5 ? ` V ${pts[i].y}` : ` H ${pts[i].x}`;
    }
    return d;
  }

  /**
   * Orthogonal route from a host node to its satellite panel, around the radial menu.
   *
   * Both boxes can be entered or left on any of their four edges. The edge pair is chosen
   * by which axis the boxes are actually SEPARATED on - the gap between their facing
   * edges, not the distance between their centres. Centre distance is the obvious measure
   * and it is wrong: two boxes can have their centres far apart horizontally while still
   * overlapping horizontally, which puts the exit edge past the entry edge and folds the
   * wire back through the host it came from.
   *
   * The direct route is then tested against the menu. A straight run between a host on
   * one side and a panel on the other passes right through it, so when that happens the
   * wire detours around - out of the host, along a lane clear of the menu, and back in to
   * the panel. The shortest candidate that touches nothing wins.
   */
  function routeBetween(from, to, obstacle) {
    const fx = from.left + from.width / 2;
    const fy = from.top + from.height / 2;
    const tx = to.left + to.width / 2;
    const ty = to.top + to.height / 2;

    const gapX = Math.max(to.left - from.right, from.left - to.right);
    const gapY = Math.max(to.top - from.bottom, from.top - to.bottom);
    const horizontal = (gapX >= 0 || gapY >= 0)
      ? gapX >= gapY
      : Math.abs(tx - fx) >= Math.abs(ty - fy);

    const c = OBSTACLE_CLEARANCE;
    let start;
    let end;
    const candidates = [];

    if (horizontal) {
      const right = tx >= fx;
      start = { x: right ? from.right : from.left, y: fy };
      end = { x: right ? to.left : to.right, y: ty };
      const dir = right ? 1 : -1;
      const mid = (start.x + end.x) / 2;

      // Direct: out, across, in.
      candidates.push([start, { x: mid, y: start.y }, { x: mid, y: end.y }, end]);

      if (obstacle) {
        // Around: step clear of the host, run along a lane above or below the menu, then
        // step back in to the panel. Entering horizontally at both ends keeps the ports
        // on the edges they belong to.
        const bx = start.x + dir * c;
        const ex = end.x - dir * c;
        for (const lane of [obstacle.top - c, obstacle.bottom + c]) {
          candidates.push([
            start,
            { x: bx, y: start.y },
            { x: bx, y: lane },
            { x: ex, y: lane },
            { x: ex, y: end.y },
            end,
          ]);
        }
      }
    } else {
      const below = ty >= fy;
      start = { x: fx, y: below ? from.bottom : from.top };
      end = { x: tx, y: below ? to.top : to.bottom };
      const dir = below ? 1 : -1;
      const mid = (start.y + end.y) / 2;

      candidates.push([start, { x: start.x, y: mid }, { x: end.x, y: mid }, end]);

      if (obstacle) {
        const by = start.y + dir * c;
        const ey = end.y - dir * c;
        for (const lane of [obstacle.left - c, obstacle.right + c]) {
          candidates.push([
            start,
            { x: start.x, y: by },
            { x: lane, y: by },
            { x: lane, y: ey },
            { x: end.x, y: ey },
            end,
          ]);
        }
      }
    }

    const clear = obstacle ? candidates.filter((pts) => !pathHitsBox(pts, obstacle)) : candidates;
    const chosen = (clear.length ? clear : candidates)
      .sort((a, b) => pathLength(a) - pathLength(b))[0];

    return { d: toPath(chosen), start, port: end };
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
  /*
   * How far a preview stands off from its host.
   *
   * Generous on purpose. At a small gap the preview crowds the title panel, and the
   * connector between them collapses to a stub that reads as the two boxes being stuck
   * together rather than wired. Standing it well clear gives the wire room to be legible
   * as a connection, which is the whole point of the node metaphor.
   *
   * It is a preference, not a guarantee: candidates are clamped into the viewport before
   * they are scored, so on a narrow window the gap simply closes up rather than pushing
   * the panel off screen.
   */
  const SATELLITE_GAP = 140;
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

    /*
     * Placement is scored, not ordered.
     *
     * Taking the first candidate that fit on screen meant the panel would happily land
     * on top of the radial menu, which is the one thing on the page it must not hide.
     * Every candidate is clamped into the viewport first - so all of them are valid
     * positions - and then ranked by how much of the menu they cover, with distance from
     * the host breaking ties. A placement that clears the menu always beats a closer one
     * that does not, and the panel is never pushed off screen to achieve it.
     *
     * Candidates sit on both sides and above and below, so the panel is free to move to
     * whichever side is actually clear rather than always favouring one.
     */
    const midTop = hostBox.top + hostBox.height / 2 - h / 2;

    // Each preview belongs to a hemisphere of the wheel - About, Shop and Media sit on
    // the left, Contact, AI and Work on the right - and opens on that side, so the panel
    // appears on the same side as the sector that summoned it. Carried on the markup as
    // data-hemisphere.
    const wantRight = sat.side !== 'left';

    const raw = [
      { left: hostBox.right + SATELLITE_GAP, top: hostBox.top },
      { left: hostBox.left - w - SATELLITE_GAP, top: hostBox.top },
      { left: hostBox.right + SATELLITE_GAP, top: midTop },
      { left: hostBox.left - w - SATELLITE_GAP, top: midTop },
      { left: hostBox.left, top: hostBox.bottom + SATELLITE_GAP },
      { left: hostBox.left, top: hostBox.top - h - SATELLITE_GAP },
      { left: hostBox.right + SATELLITE_GAP, top: hostBox.bottom + SATELLITE_GAP },
      { left: hostBox.left - w - SATELLITE_GAP, top: hostBox.bottom + SATELLITE_GAP },
      // Screen edges on the preferred side, so a boxed-in host still yields a placement
      // on the correct hemisphere rather than falling to whichever corner scores first.
      { left: EDGE_MARGIN, top: midTop },
      { left: window.innerWidth - w - EDGE_MARGIN, top: midTop },
      { left: EDGE_MARGIN, top: EDGE_MARGIN },
      { left: window.innerWidth - w - EDGE_MARGIN, top: EDGE_MARGIN },
      { left: EDGE_MARGIN, top: window.innerHeight - h - EDGE_MARGIN },
      { left: window.innerWidth - w - EDGE_MARGIN, top: window.innerHeight - h - EDGE_MARGIN },
    ];

    const maxLeft = Math.max(EDGE_MARGIN, window.innerWidth - w - EDGE_MARGIN);
    const maxTop = Math.max(EDGE_MARGIN, window.innerHeight - h - EDGE_MARGIN);

    /*
     * The foreground is the radial menu, the title node and the welcome node. Those are
     * the only things a preview must not cover; the ring field, the particles and the
     * arced wordmark are background, and a panel passing over them is fine.
     *
     * Node boxes are included because every candidate is clamped into the viewport
     * before scoring, and a clamp can push one straight back on top of the title it
     * hangs from. The menu is taken as its bounding square rather than its circle, which
     * errs toward a wider berth - the right way to be wrong here.
     */
    const wheel = wheelGeometry();
    const avoid = [
      {
        left: wheel.cx - wheel.r,
        top: wheel.cy - wheel.r,
        right: wheel.cx + wheel.r,
        bottom: wheel.cy + wheel.r,
      },
      ...nodes.map(nodeBox),
    ];

    const coverage = (c) => {
      let total = 0;
      for (const a of avoid) {
        const x = Math.max(0, Math.min(c.left + w, a.right) - Math.max(c.left, a.left));
        const y = Math.max(0, Math.min(c.top + h, a.bottom) - Math.max(c.top, a.top));
        total += x * y;
      }
      return total;
    };

    const hostCx = hostBox.left + hostBox.width / 2;
    const hostCy = hostBox.top + hostBox.height / 2;
    const distanceFromHost = (c) =>
      Math.hypot(c.left + w / 2 - hostCx, c.top + h / 2 - hostCy);

    /*
     * Ranking, in strict order of importance:
     *
     *   1. covers none of the foreground
     *   2. lands on the preview's own hemisphere
     *   3. sits closest to the host
     *
     * Combined into one number so the comparison cannot drift out of that order: the
     * weights are far enough apart that no amount of distance can outvote a side, and no
     * side can outvote covering the menu. Sorting by side before coverage would put a
     * panel on the correct side and on top of the menu, which is the worse failure.
     */
    const midX = window.innerWidth / 2;
    let best = null;
    for (const c of raw) {
      const cand = {
        left: clamp(c.left, EDGE_MARGIN, maxLeft),
        top: clamp(c.top, EDGE_MARGIN, maxTop),
      };
      const cover = coverage(cand);
      const near = distanceFromHost(cand);
      const onRight = cand.left + w / 2 >= midX;
      const wrongSide = onRight === wantRight ? 0 : 1;
      const score = cover * 1e7 + wrongSide * 1e4 + near;
      if (!best || score < best.score) {
        best = { ...cand, cover, near, wrongSide, score };
      }
    }

    const { left, top } = best;

    sat.el.style.left = `${left}px`;
    sat.el.style.top = `${top}px`;

    const satBox = { left, top, width: w, height: h, right: left + w, bottom: top + h };
    // The menu is the one thing a wire must not cross; the ring field and wordmark are
    // background and a wire over them is fine.
    const menuBox = {
      left: wheel.cx - wheel.r,
      top: wheel.cy - wheel.r,
      right: wheel.cx + wheel.r,
      bottom: wheel.cy + wheel.r,
    };
    const { d, start, port } = routeBetween(hostBox, satBox, menuBox);
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

  /** Rounds one coordinate onto the background lattice. */
  function snapCoord(value, origin, spacing) {
    return origin + Math.round((value - origin) / spacing) * spacing;
  }

  /**
   * Snaps a node so its PORT lands on a background-grid intersection.
   *
   * The port is the small circle on the panel's edge where its wire attaches - that is
   * the node in the graph sense, and it is what should sit on the lattice. Snapping the
   * panel's centre instead would leave the port floating between lines, which is the one
   * point that visibly connects to anything.
   *
   * Which edge the port sits on depends on where the panel is relative to the wheel, so
   * the route is resolved for the tentative position first and the panel is then shifted
   * by whatever moves that port onto the nearest intersection.
   *
   * The lattice comes from background.js, which owns it. If the background has not
   * initialised, the position passes through untouched rather than being snapped to a
   * guessed spacing.
   *
   * @returns {{left:number, top:number}} the shifted top-left
   */
  function snapPortToGrid(node, left, top) {
    const grid = window.ShimtiGrid;
    if (!grid) return { left, top };

    const box = {
      left,
      top,
      width: node.w,
      height: node.h,
      right: left + node.w,
      bottom: top + node.h,
    };
    const { start } = route(box, wheelGeometry());

    let snappedLeft = left + (snapCoord(start.x, grid.originX, grid.spacing) - start.x);
    let snappedTop = top + (snapCoord(start.y, grid.originY, grid.spacing) - start.y);

    /*
     * Nearest intersection first, then step inward by whole cells until the panel fits.
     *
     * Clamping alone would defeat the snap: the title's port wants the line above its
     * resting position, which puts the panel slightly off the top of the screen, and the
     * clamp then drags it back to the margin - leaving the port a few pixels off the
     * lattice, which is exactly what this is meant to prevent. Moving by whole cells
     * keeps it on the grid while bringing it into view.
     *
     * The loops are bounded: a panel taller or wider than the viewport would otherwise
     * never satisfy both edges.
     */
    const maxLeft = window.innerWidth - node.w - EDGE_MARGIN;
    const maxTop = window.innerHeight - node.h - EDGE_MARGIN;
    for (let i = 0; i < 40 && snappedLeft < EDGE_MARGIN; i += 1) snappedLeft += grid.spacing;
    for (let i = 0; i < 40 && snappedLeft > maxLeft; i += 1) snappedLeft -= grid.spacing;
    for (let i = 0; i < 40 && snappedTop < EDGE_MARGIN; i += 1) snappedTop += grid.spacing;
    for (let i = 0; i < 40 && snappedTop > maxTop; i += 1) snappedTop -= grid.spacing;

    return { left: snappedLeft, top: snappedTop };
  }

  /**
   * Moves a node to an absolute viewport position, never allowing it off screen.
   *
   * Uses the cached size rather than measuring, so this stays a pure write during a
   * drag: no layout is read, and the panel's style and its wire are both derived from
   * node.left/node.top in the same pass.
   *
   * Snapping applies to the resting positions too, so a port sits on the lattice from the
   * moment the page loads rather than only once it has been dragged. Horizontal centring
   * survives it: at 12 and 6 o'clock the port is at the panel's horizontal centre, the
   * grid is laid out from the screen centre, so that centre line is itself a grid line.
   *
   * Snapping happens before clamping, so a node driven into a screen edge stops at the
   * edge rather than at a lattice point beyond it.
   */
  function place(node, left, top, snap) {
    if (snap) ({ left, top } = snapPortToGrid(node, left, top));
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

    const move = (e) => place(node, e.clientX - grabX, e.clientY - grabY, true);

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
    place(node, node.left + dx, node.top + dy, true);
  }

  /* ---------------------------------------------------------------------- init */

  function init() {
    for (const spec of NODES) {
      const el = document.getElementById(spec.id);
      if (!el) continue;

      const node = { id: spec.id, home: spec.home, resizes: spec.resizes, el, wire: makeWire(), originalCss: el.style.cssText };
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

    /*
     * The welcome panel shrink-wraps its greeting, so its width changes every time the
     * carousel cycles - and it must stay centred on the wheel's axis through every one
     * of those changes.
     *
     * A ResizeObserver watches the box itself. Watching the TEXT for mutations and
     * re-measuring in response was subtly wrong: the callback runs as a microtask, and
     * the size read back could still be the old one, so the panel was positioned using a
     * width it no longer had and settled off centre - visibly left of the wire still
     * dropping down the centre line.
     *
     * A ResizeObserver cannot have that problem: it fires because the size changed and
     * hands over the new size. Repositioning does not resize anything, so this cannot
     * feed back on itself.
     */
    if (window.ResizeObserver) {
      const sizeObserver = new ResizeObserver((entries) => {
        let changed = false;
        for (const entry of entries) {
          const node = nodes.find((n) => n.el === entry.target);
          if (!node) continue;

          // Border box, to match getBoundingClientRect - contentRect excludes padding and
          // border, which would under-measure this panel by 36px and shift it off centre.
          const border = entry.borderBoxSize && entry.borderBoxSize[0];
          const w = border ? border.inlineSize : node.el.getBoundingClientRect().width;
          const h = border ? border.blockSize : node.el.getBoundingClientRect().height;
          if (Math.abs(w - node.w) < 0.5 && Math.abs(h - node.h) < 0.5) continue;

          const cx = node.left + node.w / 2;
          const cy = node.top + node.h / 2;
          node.w = w;
          node.h = h;

          // Untouched nodes return home, which re-centres them. A node the visitor moved
          // keeps its centre, so it grows evenly either side instead of creeping sideways.
          if (node.userMoved) {
            place(node, cx - w / 2, cy - h / 2);
          } else {
            const home = homePosition(node);
            place(node, home.left, home.top, true);
          }
          changed = true;
        }
        if (changed) drawWires();
      });
      for (const node of nodes) if (node.resizes) sizeObserver.observe(node.el);
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
      sat.side = el.dataset.hemisphere === 'left' ? 'left' : 'right';

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
