/**
 * @module Background
 * @description
 * The far background: a grid with energy pulses running along it, and a black hole at
 * the centre that the grid fades into and the pulses fall into.
 *
 * THE IDEA
 *
 * Pulses are power moving through the machine, so they travel ALONG the grid lines
 * rather than drifting freely across them. Free-floating particles read as dust; a pulse
 * confined to a conductor reads as current. They turn only at intersections, the way a
 * signal takes a junction.
 *
 * Every pulse enters from off screen at one of the four edges. Nothing appears in the
 * middle of the grid and nothing emanates from the hole - a pulse that pops into being
 * mid-run has no source, and one climbing out of the black hole contradicts what the hole
 * is. They leave only by falling into the centre or running off the far side.
 *
 * The grid fades out towards the middle rather than stopping at an edge. An abrupt cut
 * reads as a mask; a falloff reads as something consuming the grid.
 *
 * PERFORMANCE
 *
 * This is the largest continuously animating surface on the page, so:
 *
 *   - The grid, including its central falloff, is rendered once to an offscreen canvas
 *     and blitted each frame. It never changes, so redrawing it per frame would be pure
 *     waste - and the falloff is a radial gradient, which is expensive to rebuild.
 *   - No shadowBlur anywhere. Canvas shadows are among the most expensive operations
 *     available and cost is per draw call; the glow is a translucent halo instead.
 *   - Two draw calls per pulse: one stroke for the trail, one fill for the head.
 *   - The population is deliberately small. Density was reading as clutter, and clutter
 *     is what stopped the grid looking ordered.
 *
 * @requires window.ShimtiUtils.Logger
 * @requires DOM element: canvas#backgroundCanvas
 */

'use strict';

const BACKGROUND_CONFIG = {
    GRID_SPACING: 80,
    GRID_STROKE: 'rgba(100, 150, 255, 0.1)',

    /*
     * The hole. HOLE_RADIUS is roughly the radial menu's own radius, so the grid has
     * already gone by the time it reaches the interface. HOLE_FADE is how far out the
     * falloff reaches - wide enough that there is no visible edge to it.
     */
    HOLE_RADIUS: 190,

    /*
     * Two separate falloffs, because they are doing different jobs.
     *
     * GRID_FADE is wide: the grid has to dissolve into the hole with no detectable edge,
     * so the transition wants to be long and gentle.
     *
     * PULSE_FADE is much shorter. A pulse should run at full strength almost to the rim
     * and then visibly go out as it is drawn in - fading it over 300px would have it
     * dimming from halfway across the screen, which reads as running out of energy rather
     * than being consumed.
     */
    GRID_FADE: 300,
    PULSE_FADE: 130,

    /*
     * Population. Well below the previous 30: pulses read as deliberate signals rather
     * than clutter, and every one is a live path being stepped and drawn each frame.
     */
    MAX_PULSES: 14,
    SPAWN_INTERVAL_MIN: 260,
    SPAWN_INTERVAL_MAX: 1400,

    SPEED_MIN: 26,   // px per second
    SPEED_MAX: 95,
    TURN_CHANCE: 0.28,   // chance of taking a junction rather than running straight

    /*
     * The trail is a light ribbon: long, and fading to nothing behind the head.
     *
     * It is measured in PIXELS travelled, not frames retained. Frames would tie the
     * ribbon's length to the frame rate and to each pulse's speed, so a slow pulse would
     * trail a stub and a fast one a streak. A distance means every pulse lays the same
     * ribbon and only its speed differs.
     *
     * CHUNK is how finely the fade is stepped. The path only has vertices where the pulse
     * turned - usually two or three - so long straight runs are subdivided to give the
     * gradient somewhere to happen. Smaller values look smoother and cost one more stroke
     * each; at this alpha the steps are not perceptible.
     */
    TRAIL_LENGTH: 320,
    TRAIL_CHUNK: 34,

    /*
     * A ceiling on how long one pulse may wander. Turning at random is a random walk, and
     * a random walk on a grid can take a very long time to leave it: in simulation about
     * 2% were still travelling after a minute. The population is capped, so this is not a
     * leak - but such a pulse holds a slot indefinitely and starves the field of new
     * arrivals. Generous enough that a normal crossing is never cut short.
     */
    MAX_LIFETIME: 90,    // seconds

    /*
     * Annihilation. Two pulses meeting cancel out in a small shockwave.
     *
     * COLLIDE_RADIUS is generous relative to the 1.5px head: heads are tested once per
     * frame, and a fast pulse covers a couple of pixels between frames, so a tight radius
     * would let two pass through each other without ever being sampled close enough.
     */
    COLLIDE_RADIUS: 7,
    FLASH_DURATION: 0.55,   // seconds
    FLASH_RADIUS: 26,       // how far the shockwave expands

    /* Deliberately faint. These sit behind the entire interface and read as something
       glimpsed through it, not as foreground detail competing with the menu. */
    TRAIL_ALPHA: 0.3,
    TRAIL_COLOR: 'rgba(180, 220, 255, ',
    /* Only the annihilation spark uses this - a pulse itself is a ribbon and nothing else. */
    HEAD_COLOR: 'rgba(234, 255, 255, ',
    TARGET_FPS: 45
};

