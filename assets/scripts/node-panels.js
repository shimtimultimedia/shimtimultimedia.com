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

  /*
   * Orthogonal connector routing, after Wybrow, Marriott and Stuckey (2009).
   *
   * WHY THIS, AND NOT A CHOSEN SHAPE
   *
   * Every earlier version of this picked a route SHAPE from the geometry - out the side,
   * jog to a lane, across, step back in - with a special case for each situation. The
   * literature calls that ad-hoc heuristic routing, and it failed here exactly the way it
   * is documented to fail: a shape that reads well in one arrangement produces a zig-zag
   * beside the node in another, a run laid along a panel's own border in a third, and a
   * line straight through the menu in a fourth. Adding a case per bad picture never
   * converges, because the cases were never the problem - choosing by shape was.
   *
   * WHAT NODE EDITORS ACTUALLY DO
   *
   *   1. Ports are FIXED at the centres of a node's four sides. They never slide along an
   *      edge to suit a route. Two nodes whose centres line up therefore always get one
   *      straight line - the property that kept breaking when ports were free to move.
   *   2. A wire leaves a port along that port's outward normal, so a wire out of the top
   *      goes up before it goes anywhere else, and the port always sits on the edge the
   *      wire actually departs from.
   *   3. Build an orthogonal visibility graph - the rows and columns through every port
   *      and every obstacle's cleared edges - and search it for the cheapest route, where
   *      cost is length PLUS a heavy penalty per bend.
   *
   * The bend penalty is what makes the result look designed rather than computed: offered
   * any choice, the router takes the straighter one, and it only turns when the turn buys
   * more than BEND_COST pixels of length or is the sole way past an obstacle. Which side a
   * wire leaves from is an OUTPUT of that search, not an input - it comes out of the right
   * of the title when the panel is to the right, and out of the top when the panel is
   * above, without either case being written down.
   */

  const CLEARANCE = 24;   // Stub off a port, and the berth kept around every obstacle.
  const BEND_COST = 260;  // A corner must save this many px of length to be worth taking.
  const EPS = 0.5;

  /** The four ports of a box: side centres, with the direction a wire must leave along. */
  function portsOf(box) {
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    return [
      { x: cx, y: box.top, dx: 0, dy: -1 },
      { x: cx, y: box.bottom, dx: 0, dy: 1 },
      { x: box.left, y: cy, dx: -1, dy: 0 },
      { x: box.right, y: cy, dx: 1, dy: 0 },
    ];
  }

  /** True when the open segment passes through any obstacle's interior. */
  function segmentBlocked(x1, y1, x2, y2, obstacles) {
    const lox = Math.min(x1, x2);
    const hix = Math.max(x1, x2);
    const loy = Math.min(y1, y2);
    const hiy = Math.max(y1, y2);
    for (const o of obstacles) {
      if (hix - lox > EPS) {
        // Horizontal run: blocked when its row cuts the box and the spans overlap.
        if (y1 > o.top + EPS && y1 < o.bottom - EPS &&
            lox < o.right - EPS && hix > o.left + EPS) return true;
      } else if (hiy - loy > EPS) {
        if (x1 > o.left + EPS && x1 < o.right - EPS &&
            loy < o.bottom - EPS && hiy > o.top + EPS) return true;
      }
    }
    return false;
  }

  /** Serialises a point list, merging collinear runs so no redundant command is emitted. */
  function toPath(points) {
    const pts = [points[0]];
    for (let i = 1; i < points.length; i += 1) {
      const p = points[i];
      const q = pts[pts.length - 1];
      if (Math.abs(p.x - q.x) < EPS && Math.abs(p.y - q.y) < EPS) continue;
      if (pts.length >= 2) {
        const r = pts[pts.length - 2];
        const sameCol = Math.abs(r.x - q.x) < EPS && Math.abs(q.x - p.x) < EPS;
        const sameRow = Math.abs(r.y - q.y) < EPS && Math.abs(q.y - p.y) < EPS;
        if (sameCol || sameRow) pts.pop();
      }
      pts.push(p);
    }
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i += 1) {
      d += Math.abs(pts[i].y - pts[i - 1].y) < EPS ? ` H ${pts[i].x}` : ` V ${pts[i].y}`;
    }
    return d;
  }

  /**
   * Cheapest orthogonal route between two boxes, keeping clear of `obstacles`.
   *
   * @returns {{d:string, start:{x:number,y:number}, port:{x:number,y:number}}}
   */
  function routeOrthogonal(fromBox, toBox, obstacles) {
    const fromPorts = portsOf(fromBox);
    const toPorts = portsOf(toBox);

    // The two endpoints' own bodies are obstacles as well, so a wire never cuts across
    // the panel it is attached to on its way somewhere else.
    const solid = [fromBox, toBox, ...obstacles];

    /*
     * The graph's candidate lines: every port's own row and column, so a straight
     * port-to-port shot always exists to be found, plus a cleared lane either side of
     * every obstacle, which is the only way around one.
     */
    const xs = new Set();
    const ys = new Set();
    for (const p of [...fromPorts, ...toPorts]) {
      xs.add(p.x);
      ys.add(p.y);
      xs.add(p.x + p.dx * CLEARANCE);
      ys.add(p.y + p.dy * CLEARANCE);
    }
    for (const o of solid) {
      xs.add(o.left - CLEARANCE);
      xs.add(o.right + CLEARANCE);
      ys.add(o.top - CLEARANCE);
      ys.add(o.bottom + CLEARANCE);
    }
    const X = [...xs].sort((a, b) => a - b);
    const Y = [...ys].sort((a, b) => a - b);

    const idx = (i, j) => j * X.length + i;
    const inside = (x, y) => solid.some((o) =>
      x > o.left + EPS && x < o.right - EPS && y > o.top + EPS && y < o.bottom - EPS);

    const usable = new Uint8Array(X.length * Y.length);
    for (let j = 0; j < Y.length; j += 1) {
      for (let i = 0; i < X.length; i += 1) usable[idx(i, j)] = inside(X[i], Y[j]) ? 0 : 1;
    }

    // State is (grid point, axis of travel). The axis has to be part of the state, or a
    // bend cannot be charged for.
    const H = 0;
    const V = 1;
    const cost = new Float64Array(X.length * Y.length * 2).fill(Infinity);
    const prev = new Int32Array(X.length * Y.length * 2).fill(-1);
    const key = (i, j, a) => idx(i, j) * 2 + a;

    const touched = [];
    const relax = (k, c, from) => {
      if (c >= cost[k] - EPS) return;
      if (!Number.isFinite(cost[k])) touched.push(k);
      cost[k] = c;
      prev[k] = from;
    };

    // Seed: one entry per port of the source, already stepped out along its normal. That
    // step is what forces a wire to leave along the edge it is attached to.
    const seeds = new Map();
    for (const p of fromPorts) {
      const sx = p.x + p.dx * CLEARANCE;
      const sy = p.y + p.dy * CLEARANCE;
      const i = X.indexOf(sx);
      const j = Y.indexOf(sy);
      if (i < 0 || j < 0 || !usable[idx(i, j)]) continue;
      if (segmentBlocked(p.x, p.y, sx, sy, obstacles)) continue;
      const k = key(i, j, p.dx !== 0 ? H : V);
      relax(k, CLEARANCE, -1);
      seeds.set(k, p);
    }

    /*
     * Dijkstra over a few hundred states. A linear scan for the cheapest open state costs
     * less here than the bookkeeping a binary heap needs, and this runs on every frame of
     * a drag, so the constant matters more than the asymptotics.
     */
    const done = new Uint8Array(cost.length);
    for (;;) {
      let best = -1;
      for (const k of touched) if (!done[k] && (best < 0 || cost[k] < cost[best])) best = k;
      if (best < 0) break;
      done[best] = 1;

      const at = best >> 1;
      const axis = best & 1;
      const i = at % X.length;
      const j = (at - i) / X.length;

      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= X.length || nj >= Y.length) continue;
        if (!usable[idx(ni, nj)]) continue;
        if (segmentBlocked(X[i], Y[j], X[ni], Y[nj], solid)) continue;
        const na = di !== 0 ? H : V;
        const step = di !== 0 ? Math.abs(X[ni] - X[i]) : Math.abs(Y[nj] - Y[j]);
        relax(key(ni, nj, na), cost[best] + step + (na === axis ? 0 : BEND_COST), best);
      }
    }

    // Goal: any port of the target, arrived at through its own stub along its own normal.
    let goal = -1;
    let goalPort = null;
    let goalCost = Infinity;
    for (const p of toPorts) {
      const sx = p.x + p.dx * CLEARANCE;
      const sy = p.y + p.dy * CLEARANCE;
      const i = X.indexOf(sx);
      const j = Y.indexOf(sy);
      if (i < 0 || j < 0) continue;
      if (segmentBlocked(p.x, p.y, sx, sy, obstacles)) continue;
      const k = key(i, j, p.dx !== 0 ? H : V);
      const c = cost[k] + CLEARANCE;
      if (c < goalCost) { goalCost = c; goal = k; goalPort = p; }
    }

    if (goal < 0 || !Number.isFinite(goalCost)) {
      /*
       * No orthogonal route exists. This is only reachable if a port is buried inside an
       * obstacle - a panel dragged onto the wheel, say. A plain elbow is the wrong
       * picture, but a missing wire is worse: it reads as the connection not existing.
       */
      const s = fromPorts[1];
      const e = toPorts[0];
      return { d: `M ${s.x} ${s.y} V ${e.y} H ${e.x}`, start: s, port: e };
    }

    const points = [];
    for (let k = goal; k >= 0; k = prev[k]) {
      const at = k >> 1;
      const i = at % X.length;
      points.push({ x: X[i], y: Y[(at - i) / X.length] });
      if (seeds.has(k)) { const p = seeds.get(k); points.push({ x: p.x, y: p.y }); break; }
    }
    points.reverse();
    points.push({ x: goalPort.x, y: goalPort.y });

    return { d: toPath(points), start: points[0], port: points[points.length - 1] };
  }

  /**
   * Node to wheel.
   *
   * The wheel's four ports are the top, bottom, left and right of its circle - the small
   * circles already drawn there, which the design calls its origin nodes - so it routes as
   * the square that touches the circle at exactly those four points.
   */
  function route(nodeRect, wheel) {
    const box = {
      left: wheel.cx - wheel.r,
      top: wheel.cy - wheel.r,
      right: wheel.cx + wheel.r,
      bottom: wheel.cy + wheel.r,
      width: wheel.r * 2,
      height: wheel.r * 2,
    };
    return routeOrthogonal(nodeRect, box, []);
  }

  /** Node to preview panel, keeping clear of the wheel. */
  function routeBetween(from, to, obstacle) {
    return routeOrthogonal(from, to, obstacle ? [obstacle] : []);
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
   * How much clear space a preview must leave around the wheel and around the nodes.
   *
   * Generous on purpose. Crowded up against the title, the connector between them
   * collapses to a stub and the two boxes read as stuck together rather than wired. This
   * margin is the room the wire needs to be legible as a connection, which is the whole
   * point of the node metaphor.
   *
   * It is enforced, not preferred: a placement this close to the foreground is rejected
   * outright by the search rather than merely scoring badly.
   */
  const BREATHING_ROOM = 48;
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
    // the per-move synchronous reflow that made the wires lag in the first place. The
    // cache is kept honest by the ResizeObserver in observeSatellite, which re-runs this
    // function whenever the panel's real size turns out to differ.
    const w = sat.w;
    const h = sat.h;
    const hostBox = nodeBox(host);

    /*
     * Placement is a search for the nearest free spot, not a pick from a list.
     *
     * Every earlier version chose from hand-written candidates - beside the host, on the
     * wheel's shoulder, in a screen corner - and a fixed list always has arrangements
     * nobody anticipated. Drag the title somewhere the list did not imagine and the best
     * available spot simply is not in it, so the panel lands somewhere silly. That is the
     * same mistake as choosing a route by its shape, one layer up.
     *
     * So: rings of increasing radius around the host, sampled all the way round, and the
     * first position that is wholly on screen and clear of everything it must not cover
     * wins. Because the rings grow outward, the first fit found IS the nearest fit, for
     * any host position - there is nothing left to anticipate.
     *
     * The old rule that a sector opened on its own side of the wheel is gone. The only
     * requirements now are: near the title, fully on screen, and not covering the title,
     * the welcome panel or the menu.
     */
    const wheel = wheelGeometry();

    // The menu is the one thing a wire must not cross and a preview must not cover. Taken
    // as its bounding square rather than its circle, which errs toward a wider berth - the
    // right way to be wrong here.
    const menuBox = {
      left: wheel.cx - wheel.r,
      top: wheel.cy - wheel.r,
      right: wheel.cx + wheel.r,
      bottom: wheel.cy + wheel.r,
    };

    /*
     * Everything a preview must not cover, each grown by a breathing margin.
     *
     * Bare overlap made "touching" free, so a preview could come to rest flush against the
     * title with no room for the wire between them - reading as stuck to it rather than
     * connected to it. The margin is what the wire's stub and ports live in.
     *
     * The ring field, the particles and the arced wordmark are background; a panel over
     * those is fine and they are deliberately absent from this list.
     */
    const grow = (box, by) => ({
      left: box.left - by,
      top: box.top - by,
      right: box.right + by,
      bottom: box.bottom + by,
    });

    const blocked = [
      grow(menuBox, BREATHING_ROOM),
      ...nodes.map((n) => grow(nodeBox(n), BREATHING_ROOM)),
    ];

    const overlap = (left, top) => {
      let total = 0;
      for (const b of blocked) {
        const x = Math.max(0, Math.min(left + w, b.right) - Math.max(left, b.left));
        const y = Math.max(0, Math.min(top + h, b.bottom) - Math.max(top, b.top));
        total += x * y;
      }
      return total;
    };

    const onScreen = (left, top) =>
      left >= EDGE_MARGIN && top >= EDGE_MARGIN &&
      left + w <= window.innerWidth - EDGE_MARGIN &&
      top + h <= window.innerHeight - EDGE_MARGIN;

    /*
     * Snapping the panel's CENTRE onto a lattice intersection puts all four of its ports
     * on grid lines at once, because a port is now the midpoint of a side. The old code
     * had to resolve a route first to find out which port would be used and snap that one;
     * with fixed ports there is nothing to resolve and no port left unsnapped.
     */
    const grid = window.ShimtiGrid;
    const place = (cx, cy) => (grid
      ? { left: snapCoord(cx, grid.originX, grid.spacing) - w / 2,
          top: snapCoord(cy, grid.originY, grid.spacing) - h / 2 }
      : { left: cx - w / 2, top: cy - h / 2 });

    const hostCx = hostBox.left + hostBox.width / 2;
    const hostCy = hostBox.top + hostBox.height / 2;

    // Sweep outward from the closest the two boxes could ever sit to the far corner of the
    // screen, in half-cell steps, sampling the full circle at each radius.
    const ANGLES = 32;
    const ringStep = grid ? grid.spacing / 2 : 24;
    const first = (Math.min(hostBox.width, hostBox.height) + Math.min(w, h)) / 2;
    const last = Math.hypot(window.innerWidth, window.innerHeight);

    let best = null;      // the first fit found: nearest, by construction
    let fallback = null;  // least-bad, for a viewport with no fit at all

    for (let r = first; r <= last && !best; r += ringStep) {
      for (let a = 0; a < ANGLES; a += 1) {
        const angle = (a / ANGLES) * Math.PI * 2;
        const cand = place(hostCx + Math.cos(angle) * r, hostCy + Math.sin(angle) * r);
        const off = overlap(cand.left, cand.top);
        const fits = onScreen(cand.left, cand.top);

        if (fits && off === 0) {
          // Within one ring every angle is equally near, so the tie goes to whichever sits
          // furthest from the wheel - the panel drifts outward into open space instead of
          // hugging the menu it was just told to keep off.
          const openness = Math.hypot(
            cand.left + w / 2 - wheel.cx,
            cand.top + h / 2 - wheel.cy
          );
          if (!best || openness > best.openness) best = { ...cand, openness };
          continue;
        }

        const penalty = off + (fits ? 0 : 1e9);
        if (!fallback || penalty < fallback.penalty) fallback = { ...cand, penalty };
      }
    }

    const { left, top } = best || fallback || place(hostCx, hostCy);

    sat.el.style.left = `${left}px`;
    sat.el.style.top = `${top}px`;

    const satBox = { left, top, width: w, height: h, right: left + w, bottom: top + h };
    const { d, start, port } = routeBetween(hostBox, satBox, menuBox);
    sat.wire.path.setAttribute('d', d);
    sat.wire.from.setAttribute('cx', start.x);
    sat.wire.from.setAttribute('cy', start.y);
    sat.wire.to.setAttribute('cx', port.x);
    sat.wire.to.setAttribute('cy', port.y);
  }

  /*
   * One observer for every preview, so a panel is repositioned from its true size rather
   * than from whatever it measured as on the frame it was opened.
   *
   * Border box, to match getBoundingClientRect - contentRect excludes padding and border,
   * which would under-measure these panels by the surface's 1rem padding and 2px frame.
   */
  let satelliteObserver = null;

  function observeSatellite(sat) {
    if (!window.ResizeObserver || sat.observed) return;
    if (!satelliteObserver) {
      satelliteObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const s = satellites.find((x) => x.el === entry.target);
          if (!s) continue;
          const box = entry.borderBoxSize && entry.borderBoxSize[0];
          const w = box ? box.inlineSize : entry.target.getBoundingClientRect().width;
          const h = box ? box.blockSize : entry.target.getBoundingClientRect().height;
          if (w === s.w && h === s.h) continue;
          s.w = w;
          s.h = h;
          if (s.active) positionSatellite(s);
        }
      });
    }
    satelliteObserver.observe(sat.el);
    sat.observed = true;
  }

  function updateSatellites() {
    for (const sat of satellites) if (sat.active) positionSatellite(sat);
  }

  /*
   * Re-applies the anchored/bottom-sheet decision to previews that are already open.
   *
   * Which mode a preview uses depends on the viewport width, and that was decided once,
   * when it was opened. Crossing the breakpoint with a preview on screen left it in the
   * mode for a viewport that no longer exists - an inline-positioned panel fighting the
   * stylesheet's bottom sheet on a narrowed window, or a sheet with no wire on a widened
   * one. Re-deciding on every resize means the mode always matches the viewport that is
   * actually there.
   */
  function syncSatelliteMode() {
    const anchored = anchoringEnabled();
    for (const sat of satellites) {
      if (!sat.open) continue;
      if (anchored) {
        window.ShimtiNodes.anchorTo(sat.hostId, sat.el);
      } else if (sat.active) {
        sat.el.style.left = '';
        sat.el.style.top = '';
        sat.wire.path.setAttribute('d', '');
        sat.wire.from.setAttribute('cx', -9999);
        sat.wire.to.setAttribute('cx', -9999);
        sat.active = false;
      }
    }
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
   * Snaps a node so its PORTS land on background-grid intersections.
   *
   * A port is the midpoint of one of the node's four sides, so snapping the node's CENTRE
   * onto an intersection puts the top and bottom ports on a grid column and the left and
   * right ports on a grid row - all four at once, in one step.
   *
   * The previous version had to resolve a route first, to discover which single port the
   * wire would use, and snapped that one. That was only ever correct for the port it
   * guessed: the moment a second wire left the node through a different side, that port
   * was off the lattice. With fixed ports there is nothing to resolve and none left
   * unsnapped.
   *
   * The lattice comes from background.js, which owns it. With no background there is no
   * lattice, and the position passes through untouched rather than being snapped to a
   * guessed spacing.
   *
   * @returns {{left:number, top:number}} the shifted top-left
   */
  function snapPortToGrid(node, left, top) {
    const grid = window.ShimtiGrid;
    if (!grid) return { left, top };

    let snappedLeft = snapCoord(left + node.w / 2, grid.originX, grid.spacing) - node.w / 2;
    let snappedTop = snapCoord(top + node.h / 2, grid.originY, grid.spacing) - node.h / 2;

    /*
     * Nearest intersection first, then step inward by whole cells until the node fits.
     *
     * Clamping alone would defeat the snap: the nearest intersection can sit just off the
     * edge of the screen, and a clamp then drags the node back to the margin - leaving its
     * ports a few pixels off the lattice, which is exactly what this exists to prevent.
     * Moving by whole cells brings it into view without ever leaving the grid.
     *
     * The loops are bounded: a node larger than the viewport would otherwise never
     * satisfy both edges.
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
   * Pushes a node off the wheel, by whole grid cells, along the shortest way out.
   *
   * The foreground never overlaps itself - the same rule the previews already obey.
   *
   * Two things go wrong when a node is parked on the wheel. It hides the one control the
   * page exists for. And because a port is the midpoint of a side, sitting on the wheel
   * buries all four of this node's ports inside the obstacle, so no orthogonal route out
   * of it exists at all and its wire has nowhere left to go but straight through
   * everything - which is exactly what it did.
   *
   * Whole cells, so a node that arrived on the lattice leaves still on it.
   *
   * @returns {{left:number, top:number}}
   */
  function clearOfWheel(node, left, top, maxLeft, maxTop) {
    const wheel = wheelGeometry();
    const menu = {
      left: wheel.cx - wheel.r,
      top: wheel.cy - wheel.r,
      right: wheel.cx + wheel.r,
      bottom: wheel.cy + wheel.r,
    };

    const overlaps = (l, t) =>
      l < menu.right && l + node.w > menu.left && t < menu.bottom && t + node.h > menu.top;

    if (!overlaps(left, top)) return { left, top };

    const grid = window.ShimtiGrid;
    const step = grid ? grid.spacing : 20;

    // The four ways out: past each side of the wheel, moving on one axis only.
    const escapes = [
      { l: menu.left - node.w, t: top },
      { l: menu.right, t: top },
      { l: left, t: menu.top - node.h },
      { l: left, t: menu.bottom },
    ];

    let best = null;
    for (const e of escapes) {
      const dl = e.l - left;
      const dt = e.t - top;
      // Rounded out to a whole number of cells, away from the wheel - never short of it.
      const l = left + Math.sign(dl) * Math.ceil(Math.abs(dl) / step) * step;
      const t = top + Math.sign(dt) * Math.ceil(Math.abs(dt) / step) * step;
      if (l < EDGE_MARGIN || l > maxLeft || t < EDGE_MARGIN || t > maxTop) continue;
      if (overlaps(l, t)) continue;
      const cost = Math.hypot(l - left, t - top);
      if (!best || cost < best.cost) best = { left: l, top: t, cost };
    }

    // On a viewport with no room beside the wheel at all, the node stays where it is: a
    // node the user cannot see or reach would be the worse outcome.
    return best || { left, top };
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
    const clear = clearOfWheel(
      node,
      clamp(left, EDGE_MARGIN, maxLeft),
      clamp(top, EDGE_MARGIN, maxTop),
      maxLeft,
      maxTop
    );
    node.left = clear.left;
    node.top = clear.top;
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

    /*
     * Resize rebuilds every derived position, because on resize nothing is still valid.
     *
     * The wheel re-centres, the panels reflow, the background recomputes the lattice from
     * the new viewport, and a node parked against an edge ends up outside a narrowed
     * window - unreachable and unrecoverable. So the caches are dropped and each node is
     * re-homed or re-placed from scratch, re-snapped to the lattice as it now stands
     * rather than to the one it was snapped to before. drawWires then repositions every
     * open preview off the new geometry.
     *
     * Coalesced onto one animation frame. Dragging a window edge fires resize
     * continuously, and measuring plus writing layout on each event is exactly the
     * synchronous-reflow storm the rest of this module is built to avoid; doing the work
     * once per frame keeps a live drag-resize smooth.
     */
    /** Re-derives every position from the viewport as it is right now. */
    function settle() {
      measureWheel();
      for (const node of nodes) {
        measureNode(node);
        if (node.userMoved) place(node, node.left, node.top, true);
        else applyHome(node);
      }
      syncSatelliteMode();
    }

    let resizeFrame = 0;
    window.addEventListener('resize', () => {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        settle();
      });
    });

    /*
     * Laying out against a viewport with no area, and recovering from it.
     *
     * A page opened into a background tab - ctrl-clicked, restored with the session, one
     * of a folder of bookmarks - can run this before it is ever given a size. Every
     * position here is derived from window.innerWidth/innerHeight, and at zero the
     * available range collapses so far that clamp() pins both panels into the top-left
     * margin, one on top of the other. They then stay there for the life of the page:
     * requestAnimationFrame does not run in a hidden tab, so the resize handler above
     * cannot fix it, and no resize EVENT fires anyway because the window was never
     * resized.
     *
     * So this retries until the viewport has an area, on a timer rather than a frame -
     * timers still run in a background tab, merely throttled - and settles again on
     * becoming visible, which is both a likely size change and the moment throttling
     * stops. The same shape as the background's own recovery, for the same reason.
     */
    let healTimer = 0;
    function healWhenSized() {
      if (window.innerWidth > 0 && window.innerHeight > 0) {
        healTimer = 0;
        settle();
        return;
      }
      healTimer = setTimeout(healWhenSized, 250);
    }

    if (window.innerWidth < 1 || window.innerHeight < 1) healWhenSized();

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (healTimer) { clearTimeout(healTimer); healTimer = 0; }
      settle();
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
      // `open` is whether the user is looking at this preview; `active` is whether it is
      // being positioned by this module. They differ below the anchoring breakpoint,
      // where an open preview is laid out entirely by the stylesheet - and keeping them
      // apart is what lets a resize put an already-open preview into the other mode.
      sat.open = true;

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

      /*
       * Measure now, and keep measuring.
       *
       * A single measurement here is whatever the panel happened to be at this instant,
       * and placement then believes it forever. It was catching the panel at 390x59 -
       * before the preview image and copy had contributed their height - so scoring
       * judged a 59px sliver against the wheel, found it barely overlapped, and parked
       * a 423px panel straight across the menu. On a wide viewport the same wrong height
       * sent it to the far corner instead.
       *
       * The observer makes a stale size structurally impossible: the moment the panel
       * settles at its real height the placement is recomputed with it. Repositioning
       * does not resize the panel, so this cannot feed back on itself.
       */
      const r = el.getBoundingClientRect();
      sat.w = r.width;
      sat.h = r.height;
      sat.active = true;
      observeSatellite(sat);
      positionSatellite(sat);
    },

    /** Detaches `el`, hiding its wire. */
    release(el) {
      const sat = satellites.find((s) => s.el === el);
      if (!sat) return;
      sat.open = false;
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
