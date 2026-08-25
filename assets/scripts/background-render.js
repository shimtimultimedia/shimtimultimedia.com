/*
 * Shimti Multimedia - background field renderer
 *
 * The simulation and every pixel it draws, with no host attached.
 *
 * Nothing in this file touches window, document, matchMedia or the DOM. That is the whole
 * point: the same code runs inside a dedicated worker driving an OffscreenCanvas, and on
 * the main thread when a browser cannot do that. One renderer, two hosts - so the
 * fallback cannot drift away from the real thing, which is what tends to happen when a
 * port leaves the old path behind as a second implementation.
 *
 * What it needs from a host, and will not work out for itself:
 *   - a canvas (an OffscreenCanvas in a worker, a <canvas> element on the main thread)
 *   - a size, via resize(), including the lattice the grid is drawn on
 *   - whether reduced motion is asked for, via setReducedMotion()
 *
 * The lattice is passed IN rather than computed here because the node panels snap to the
 * same lattice, and deriving it twice - once for the pixels, once for the panels - is two
 * derivations of one fact that drift apart the moment either changes.
 *
 * @requires nothing. Deliberately.
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
     * so the transition wants to be long and gentle. A pulse's own fade is handled
     * separately, against the capture radii below.
     */
    GRID_FADE: 300,

    /*
     * The event horizon.
     *
     * Inside CAPTURE_RADIUS a pulse stops being a signal on a conductor and becomes
     * something falling: it leaves the grid, is pulled toward the centre, and accelerates
     * as it goes. That break is the point - a pulse that kept dutifully following grid
     * lines until it happened to cross the rim would not read as being captured by
     * anything.
     *
     * DEATH_RADIUS is where it is gone. It fades to nothing on the way in, so it is
     * already invisible before it is removed.
     */
    CAPTURE_RADIUS: 275,
    DEATH_RADIUS: 26,

    /*
     * Gravity, applied to the pulse's actual velocity.
     *
     * The first version set the direction straight at the centre on capture. That is what
     * produced the reversals: a pulse crossing the zone tangentially can already be moving
     * AWAY from the centre when it is caught, and pointing it inward flips its velocity in
     * a single frame - a dot travelling one way and then instantly the other, which is
     * exactly what a vehicle cannot do.
     *
     * Accelerating an existing velocity cannot do that. The pulse keeps the momentum it
     * arrived with and is bent by the pull, so it curves, swings around, and spirals in.
     * A reversal can only ever happen gradually, through a turn, the way it should.
     *
     * PULL is the acceleration at the horizon and rises with the inverse square of
     * distance. DAMPING bleeds off enough energy that a pulse cannot slingshot back out
     * and orbit forever.
     */
    CAPTURE_PULL: 1100,      // px per second squared, at CAPTURE_RADIUS
    /*
     * Ceilings, and they are not optional.
     *
     * An inverse square reaches roughly 123,000px/s^2 at the rim. One frame of that adds
     * about 2,000px/s, which does not bend a 200px/s velocity - it inverts it, and the dot
     * appears to reverse in place. Capping the acceleration keeps the change per frame
     * small enough that the path can only ever curve.
     */
    CAPTURE_MAX_PULL: 3800,  // px per second squared
    MAX_FALL_SPEED: 620,     // px per second
    CAPTURE_DAMPING: 0.55,   // fraction of speed shed per second while falling

    /*
     * Population. Well below the previous 30: pulses read as deliberate signals rather
     * than clutter, and every one is a live path being stepped and drawn each frame.
     */
    MAX_PULSES: 14,
    SPAWN_INTERVAL_MIN: 260,
    SPAWN_INTERVAL_MAX: 1400,

    /*
     * Speed. The range is wide and the draw is biased toward the slow end, so most pulses
     * drift and the occasional one tears across the screen. A flat distribution over this
     * range would make almost everything mid-speed, and the fast ones only register as
     * fast when there is something slow to measure them against.
     *
     * The top speed is still far below one grid cell per frame, which the junction
     * detection depends on: at 240px/s and 45fps a step is about 5px against an 80px
     * cell, so a pulse cannot skip a junction and miss a turn.
     */
    SPEED_MIN: 26,   // px per second
    SPEED_MAX: 260,
    /*
     * Speed is drawn in bands, not from one curve across the whole range.
     *
     * A single biased draw is random but it is not varied: raising a uniform number to a
     * power piles most results into the bottom of the range, so the majority of pulses end
     * up within a few px/s of each other and the field reads as one speed. Choosing a band
     * first and then a speed inside it keeps every draw random - two spawns in a row can
     * still land in the same band - while guaranteeing the population on screen is spread
     * across the full range rather than clustered at one end.
     */
    SPEED_BANDS: 5,
    TURN_CHANCE: 0.28,   // chance of taking a junction rather than running straight

    /*
     * The trail is a light ribbon: long, and fading to nothing behind the head.
     *
     * It is measured in PIXELS travelled, not frames retained. Frames would tie the
     * ribbon's length to the frame rate and to each pulse's speed, so a slow pulse would
     * trail a stub and a fast one a streak. A distance means every pulse lays the same
     * ribbon and only its speed differs.
     *
     * Each pulse draws its own length from a range rather than all sharing one. Identical
     * ribbons make the field look stamped out; varied ones read as pulses of differing
     * strength moving through the same circuit.
     *
     * CHUNK is how finely the fade is stepped. The path only has vertices where the pulse
     * turned - usually two or three - so long straight runs are subdivided to give the
     * gradient somewhere to happen. Smaller values look smoother and cost one more stroke
     * each; at this alpha the steps are not perceptible.
     */
    TRAIL_LENGTH_MIN: 150,
    TRAIL_LENGTH_MAX: 420,
    TRAIL_CHUNK: 34,

    /*
     * How long a pulse may wander before it burns out.
     *
     * A slow pulse turning at random can stay on screen a very long time without ever
     * reaching an edge or the hole - in simulation about 2% were still going after a
     * minute. The population is capped so this is not a leak, but such a pulse holds a
     * slot indefinitely and starves the field of new arrivals.
     *
     * It fades over LIFETIME_FADE rather than vanishing at the limit: a pulse blinking
     * out mid-grid is exactly the thing this whole design avoids at the other end, where
     * pulses are forbidden from popping into existence. Spent energy dims away.
     */
    MAX_LIFETIME: 90,      // seconds
    LIFETIME_FADE: 8,      // seconds of fade before it goes

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
    /* The pulse itself: one dot at the head of the ribbon, identical on every pulse
       because it stands for one quantity of energy. Also the annihilation spark. */
    HEAD_RADIUS: 2.6,
    HEAD_ALPHA: 0.75,
    HEAD_COLOR: 'rgba(234, 255, 255, ',
    TARGET_FPS: 45
};

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

        /*
         * There is no fixed heading. Turning is free, and that is deliberate.
         *
         * The rule a pulse obeys is the one a light cycle obeys: it can turn ninety
         * degrees at a junction, either way, but it can never reverse along the line it
         * is currently on. A motorcycle does not suddenly drive backwards; it turns.
         *
         * That rule is enforced by construction - a turn always changes axis, and
         * direction is only ever assigned at a turn - so an in-place reversal is not
         * expressible. Everything else stays random, which is what allows a pulse to take
         * three turns the same way and trace a square around one cell of the grid.
         *
         * An earlier version pinned a direction to each axis for life. That did stop
         * reversals, but it also made squares impossible and turned every path into a
         * staircase heading for one corner of the screen.
         */

        this.captured = false;
        // Velocity, only used once the hole has it. Until then movement is along the grid.
        this.vx = 0;
        this.vy = 0;

        // This pulse's own ribbon length, fixed for its lifetime.
        this.trailLength = BACKGROUND_CONFIG.TRAIL_LENGTH_MIN +
            Math.random() * (BACKGROUND_CONFIG.TRAIL_LENGTH_MAX - BACKGROUND_CONFIG.TRAIL_LENGTH_MIN);
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
    /**
     * Advances one frame: along the grid, or falling if the hole has it.
     * @param {number} dt - seconds since the previous frame
     * @param {Object} field - grid origin, bounds and hole geometry
     */
    update(dt, field) {
        const { cx, cy } = field;
        let dist = Math.hypot(this.x - cx, this.y - cy);

        /*
         * Only pulses actually heading inward are taken.
         *
         * A pulse crossing the zone tangentially can already be moving AWAY from the
         * centre. Capturing that one means hauling it back, and being hauled back is
         * precisely what looks like a reversal - so it is left on the grid to carry on
         * out the other side.
         */
        if (!this.captured && dist < BACKGROUND_CONFIG.CAPTURE_RADIUS) {
            const vx = this.axis === 'h' ? this.dir : 0;
            const vy = this.axis === 'v' ? this.dir : 0;
            if (vx * (cx - this.x) + vy * (cy - this.y) > 0) {
                this.captured = true;
                // Carry the momentum it arrived with into the fall. Starting from rest,
                // or from a velocity pointed at the centre, would make the dot jump.
                this.vx = this.axis === 'h' ? this.dir * this.speed : 0;
                this.vy = this.axis === 'v' ? this.dir * this.speed : 0;
                // Record the corner where it leaves the grid, so the ribbon shows the
                // moment it stopped following the line and started falling.
                this.path.push({ x: this.x, y: this.y });
            }
        }

        if (this.captured) this.fall(dt, cx, cy, dist);
        else this.travelGrid(dt, field);

        this.prunePath();

        dist = Math.hypot(this.x - cx, this.y - cy);

        if (dist < BACKGROUND_CONFIG.DEATH_RADIUS) this.dead = true;

        const margin = field.spacing * 2;
        if (this.x < -margin || this.x > field.width + margin ||
            this.y < -margin || this.y > field.height + margin) this.dead = true;

        this.age += dt;
        if (this.age > BACKGROUND_CONFIG.MAX_LIFETIME) this.dead = true;

        // Dimming as the hole draws it in. Full strength right up to the rim, then out
        // over the fall, so it is already invisible by the time it is removed.
        const holeFade = dist > BACKGROUND_CONFIG.HOLE_RADIUS
            ? 1
            : Math.max(0, (dist - BACKGROUND_CONFIG.DEATH_RADIUS) /
                (BACKGROUND_CONFIG.HOLE_RADIUS - BACKGROUND_CONFIG.DEATH_RADIUS));

        // Burning out: a pulse that never finds an edge or the hole dims away instead of
        // being cut off at the limit.
        const remaining = BACKGROUND_CONFIG.MAX_LIFETIME - this.age;
        const ageFade = remaining >= BACKGROUND_CONFIG.LIFETIME_FADE
            ? 1
            : Math.max(0, remaining / BACKGROUND_CONFIG.LIFETIME_FADE);

        this.alpha = Math.min(holeFade, ageFade);
    }

    /**
     * Normal travel: along the current grid line, turning only at junctions.
     * @param {number} dt
     * @param {Object} field
     */
    travelGrid(dt, field) {
        const { spacing, originX, originY } = field;
        const step = this.speed * dt;

        const along = this.axis === 'h' ? this.x : this.y;
        const origin = this.axis === 'h' ? originX : originY;

        /*
         * Distance to the next junction STRICTLY AHEAD.
         *
         * The obvious test - has the index of the containing cell changed - is wrong for
         * a pulse standing exactly on a junction, which is where every turn leaves it.
         * Math.floor puts that pulse on the boundary, so the instant it moves backwards
         * along the new axis the index changes and it is offered a second turn at the
         * junction it is already standing on. Taking that turn sends it back down the
         * line it just arrived on: the reversal. Measuring forward instead means a pulse
         * on a junction has a full cell to cover before the next one, so a junction can
         * never be used twice.
         */
        const rel = (along - origin) / spacing;
        const cellsAhead = this.dir > 0
            ? Math.floor(rel) + 1 - rel
            : rel - (Math.ceil(rel) - 1);
        const toJunction = cellsAhead * spacing;

        if (step < toJunction) {
            if (this.axis === 'h') this.x += this.dir * step; else this.y += this.dir * step;
            return;
        }

        // The junction is reached this frame. Land on it exactly - a pulse that overshoots
        // is no longer on the line it is meant to be confined to.
        const node = along + this.dir * toJunction;
        if (this.axis === 'h') this.x = node; else this.y = node;

        if (Math.random() >= BACKGROUND_CONFIG.TURN_CHANCE) {
            // Straight through. The rest of the step is still owed.
            const rest = step - toJunction;
            if (this.axis === 'h') this.x += this.dir * rest; else this.y += this.dir * rest;
            return;
        }

        // A vertex is recorded only here, at the corner. That is the only place the path
        // bends while it is on the grid.
        this.path.push({ x: this.x, y: this.y });

        // Ninety degrees, either way, chosen freely. The axis always changes, so the new
        // heading is always perpendicular to the old one and the pulse can never double
        // back along the line it was just on.
        this.axis = this.axis === 'h' ? 'v' : 'h';
        this.dir = Math.random() < 0.5 ? 1 : -1;

        // The remainder of the step is spent on the new axis rather than discarded, so
        // the pulse holds its speed through the corner instead of stalling for a frame.
        const rest = step - toJunction;
        if (this.axis === 'h') this.x += this.dir * rest; else this.y += this.dir * rest;
    }

    /**
     * Falling into the hole: off the grid, under gravity, keeping its momentum.
     * @param {number} dt
     * @param {number} cx
     * @param {number} cy
     * @param {number} dist - current distance from the centre
     */
    fall(dt, cx, cy, dist) {
        if (dist < 0.001) { this.dead = true; return; }

        // Inverse square, so the pull is mild at the horizon and severe at the rim.
        // Clamped at DEATH_RADIUS: without a floor the acceleration runs away as distance
        // approaches zero and the pulse is flung across the screen in one frame.
        const reference = Math.max(dist, BACKGROUND_CONFIG.DEATH_RADIUS);
        const pull = Math.min(
            BACKGROUND_CONFIG.CAPTURE_PULL * Math.pow(BACKGROUND_CONFIG.CAPTURE_RADIUS / reference, 2),
            BACKGROUND_CONFIG.CAPTURE_MAX_PULL
        );

        this.vx += ((cx - this.x) / dist) * pull * dt;
        this.vy += ((cy - this.y) / dist) * pull * dt;

        // Sheds energy, so a pulse that swings past cannot orbit indefinitely.
        const damping = Math.max(0, 1 - BACKGROUND_CONFIG.CAPTURE_DAMPING * dt);
        this.vx *= damping;
        this.vy *= damping;

        // Terminal velocity, so a deep pass cannot cover half the screen in one frame.
        const speed = Math.hypot(this.vx, this.vy);
        if (speed > BACKGROUND_CONFIG.MAX_FALL_SPEED) {
            const scale = BACKGROUND_CONFIG.MAX_FALL_SPEED / speed;
            this.vx *= scale;
            this.vy *= scale;
        }

        this.x += this.vx * dt;
        this.y += this.vy * dt;

        // The fall is a curve, so the ribbon needs points along it - unlike grid travel,
        // where a straight run between junctions needs none. prunePath keeps this bounded.
        this.path.push({ x: this.x, y: this.y });
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
            if (distance > this.trailLength) { keepFrom = i; break; }
        }
        if (keepFrom > 0) this.path.splice(0, keepFrom);
    }

    /**
     * The ribbon: the last `trailLength` pixels of path, from the head backwards.
     * @returns {Array<{x:number,y:number}>} head first, tail last
     */
    ribbon() {
        const points = [{ x: this.x, y: this.y }];
        let remaining = this.trailLength;
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

        const { TRAIL_CHUNK, TRAIL_ALPHA, TRAIL_COLOR } = BACKGROUND_CONFIG;
        const trailLength = this.trailLength;
        const points = this.ribbon();

        ctx.lineWidth = 1.3;
        /*
         * Butt caps, not round.
         *
         * The ribbon is stroked in short chunks so each can carry its own alpha. A round
         * cap adds a half-disc at both ends of EVERY chunk, so each boundary picks up a
         * rounded blob and the tail reads as a string of little dots rather than one
         * continuous line. Butt caps let consecutive chunks abut exactly.
         */
        ctx.lineCap = 'butt';

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
                const fade = Math.max(0, 1 - (travelled + (t0 + t1) / 2) / trailLength);
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

        /*
         * The pulse itself: exactly one dot, at the head, emitting the ribbon behind it.
         *
         * The same size on every pulse - it represents one quantity of energy, so it
         * should not vary. Only its opacity changes, and only as the hole takes it.
         *
         * No shadowBlur: canvas shadows are charged per draw call and this is the most
         * frequently drawn thing on the page.
         */
        ctx.beginPath();
        ctx.arc(this.x, this.y, BACKGROUND_CONFIG.HEAD_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = `${BACKGROUND_CONFIG.HEAD_COLOR}${(BACKGROUND_CONFIG.HEAD_ALPHA * this.alpha).toFixed(3)})`;
        ctx.fill();
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

/*
 * Entry-point selection.
 *
 * Picking an edge with Math.random() four ways gives runs: the same edge comes up three
 * or four times over, and a handful of pulses arrive from the same corner of the screen
 * looking like a stream from one source. Uniform randomness clusters - that is what
 * uniform randomness does - and with this few spawns per minute a run of three is very
 * visible.
 *
 * So the edges are drawn from a bag: all four are used, in random order, before any is
 * used again. Runs become impossible while the order stays unpredictable.
 *
 * The line within the edge is then checked against the last several entry points, so the
 * same line is not reused while it is still fresh. There are dozens of lines per edge;
 * there is no reason for two consecutive pulses to share one.
 */
const edgeBag = [];
const recentSpawns = [];
const RECENT_SPAWN_MEMORY = 10;
const SPAWN_RETRIES = 6;

/** Draws the next edge, refilling and reshuffling the bag when it empties. */
function takeEdge() {
    if (edgeBag.length === 0) {
        edgeBag.push(0, 1, 2, 3);
        for (let i = edgeBag.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [edgeBag[i], edgeBag[j]] = [edgeBag[j], edgeBag[i]];
        }
    }
    return edgeBag.pop();
}

/** Picks a line index on an edge, avoiding any used recently. */
function takeLine(edge, lineCount) {
    let index = Math.floor(Math.random() * lineCount);
    for (let attempt = 0; attempt < SPAWN_RETRIES; attempt += 1) {
        if (!recentSpawns.includes(`${edge}:${index}`)) break;
        index = Math.floor(Math.random() * lineCount);
    }
    recentSpawns.push(`${edge}:${index}`);
    if (recentSpawns.length > RECENT_SPAWN_MEMORY) recentSpawns.shift();
    return index;
}

/**
 * Creates a pulse entering from off screen, on a grid line, heading inward.
 * @returns {Pulse}
 */
function spawnPulse(field) {
    const { spacing, originX, originY, width, height } = field;
    const bands = BACKGROUND_CONFIG.SPEED_BANDS;
    const band = Math.floor(Math.random() * bands);
    const span = (BACKGROUND_CONFIG.SPEED_MAX - BACKGROUND_CONFIG.SPEED_MIN) / bands;
    const speed = BACKGROUND_CONFIG.SPEED_MIN + (band + Math.random()) * span;
    const margin = spacing;
    const edge = takeEdge();

    // Starting beyond the edge is the point: a pulse must arrive from somewhere, never
    // blink into being mid-grid.
    if (edge === 0 || edge === 1) {
        const lines = Math.floor(height / spacing) + 2;
        const y = originY + takeLine(edge, lines) * spacing - spacing;
        return edge === 0
            ? new Pulse('h', -margin, y, 1, speed)
            : new Pulse('h', width + margin, y, -1, speed);
    }

    const lines = Math.floor(width / spacing) + 2;
    const x = originX + takeLine(edge, lines) * spacing - spacing;
    return edge === 2
        ? new Pulse('v', x, -margin, 1, speed)
        : new Pulse('v', x, height + margin, -1, speed);
}


/**
 * Builds a background field bound to one canvas.
 *
 * @param {HTMLCanvasElement|OffscreenCanvas} canvas
 * @returns {{resize:Function, setReducedMotion:Function, start:Function, stop:Function}}
 */
function createBackgroundField(canvas) {
    const ctx = canvas.getContext('2d', { alpha: true });

    /*
     * The grid is drawn once into a buffer and blitted each frame, so the hundreds of
     * line segments and the hole gradient cost one drawImage per frame instead of being
     * rebuilt continuously.
     *
     * OffscreenCanvas where it exists - which is always, inside a worker - and a detached
     * element on the main-thread fallback, where there may be no OffscreenCanvas at all.
     */
    const buffer = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(1, 1)
        : document.createElement('canvas');
    const bufCtx = buffer.getContext('2d');

    let field = null;
    let pulses = [];
    let flashes = [];
    let nextSpawn = 0;
    let lastTime = performance.now();
    let reduceMotion = false;
    let running = false;
    let rafId = 0;

    /**
     * Resizes and redraws the grid bitmap. Called on resize only - never per frame.
     * @param {{width:number, height:number, dpr:number, spacing:number,
     *          originX:number, originY:number}} sizing
     */
    function resize(sizing) {
        const { width, height, dpr, spacing, originX, originY } = sizing;
        if (width < 1 || height < 1) return;

        const cx = width / 2;
        const cy = height / 2;
        field = { spacing, originX, originY, width, height, cx, cy };

        /*
         * Backing-store size only. The element's CSS size belongs to the host: in
         * worker mode this canvas is an OffscreenCanvas, which has no style at all,
         * and the element it came from can no longer be sized from here anyway.
         */
        for (const c of [canvas, buffer]) {
            c.width = width * dpr;
            c.height = height * dpr;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        bufCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

        bufCtx.clearRect(0, 0, width, height);
        bufCtx.strokeStyle = BACKGROUND_CONFIG.GRID_STROKE;
        bufCtx.lineWidth = 1;
        bufCtx.beginPath();
        for (let x = originX; x <= width + spacing; x += spacing) {
            bufCtx.moveTo(x, 0);
            bufCtx.lineTo(x, height);
        }
        for (let y = originY; y <= height + spacing; y += spacing) {
            bufCtx.moveTo(0, y);
            bufCtx.lineTo(width, y);
        }
        // One stroke for every line rather than one per line: the path is batched, so
        // the whole grid costs a single call.
        bufCtx.stroke();

        /*
         * The hole. destination-out erases with the gradient's alpha, so the grid is
         * removed completely at the centre and returns gradually outward - a falloff
         * rather than a cut. Baked into the bitmap, so it costs nothing per frame.
         */
        const reach = BACKGROUND_CONFIG.HOLE_RADIUS + BACKGROUND_CONFIG.GRID_FADE;
        const hole = bufCtx.createRadialGradient(cx, cy, 0, cx, cy, reach);
        hole.addColorStop(0, 'rgba(0, 0, 0, 1)');
        hole.addColorStop(BACKGROUND_CONFIG.HOLE_RADIUS / reach, 'rgba(0, 0, 0, 0.92)');
        hole.addColorStop(1, 'rgba(0, 0, 0, 0)');
        bufCtx.globalCompositeOperation = 'destination-out';
        bufCtx.fillStyle = hole;
        bufCtx.fillRect(0, 0, width, height);
        bufCtx.globalCompositeOperation = 'source-over';

        pulses = pulses.filter((p) => !p.dead);

        // Paint it straight away rather than waiting for the first animation frame.
        // requestAnimationFrame does not run in a background tab, so without this the
        // grid is simply absent until the tab is looked at - and on a normal load it
        // removes a frame of empty backdrop.
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(buffer, 0, 0, width, height);
    }

    const frameInterval = 1000 / BACKGROUND_CONFIG.TARGET_FPS;

    function frame(now) {
        if (!running) return;
        rafId = requestAnimationFrame(frame);

        // Nothing to draw until the host has sent a size. The loop keeps turning so
        // that the first resize is picked up without needing to be restarted.
        if (!field) return;

        const elapsed = now - lastTime;
        if (elapsed < frameInterval) return;
        // Clamp dt so a backgrounded tab does not resume by teleporting every pulse
        // across the screen in one step.
        const dt = Math.min(elapsed, 100) / 1000;
        lastTime = now;

        ctx.clearRect(0, 0, field.width, field.height);
        ctx.drawImage(offscreen, 0, 0, field.width, field.height);

        if (reduceMotion) {
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

    return {
        resize,
        setReducedMotion(value) { reduceMotion = !!value; },
        start() {
            if (running) return;
            running = true;
            lastTime = performance.now();
            rafId = requestAnimationFrame(frame);
        },
        stop() {
            running = false;
            if (rafId) cancelAnimationFrame(rafId);
            rafId = 0;
        },
    };
}