const bgLogger = new window.ShimtiUtils.Logger('Background');

/**
 * A single pulse travelling the grid.
 *
 * Position is always exactly on a line: one axis holds a grid coordinate and never
 * changes until the pulse turns, while the other advances. That constraint is the whole
 * effect - it is what makes the movement read as conducted rather than drifting.
 */
class Pulse {
    /**
     * @param {'h'|'v'} axis - 'h' travels along a horizontal line, 'v' along a vertical one
     * @param {number} x
     * @param {number} y
     * @param {number} dir - +1 or -1 along the axis of travel
     * @param {number} speed - pixels per second
     */
    constructor(axis, x, y, dir, speed) {
        this.axis = axis;
        this.x = x;
        this.y = y;
        this.dir = dir;
        this.speed = speed;
        // Vertices where this pulse has turned, oldest first. Between them it travels in
        // a straight line, so this is the complete path in a handful of points.
        this.path = [{ x, y }];
        this.dead = false;
        this.age = 0;
        this.alpha = 1;
    }

    /** Snaps a coordinate to the nearest grid line, given the grid's origin. */
    static snap(value, origin, spacing) {
        return origin + Math.round((value - origin) / spacing) * spacing;
    }

    /**
     * Advances the pulse, turning at any junction it crosses.
     * @param {number} dt - seconds since the previous frame
     * @param {Object} field - grid origin, bounds and hole geometry
     */
    update(dt, field) {
        const { spacing, originX, originY, width, height, cx, cy } = field;
        const step = this.speed * dt;

        const along = this.axis === 'h' ? this.x : this.y;
        const origin = this.axis === 'h' ? originX : originY;
        const next = along + this.dir * step;

        // A junction is crossed when the index of the containing cell changes. Handling
        // one per frame is enough: at these speeds a pulse cannot clear a whole cell in a
        // single frame, and pretending otherwise would let it skip a turn.
        const cellBefore = Math.floor((along - origin) / spacing);
        const cellAfter = Math.floor((next - origin) / spacing);

        if (cellBefore !== cellAfter && Math.random() < BACKGROUND_CONFIG.TURN_CHANCE) {
            // Land exactly on the junction before turning, or the pulse leaves the line
            // it is supposed to be confined to.
            const node = Pulse.snap(next, origin, spacing);
            if (this.axis === 'h') this.x = node; else this.y = node;
            // A vertex is recorded only here, at the corner. That is the only place the
            // path bends, so it is the only place the ribbon needs a point.
            this.path.push({ x: this.x, y: this.y });

            this.axis = this.axis === 'h' ? 'v' : 'h';
            this.dir = Math.random() < 0.5 ? 1 : -1;
        } else if (this.axis === 'h') {
            this.x = next;
        } else {
            this.y = next;
        }

        this.prunePath();

        // Consumed by the hole, or gone off the far side. Those are the only two exits.
        const dist = Math.hypot(this.x - cx, this.y - cy);
        if (dist < BACKGROUND_CONFIG.HOLE_RADIUS) this.dead = true;

        const margin = spacing * 2;
        if (this.x < -margin || this.x > width + margin ||
            this.y < -margin || this.y > height + margin) this.dead = true;

        this.age += dt;
        if (this.age > BACKGROUND_CONFIG.MAX_LIFETIME) this.dead = true;

        // Fades out as the hole takes it, rather than blinking off at the rim. By the
        // time it reaches HOLE_RADIUS it is already at zero, so removal is invisible.
        const reach = BACKGROUND_CONFIG.HOLE_RADIUS + BACKGROUND_CONFIG.PULSE_FADE;
        this.alpha = dist > reach
            ? 1
            : Math.max(0, (dist - BACKGROUND_CONFIG.HOLE_RADIUS) / BACKGROUND_CONFIG.PULSE_FADE);
    }

