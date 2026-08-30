/*
 * Shimti Multimedia - the two canvas instruments on Work
 *
 *   [data-bench="walk"]      a stick-figure walk cycle: play, pause, step, scrub
 *   [data-bench="platformer"] a one-level side-scroller, played in the stage
 *
 * Kept out of workbench.js because these two run a frame loop and the others do not.
 * Everything in here obeys three rules that the rest of the site learned the hard way:
 *
 * 1. A frame loop that throws must stop, not keep going. A renamed variable in the
 *    background renderer once threw forty-five times a second for hours because the loop
 *    re-armed itself before the error surfaced, and the machine got hot enough for the
 *    fan to be noticed overnight. Every loop here dies on its first exception and says so.
 *
 * 2. Nothing animates that nobody is looking at. Both instruments stop when scrolled out
 *    of view and when the tab is hidden - a background tab still runs timers, and a game
 *    loop left running in one is pure theft of somebody's battery.
 *
 * 3. Motion is opt-in. Neither starts by itself under prefers-reduced-motion; the walk
 *    cycle can still be stepped by hand, which is arguably the better way to read it.
 */

'use strict';

(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------------------------------------------------------------- shared helpers */

  /**
   * A frame loop that is only alive while the element is on screen and the tab is
   * visible, and that stops permanently the first time the drawing throws.
   */
  function makeLoop(element, draw) {
    let raf = 0;
    let onScreen = false;
    let wanted = false;
    let dead = false;
    let last = 0;

    const running = () => wanted && onScreen && !document.hidden && !dead;

    const frame = (now) => {
      raf = 0;
      if (!running()) return;
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
      last = now;
      try {
        draw(dt);
      } catch (error) {
        // Stop for good rather than throwing once per frame forever.
        dead = true;
        console.error('[bench] frame loop stopped', error);
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    const sync = () => {
      if (running()) {
        if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
      } else if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    new IntersectionObserver((entries) => {
      onScreen = entries[0].isIntersecting;
      sync();
    }, { threshold: 0.15 }).observe(element);

    document.addEventListener('visibilitychange', sync);

    return {
      start() { wanted = true; sync(); },
      stop() { wanted = false; sync(); },
      get playing() { return wanted && !dead; },
    };
  }

  /** Sizes a canvas to its box in device pixels, so lines are crisp on any display. */
  function fit(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: rect.width, h: rect.height };
  }

  /**
   * Two-bone inverse kinematics: given a hip and a foot, find the knee.
   * The walk is authored by moving the feet along a path and letting the joints follow,
   * which is far less fiddly than animating six angles by hand and looks better.
   */
  function joint(ax, ay, bx, by, l1, l2, sign) {
    const dx = bx - ax;
    const dy = by - ay;
    const d = Math.min(Math.hypot(dx, dy), l1 + l2 - 0.0001) || 0.0001;
    const cos = Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
    const a = Math.acos(cos) * sign;
    const base = Math.atan2(dy, dx) + a;
    return [ax + Math.cos(base) * l1, ay + Math.sin(base) * l1];
  }

  /* ------------------------------------------------------------------- walk cycle */

  const WALK_FRAMES = 24;

  /*
   * Poses are built by rotating joints, not by solving for them.
   *
   * The first version put the feet on a path and used inverse kinematics to find the
   * knees. That is how you retarget motion onto a rig; it is not how a cycle is drawn,
   * and it failed in three visible ways: the stride came out at a fraction of the leg
   * length so the figure shuffled, the hand target hung closer to the shoulder than the
   * arm was long so the elbow folded into a zigzag, and the whole thing had no way to
   * express a bent knee during swing.
   *
   * Forward kinematics is what an animator actually does: thigh swings from the hip,
   * shin bends from the knee, upper arm swings from the shoulder, forearm bends from the
   * elbow. Every one of those is one number per frame, and every gait is the same four
   * curves with different amplitudes.
   *
   * Angles are measured from straight down, positive forward, which keeps the maths
   * readable in a coordinate system where y grows downward.
   */
  const GAITS = {
    // Idle is not "nothing happening" - a figure that holds perfectly still reads as a
    // paused video. It shifts weight, breathes, and keeps one knee softer than the other.
    idle: {
      label: 'Idle', fps: 12, cadence: 1,
      // Standing, not stepping. thigh and knee are zero so neither leg swings and neither
      // knee lifts - the whole cycle is a slow breath, a little weight shift, and one knee
      // held softer than the other. Any stride at all here reads as the first frames of
      // walking, which is what it looked like before.
      thigh: 0, knee: 0, kneeBias: 0.05, arm: 0, elbow: 0.10,
      lean: 0.01, bob: 0, sway: 3.5, hipWidth: 10, riseAt: 0, stanceBend: 0.06,
      breathe: 0.07, foot: 0, absorb: 0,
    },
    walk: {
      label: 'Walk', fps: 12, cadence: 1,
      thigh: 0.52, knee: 1.05, kneeBias: 0.06, arm: 0.40, elbow: 0.45,
      lean: 0.05, bob: 4, sway: 0, hipWidth: 7, riseAt: 0, absorb: 0.20, foot: 0.5,
    },
    run: {
      label: 'Run', fps: 16, cadence: 1,
      thigh: 0.82, knee: 1.45, kneeBias: 0.16, arm: 0.85, elbow: 1.05,
      lean: 0.30, bob: 9, sway: 0, hipWidth: 5, riseAt: 0.30, absorb: 0.26, foot: 0.7,
    },
  };

  function setUpWalk(bench) {
    const canvas = bench.querySelector('canvas');
    const playButton = bench.querySelector('[data-walk-play]');
    const prevButton = bench.querySelector('[data-walk-prev]');
    const nextButton = bench.querySelector('[data-walk-next]');
    const scrub = bench.querySelector('[data-walk-scrub]');
    const readout = bench.querySelector('[data-walk-frame]');
    const gaitButtons = [...bench.querySelectorAll('[data-gait]')];
    if (!canvas || !playButton || !scrub) return;

    let frame = 0;
    let gait = GAITS.walk;

    function render() {
      const { ctx, w, h } = fit(canvas);
      const g = gait;
      const p = (frame / WALK_FRAMES) * Math.PI * 2 * g.cadence;

      ctx.clearRect(0, 0, w, h);

      const scale = Math.min(w / 190, h / 150);
      const thighLen = 26 * scale;
      const shinLen = 26 * scale;
      const upperArm = 19 * scale;
      const foreArm = 17 * scale;
      const footLen = 9 * scale;
      const spine = 34 * scale;
      const headR = 9 * scale;
      const groundY = h * 0.9;

      // A point `len` from (x, y) at `a` radians from straight down, positive forward.
      const from = (x, y, len, a) => [x + Math.sin(a) * len, y + Math.cos(a) * len];

      /*
       * Pose first, then plant.
       *
       * Both legs are solved with the pelvis at the origin, and only then is the whole
       * figure dropped so that whichever foot is lowest rests on the ground. Without that
       * step the pelvis has to be positioned by a guess, and any guess is wrong on most
       * frames - which is exactly why the earlier version floated on some and sank on
       * others. Locking to the supporting foot makes contact a consequence of the pose
       * rather than something that has to be tuned to match it.
       */
      const legs = [];
      for (const far of [true, false]) {
        const q = p + (far ? Math.PI : 0);
        const side = far ? -1 : 1;
        const hx = (g.hipWidth * scale * 0.5) * side;
        const thighA = g.thigh * Math.sin(q) + (g.stanceBend || 0) * side;
        // Breathing is a slow flex of both knees. Because the figure is planted by its
        // lowest foot, flexing lifts and lowers the whole body while the feet stay where
        // they are - which is what breathing actually looks like.
        // sin(p), not sin(p * 0.8): at one cycle per loop this returns exactly to its
        // starting value on the last frame, which is what makes the loop close. Any
        // non-integer multiplier leaves the figure mid-breath when it wraps.
        const breath = (g.breathe || 0) * (0.5 + 0.5 * Math.sin(p));

        /*
         * Knee flexion, phased against the four key poses of a walk: contact, down,
         * passing, up.
         *
         * The leg is furthest forward at q = pi/2 and furthest back at q = 3pi/2, so
         * stance runs between those and swing runs the other way round through zero.
         * Maximum flexion belongs in swing, just after toe-off - that is what lets the
         * foot clear the ground on its way forward, and cos(q + 0.7) peaks exactly there.
         *
         * The previous version used sin(q - 0.7), which peaks in the middle of STANCE.
         * That bent the leg while it was pushing the body backwards and straightened it
         * while it reached forward: the figure shortened on the pushing leg and lengthened
         * on the reaching one, which reads as hopping, and reverses the read of which way
         * it is travelling. It was a phase error, not a tuning problem.
         */
        const swingFlex = g.knee * Math.max(0, Math.cos(q + 0.7));

        // The small bend the weight-bearing leg takes just after contact - the 'down'
        // pose, where the hips reach their lowest point.
        const absorb = (g.absorb || 0) * Math.max(0, Math.sin(q - 1.15));

        // Clamped: a knee does not fold past about 140 degrees, and letting the shin swing
        // beyond horizontal was what produced the L-shaped kink at the bottom of the run.
        const bend = Math.min(2.45, g.kneeBias + breath + swingFlex + absorb);
        const knee = from(hx, 0, thighLen, thighA);
        const ankle = from(knee[0], knee[1], shinLen, thighA - bend);

        /*
         * A foot, which the figure badly needed.
         *
         * A leg that ends at the ankle reads as a stick pivoting in space; the foot is what
         * tells you the figure is standing ON something. It rolls with the cycle: toe up
         * as it swings through, flat at contact, and pushing off behind before it leaves
         * the ground. pi/2 is horizontal-forward in these coordinates.
         */
        /*
         * The foot hangs off the shin, not off the world.
         *
         * Drawing it at a fixed horizontal angle meant the ankle joint bent to whatever
         * angle the shin happened to be at - which is why the feet looked snapped. A real
         * ankle sits roughly square to the shin and has perhaps 60 degrees of travel, so
         * the foot is placed perpendicular to the shin, rolled through the cycle, and then
         * clamped to the range an ankle can actually reach.
         */
        const shinAngle = thighA - bend;
        const roll = (g.foot || 0) * Math.sin(q + 1.25);
        const toeAngle = Math.min(Math.PI / 2 + 0.85,
          Math.max(Math.PI / 2 - 0.95, shinAngle + Math.PI / 2 + roll));
        const toe = from(ankle[0], ankle[1], footLen, toeAngle);
        legs.push({ far, side, q, hip: [hx, 0], knee, foot: ankle, toe });
      }

      const lowest = Math.max(...legs.map((l) => Math.max(l.foot[1], l.toe[1])));
      // Running leaves the ground for part of each stride; walking never does.
      const airborne = Math.max(0, Math.sin(p * 2)) * g.riseAt * (thighLen + shinLen);
      // Offset from the breath rather than run at a different rate, so the two stay out
      // of step without either of them breaking the loop.
      const sway = g.sway ? Math.sin(p + 1.1) * g.sway * scale : 0;

      const hipX = w / 2;
      const hipY = groundY - lowest - airborne;

      /*
       * The sway is applied to the shoulders, not the hips.
       *
       * Adding it to hipX moved the pelvis, and because the legs are drawn from the
       * pelvis the feet went with it - the figure slid along the ground rather than
       * standing on it. Shifting weight while standing still shows in the torso; the feet
       * stay exactly where they were put, which is the whole difference between weighting
       * a leg and stepping.
       */
      const shoulderX = hipX + Math.sin(g.lean) * spine + sway;
      const shoulderY = hipY - Math.cos(g.lean) * spine;

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.save();
      ctx.strokeStyle = '#c9d3dc';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(w * 0.06, groundY);
      ctx.lineTo(w * 0.94, groundY);
      ctx.stroke();
      ctx.restore();

      const bone = (a, b, c, far) => {
        ctx.globalAlpha = far ? 0.32 : 1;
        ctx.strokeStyle = '#10151c';
        ctx.lineWidth = Math.max(2, (far ? 1.7 : 2.3) * scale);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.lineTo(c[0], c[1]);
        ctx.stroke();
        ctx.globalAlpha = 1;
      };

      // Far limbs first so the near ones read as in front.
      for (const leg of legs.sort((a, b) => (a.far === b.far ? 0 : a.far ? -1 : 1))) {
        bone(
          [hipX + leg.hip[0], hipY + leg.hip[1]],
          [hipX + leg.knee[0], hipY + leg.knee[1]],
          [hipX + leg.foot[0], hipY + leg.foot[1]],
          leg.far,
        );
        // The foot, drawn as its own short bone off the ankle.
        ctx.globalAlpha = leg.far ? 0.32 : 1;
        ctx.strokeStyle = '#10151c';
        ctx.lineWidth = Math.max(2, (leg.far ? 1.7 : 2.3) * scale);
        ctx.beginPath();
        ctx.moveTo(hipX + leg.foot[0], hipY + leg.foot[1]);
        ctx.lineTo(hipX + leg.toe[0], hipY + leg.toe[1]);
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Arms oppose the leg on the same side. The elbow only flexes on the forward half
        // of the swing - a constant bend is what made the last version look like it was
        // reaching for something.
        const sx = shoulderX + (9 * scale) * leg.side;
        const armA = g.arm * Math.sin(leg.q + Math.PI);
        // The elbow closes as the arm swings forward and opens as it swings back, so the
        // peak sits at the arm's most forward travel rather than a quarter-cycle off it.
        const flex = g.elbow * Math.max(0, -Math.cos(leg.q));
        const elbow = from(sx, shoulderY, upperArm, armA);
        const hand = from(elbow[0], elbow[1], foreArm, armA + flex);
        bone([sx, shoulderY], elbow, hand, leg.far);
      }

      ctx.strokeStyle = '#10151c';
      ctx.lineWidth = Math.max(2, 2.6 * scale);
      ctx.beginPath();
      ctx.moveTo(hipX, hipY);
      ctx.lineTo(shoulderX, shoulderY);
      ctx.stroke();

      // The head continues the spine rather than reflecting it. from() with a negative
      // length mirrors BOTH axes, which pushed the head backwards while the shoulders
      // leaned forwards - at the run's lean that reads as a snapped neck. The spine's own
      // up-vector is (sin lean, -cos lean); the head simply carries on along it.
      const neckLen = headR * 1.7;
      const head = [shoulderX + Math.sin(g.lean) * neckLen,
                    shoulderY - Math.cos(g.lean) * neckLen];
      ctx.lineWidth = Math.max(2, 2.2 * scale);
      ctx.beginPath();
      ctx.arc(head[0], head[1], headR, 0, Math.PI * 2);
      ctx.stroke();
    }

    function show(n) {
      frame = ((n % WALK_FRAMES) + WALK_FRAMES) % WALK_FRAMES;
      scrub.value = String(frame);
      if (readout) readout.textContent = (frame + 1) + ' / ' + WALK_FRAMES;
      render();
    }

    // Advances on the gait's own cadence rather than at display rate: a cycle stepped
    // every frame is far too fast to read, and 12fps is what it would be drawn on anyway.
    let carried = 0;
    const loop = makeLoop(canvas, (dt) => {
      carried += dt;
      const step = 1 / gait.fps;
      while (carried >= step) {
        carried -= step;
        show(frame + 1);
      }
    });

    function reflect() {
      playButton.setAttribute('aria-pressed', loop.playing ? 'true' : 'false');
      playButton.setAttribute('aria-label', loop.playing ? 'Pause' : 'Play');
      playButton.dataset.state = loop.playing ? 'playing' : 'paused';
    }

    playButton.addEventListener('click', () => {
      if (loop.playing) loop.stop(); else loop.start();
      reflect();
    });
    prevButton?.addEventListener('click', () => { loop.stop(); reflect(); show(frame - 1); });
    nextButton?.addEventListener('click', () => { loop.stop(); reflect(); show(frame + 1); });
    scrub.addEventListener('input', () => { loop.stop(); reflect(); show(+scrub.value); });

    gaitButtons.forEach((button) => {
      button.addEventListener('click', () => {
        gait = GAITS[button.dataset.gait] || GAITS.walk;
        gaitButtons.forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
        show(frame);
      });
    });

    scrub.max = String(WALK_FRAMES - 1);
    new ResizeObserver(() => render()).observe(canvas);
    show(0);
    reflect();
    if (!reduceMotion.matches) { loop.start(); reflect(); }
  }

  /* ------------------------------------------------------------------- platformer */

  // One level, looped. Numbers are in world units; the world is 200 units tall.
  const LEVEL = [420, 700, 980, 1120, 1500, 1780, 1940, 2300, 2600, 2760, 3100];
  const LEVEL_LENGTH = 3400;
  const GRAVITY = 1500;
  const JUMP = 520;
  const SPEED = 240;

  function setUpPlatformer(bench) {
    const canvas = bench.querySelector('canvas');
    const playButton = bench.querySelector('[data-game-play]');
    const scoreOut = bench.querySelector('[data-game-score]');
    const bestOut = bench.querySelector('[data-game-best]');
    if (!canvas || !playButton) return;

    const state = { x: 0, y: 0, vy: 0, grounded: true, best: 0, dead: false };

    function reset() {
      state.x = 0;
      state.y = 0;
      state.vy = 0;
      state.grounded = true;
      state.dead = false;
    }

    function jump() {
      if (!loop.playing) { loop.start(); reflect(); return; }
      if (state.grounded) { state.vy = -JUMP; state.grounded = false; }
    }

    function step(dt) {
      state.x += SPEED * dt;
      state.vy += GRAVITY * dt;
      state.y += state.vy * dt;
      if (state.y >= 0) { state.y = 0; state.vy = 0; state.grounded = true; }

      const lap = state.x % LEVEL_LENGTH;
      for (const bx of LEVEL) {
        // The player is 14 wide, the block 18 wide and 26 tall.
        if (lap > bx - 14 && lap < bx + 18 && state.y > -26) {
          state.best = Math.max(state.best, Math.floor(state.x / 10));
          reset();
          break;
        }
      }
      if (scoreOut) scoreOut.textContent = String(Math.floor(state.x / 10));
      if (bestOut) bestOut.textContent = String(state.best);
    }

    function render() {
      const { ctx, w, h } = fit(canvas);
      const scale = h / 200;
      const groundY = 150 * scale;

      ctx.clearRect(0, 0, w, h);

      ctx.strokeStyle = '#c9d3dc';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.lineTo(w, groundY);
      ctx.stroke();

      const lap = state.x % LEVEL_LENGTH;
      ctx.fillStyle = '#10517d';
      for (let repeat = -1; repeat <= 1; repeat++) {
        for (const bx of LEVEL) {
          const sx = (bx - lap + repeat * LEVEL_LENGTH) * scale + w * 0.22;
          if (sx < -40 || sx > w + 40) continue;
          ctx.fillRect(sx, groundY - 26 * scale, 18 * scale, 26 * scale);
        }
      }

      const px = w * 0.22;
      const py = groundY + state.y * scale;
      ctx.fillStyle = '#10151c';
      ctx.fillRect(px - 7 * scale, py - 22 * scale, 14 * scale, 22 * scale);
      ctx.beginPath();
      ctx.arc(px, py - 28 * scale, 7 * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    const loop = makeLoop(canvas, (dt) => { step(dt); render(); });

    function reflect() {
      playButton.setAttribute('aria-pressed', loop.playing ? 'true' : 'false');
      playButton.textContent = loop.playing ? 'Pause' : 'Play';
    }

    playButton.addEventListener('click', () => {
      if (loop.playing) loop.stop(); else loop.start();
      reflect();
      // Pressing Play means you intend to play it, so the keyboard should be live at once
      // rather than only after clicking the stage.
      if (loop.playing) canvas.focus();
    });

    canvas.addEventListener('pointerdown', (event) => {
      // preventDefault stops the page selecting text on a fast double-tap, but it also
      // suppresses the browser's own focus-on-click - which is why Space did nothing until
      // you had tabbed to the canvas. Focus is therefore taken explicitly.
      event.preventDefault();
      canvas.focus();
      jump();
    });

    canvas.addEventListener('keydown', (event) => {
      if (event.key === ' ' || event.key === 'ArrowUp' || event.key === 'w') {
        // Space scrolls the page by default, and the sheet is the scroller here - without
        // this the page jumps every time someone tries to make the figure jump.
        event.preventDefault();
        jump();
      }
    });

    new ResizeObserver(() => render()).observe(canvas);
    reset();
    render();
    reflect();
  }

  /* ------------------------------------------------------------------------ start */

  document.querySelectorAll('[data-bench="walk"]').forEach(setUpWalk);
  document.querySelectorAll('[data-bench="platformer"]').forEach(setUpPlatformer);
})();