    /**
     * Discards vertices that have fallen entirely behind the ribbon, so the path stays a
     * handful of points however far the pulse travels.
     */
    prunePath() {
        let distance = 0;
        let keepFrom = 0;
        let px = this.x;
        let py = this.y;
        for (let i = this.path.length - 1; i >= 0; i -= 1) {
            distance += Math.hypot(this.path[i].x - px, this.path[i].y - py);
            px = this.path[i].x;
            py = this.path[i].y;
            if (distance > BACKGROUND_CONFIG.TRAIL_LENGTH) { keepFrom = i; break; }
        }
        if (keepFrom > 0) this.path.splice(0, keepFrom);
    }

    /**
     * The ribbon: the last TRAIL_LENGTH pixels of path, from the head backwards.
     * @returns {Array<{x:number,y:number}>} head first, tail last
     */
    ribbon() {
        const points = [{ x: this.x, y: this.y }];
        let remaining = BACKGROUND_CONFIG.TRAIL_LENGTH;
        for (let i = this.path.length - 1; i >= 0 && remaining > 0; i -= 1) {
            const last = points[points.length - 1];
            const vertex = this.path[i];
            const span = Math.hypot(vertex.x - last.x, vertex.y - last.y);
            if (span <= remaining) {
                points.push(vertex);
                remaining -= span;
            } else {
                // The ribbon ends partway along this segment.
                const t = remaining / span;
                points.push({
                    x: last.x + (vertex.x - last.x) * t,
                    y: last.y + (vertex.y - last.y) * t
                });
                remaining = 0;
            }
        }
        return points;
    }

    /** @param {CanvasRenderingContext2D} ctx */
    draw(ctx) {
        if (this.alpha <= 0) return;

        const { TRAIL_LENGTH, TRAIL_CHUNK, TRAIL_ALPHA, TRAIL_COLOR } = BACKGROUND_CONFIG;
        const points = this.ribbon();

        ctx.lineWidth = 1.3;
        ctx.lineCap = 'round';

        // Walk head to tail in short chunks, each stroked at its own alpha. The falloff is
        // squared rather than linear so the ribbon holds its brightness near the head and
        // then thins out quickly - a linear ramp leaves the whole tail evenly grey.
        let travelled = 0;
        for (let i = 0; i < points.length - 1; i += 1) {
            const a = points[i];
            const b = points[i + 1];
            const span = Math.hypot(b.x - a.x, b.y - a.y);
            if (span < 0.01) continue;

            for (let t0 = 0; t0 < span; t0 += TRAIL_CHUNK) {
                const t1 = Math.min(t0 + TRAIL_CHUNK, span);
                const fade = Math.max(0, 1 - (travelled + (t0 + t1) / 2) / TRAIL_LENGTH);
                const alpha = TRAIL_ALPHA * fade * fade * this.alpha;
                if (alpha < 0.004) continue;

                ctx.strokeStyle = `${TRAIL_COLOR}${alpha.toFixed(3)})`;
                ctx.beginPath();
                ctx.moveTo(a.x + (b.x - a.x) * (t0 / span), a.y + (b.y - a.y) * (t0 / span));
                ctx.lineTo(a.x + (b.x - a.x) * (t1 / span), a.y + (b.y - a.y) * (t1 / span));
                ctx.stroke();
            }
            travelled += span;
        }

        // No dot at the head. The ribbon is the whole thing: a bright leading end fading
        // back to nothing, the way a light trail reads. A dot in front turns it into a
        // particle towing a tail, which is a different and much more ordinary effect.
    }
}

/**
 * The flash left where two pulses annihilate.
 *
 * An expanding ring plus a spark at the centre. Both fade on a squared curve, so the
 * shockwave is brightest the instant it appears and thins as it grows - the opposite
 * reads as something arriving rather than something detonating.
 */
class Flash {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.t = 0;
        this.dead = false;
    }

    update(dt) {
        this.t += dt;
        if (this.t >= BACKGROUND_CONFIG.FLASH_DURATION) this.dead = true;
    }

    /** @param {CanvasRenderingContext2D} ctx */
    draw(ctx) {
        const progress = this.t / BACKGROUND_CONFIG.FLASH_DURATION;
        const fade = (1 - progress) * (1 - progress);
        if (fade <= 0.004) return;

        ctx.beginPath();
        ctx.arc(this.x, this.y, 2 + progress * BACKGROUND_CONFIG.FLASH_RADIUS, 0, Math.PI * 2);
        ctx.strokeStyle = `${BACKGROUND_CONFIG.TRAIL_COLOR}${(fade * 0.55).toFixed(3)})`;
        ctx.lineWidth = 0.4 + fade * 1.4;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(this.x, this.y, 0.6 + fade * 2.2, 0, Math.PI * 2);
        ctx.fillStyle = `${BACKGROUND_CONFIG.HEAD_COLOR}${(fade * 0.85).toFixed(3)})`;
        ctx.fill();
    }
}

/**
 * Creates a pulse entering from off screen, on a grid line, heading inward.
 * @returns {Pulse}
 */
function spawnPulse(field) {
    const { spacing, originX, originY, width, height } = field;
    const speed = BACKGROUND_CONFIG.SPEED_MIN +
        Math.random() * (BACKGROUND_CONFIG.SPEED_MAX - BACKGROUND_CONFIG.SPEED_MIN);
    const margin = spacing;
    const edge = Math.floor(Math.random() * 4);

    // Choose a line, then start beyond the edge on it, moving in. Starting off screen is
    // the point: a pulse must arrive from somewhere, never blink into being mid-grid.
    if (edge === 0 || edge === 1) {
        const lines = Math.floor(height / spacing) + 2;
        const y = originY + Math.floor(Math.random() * lines) * spacing - spacing;
        return edge === 0
            ? new Pulse('h', -margin, y, 1, speed)
            : new Pulse('h', width + margin, y, -1, speed);
    }

    const lines = Math.floor(width / spacing) + 2;
    const x = originX + Math.floor(Math.random() * lines) * spacing - spacing;
    return edge === 2
        ? new Pulse('v', x, -margin, 1, speed)
        : new Pulse('v', x, height + margin, -1, speed);
}

function initBackground() {
    try {
        const canvas = document.getElementById('backgroundCanvas');
        if (!canvas) throw new Error('backgroundCanvas not found');
        const ctx = canvas.getContext('2d', { alpha: true });

        const offscreen = document.createElement('canvas');
        const offCtx = offscreen.getContext('2d');

        let field = null;
        let pulses = [];
        let flashes = [];
        let nextSpawn = 0;
        let lastTime = performance.now();

        const reduceMotion = window.matchMedia
            && window.matchMedia('(prefers-reduced-motion: reduce)');

        /** Rebuilds the grid bitmap. Called on resize only - never per frame. */
        function buildGrid() {
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const width = window.innerWidth;
            const height = window.innerHeight;
            const spacing = BACKGROUND_CONFIG.GRID_SPACING;
            const cx = width / 2;
            const cy = height / 2;

            // Grid lines are laid out from the centre so the hole lands on a junction and
            // the field looks centred rather than arbitrarily cropped.
            const originX = cx - Math.ceil(cx / spacing) * spacing;
            const originY = cy - Math.ceil(cy / spacing) * spacing;

            field = { spacing, originX, originY, width, height, cx, cy };

            for (const c of [canvas, offscreen]) {
                c.width = width * dpr;
                c.height = height * dpr;
            }
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

            offCtx.clearRect(0, 0, width, height);
            offCtx.strokeStyle = BACKGROUND_CONFIG.GRID_STROKE;
            offCtx.lineWidth = 1;
            offCtx.beginPath();
            for (let x = originX; x <= width + spacing; x += spacing) {
                offCtx.moveTo(x, 0);
                offCtx.lineTo(x, height);
            }
            for (let y = originY; y <= height + spacing; y += spacing) {
                offCtx.moveTo(0, y);
                offCtx.lineTo(width, y);
            }
            // One stroke for every line rather than one per line: the path is batched, so
            // the whole grid costs a single call.
            offCtx.stroke();

            /*
             * The hole. destination-out erases with the gradient's alpha, so the grid is
             * removed completely at the centre and returns gradually outward - a falloff
             * rather than a cut. Baked into the bitmap, so it costs nothing per frame.
             */
            const reach = BACKGROUND_CONFIG.HOLE_RADIUS + BACKGROUND_CONFIG.GRID_FADE;
            const hole = offCtx.createRadialGradient(cx, cy, 0, cx, cy, reach);
            hole.addColorStop(0, 'rgba(0, 0, 0, 1)');
            hole.addColorStop(BACKGROUND_CONFIG.HOLE_RADIUS / reach, 'rgba(0, 0, 0, 0.92)');
            hole.addColorStop(1, 'rgba(0, 0, 0, 0)');
            offCtx.globalCompositeOperation = 'destination-out';
            offCtx.fillStyle = hole;
            offCtx.fillRect(0, 0, width, height);
            offCtx.globalCompositeOperation = 'source-over';

            pulses = pulses.filter((p) => !p.dead);

            // Paint it straight away rather than waiting for the first animation frame.
            // requestAnimationFrame does not run in a background tab, so without this the
            // grid is simply absent until the tab is looked at - and on a normal load it
            // removes a frame of empty backdrop.
            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(offscreen, 0, 0, width, height);

            bgLogger.log('Grid rebuilt', { width, height, dpr });
        }

        const frameInterval = 1000 / BACKGROUND_CONFIG.TARGET_FPS;

        function frame(now) {
            requestAnimationFrame(frame);

            const elapsed = now - lastTime;
            if (elapsed < frameInterval) return;
            // Clamp dt so a backgrounded tab does not resume by teleporting every pulse
            // across the screen in one step.
            const dt = Math.min(elapsed, 100) / 1000;
            lastTime = now;

            ctx.clearRect(0, 0, field.width, field.height);
            ctx.drawImage(offscreen, 0, 0, field.width, field.height);

            if (reduceMotion && reduceMotion.matches) {
                // Pulses travel across the screen, which is motion in the sense the
                // setting means. The grid and its hole still render.
                pulses = [];
                flashes = [];
                return;
            }

            if (now >= nextSpawn && pulses.length < BACKGROUND_CONFIG.MAX_PULSES) {
                pulses.push(spawnPulse(field));
                nextSpawn = now + BACKGROUND_CONFIG.SPAWN_INTERVAL_MIN +
                    Math.random() * (BACKGROUND_CONFIG.SPAWN_INTERVAL_MAX - BACKGROUND_CONFIG.SPAWN_INTERVAL_MIN);
            }

            for (const pulse of pulses) pulse.update(dt, field);

            /*
             * Annihilation. Every surviving pair is tested, which is fine at this
             * population - 14 pulses is 91 comparisons, and the cap is what keeps a naive
             * O(n^2) check cheaper than any structure built to avoid it.
             *
             * Both are marked before the flash is placed, so a pulse caught by two
             * neighbours in the same frame cannot spawn two flashes from one death.
             */
            for (let i = 0; i < pulses.length; i += 1) {
                if (pulses[i].dead) continue;
                for (let j = i + 1; j < pulses.length; j += 1) {
                    if (pulses[j].dead) continue;
                    const dx = pulses[i].x - pulses[j].x;
                    const dy = pulses[i].y - pulses[j].y;
                    if (Math.hypot(dx, dy) > BACKGROUND_CONFIG.COLLIDE_RADIUS) continue;
                    pulses[i].dead = true;
                    pulses[j].dead = true;
                    flashes.push(new Flash((pulses[i].x + pulses[j].x) / 2, (pulses[i].y + pulses[j].y) / 2));
                    break;
                }
            }

            for (const pulse of pulses) if (!pulse.dead) pulse.draw(ctx);
            for (const flash of flashes) {
                flash.update(dt);
                flash.draw(ctx);
            }

            if (pulses.some((p) => p.dead)) pulses = pulses.filter((p) => !p.dead);
            if (flashes.some((f) => f.dead)) flashes = flashes.filter((f) => !f.dead);
        }

        let resizeTimer = null;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(buildGrid, 150);
        });

        buildGrid();
        requestAnimationFrame(frame);
        bgLogger.log('Background initialised', { maxPulses: BACKGROUND_CONFIG.MAX_PULSES });
    } catch (error) {
        bgLogger.error('Failed to initialise background', error);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initBackground);
} else {
    initBackground();
}
