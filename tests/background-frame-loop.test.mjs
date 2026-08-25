/*
 * Drives the real background renderer through its real frame loop.
 *
 * WHY THIS EXISTS
 *
 * The frame loop is the one part of this site that nothing else exercises. A browser
 * preview pane that never runs requestAnimationFrame - which is what the background tab
 * used during development does - will happily report the canvas sized, the grid built and
 * the lattice published, because resize() paints once on its own. Everything looks right.
 * Meanwhile the loop can be throwing on every single frame.
 *
 * That is not hypothetical. A drawImage argument was renamed in one place and not the
 * other, so frame() threw a ReferenceError 45 times a second. requestAnimationFrame is
 * re-armed before the drawing, so it kept rescheduling and kept throwing, each throw
 * allocating an error and a stack and reporting it to the host. Left running overnight it
 * loaded the machine heavily enough to be noticed from across the room. Every check that
 * had been run passed, because none of them ran a frame.
 *
 * So this runs frames - a lot of them - with a stub canvas and a clock we control, and
 * asserts two things a browser check cannot: that no frame throws, and that eight hours of
 * running does not grow the heap.
 *
 * Run with:  node --expose-gc tests/background-frame-loop.test.mjs
 */

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'assets', 'scripts', 'background-render.js');

const FPS = 45;
const STEP = 1000 / FPS;
const HOURS = 8;
const FRAMES = Math.round(HOURS * 3600 * FPS);
const GROWTH_LIMIT_MB = 2;

const noop = () => {};

/* A canvas context that records nothing and refuses nothing. */
const mockCtx = () => new Proxy({}, {
    get(target, key) {
        if (key === 'createRadialGradient' || key === 'createLinearGradient') {
            return () => ({ addColorStop: noop });
        }
        if (key === 'canvas') return { width: 0, height: 0 };
        return target[key] !== undefined ? target[key] : noop;
    },
    set(target, key, value) { target[key] = value; return true; },
});

let clock = 0;
let pending = null;

const sandbox = {
    Math, Date, JSON, console, Proxy, Set, Map, Array, Object, Number, String,
    Float64Array, Uint8Array, Int32Array,
    performance: { now: () => clock },
    requestAnimationFrame: (cb) => { pending = cb; return 1; },
    cancelAnimationFrame: () => { pending = null; },
    // Present only so the renderer's OffscreenCanvas fallback has something to call. Its
    // absence of an OffscreenCanvas global is deliberate: it exercises that branch too.
    document: { createElement: () => ({ getContext: () => mockCtx(), width: 0, height: 0 }) },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8') + '\n;globalThis.__factory = createBackgroundField;', sandbox);

if (typeof sandbox.__factory !== 'function') {
    console.error('FAIL: background-render.js did not define createBackgroundField');
    process.exit(1);
}

const field = sandbox.__factory({ getContext: () => mockCtx(), width: 0, height: 0 });

const W = 1920;
const H = 1080;
const spacing = 80;
field.resize({
    width: W,
    height: H,
    dpr: 2,
    spacing,
    originX: W / 2 - Math.ceil(W / 2 / spacing) * spacing,
    originY: H / 2 - Math.ceil(H / 2 / spacing) * spacing,
});
field.start();

if (!pending) {
    console.error('FAIL: start() did not schedule a frame');
    process.exit(1);
}

const sampleEvery = Math.round(FRAMES / 8);
const heap = () => {
    if (global.gc) global.gc();
    return process.memoryUsage().heapUsed / 1048576;
};

let baseline = null;
let peak = 0;

for (let i = 1; i <= FRAMES; i += 1) {
    clock += STEP;
    if (!pending) {
        console.error(`FAIL: the loop stopped rescheduling at frame ${i}`);
        process.exit(1);
    }
    try {
        pending(clock);
    } catch (error) {
        console.error(`FAIL: frame ${i} threw - ${error.name}: ${error.message}`);
        process.exit(1);
    }

    if (i % sampleEvery === 0) {
        const mb = heap();
        // The first sample is the baseline: earlier ones include warm-up allocation that
        // has nothing to do with whether the loop leaks.
        if (baseline === null) baseline = mb;
        else peak = Math.max(peak, mb - baseline);
    }
}

console.log(`ran ${FRAMES.toLocaleString()} frames (${HOURS}h at ${FPS}fps)`);
console.log(`heap growth after baseline: ${peak.toFixed(2)} MB (limit ${GROWTH_LIMIT_MB} MB)`);

if (peak > GROWTH_LIMIT_MB) {
    console.error('FAIL: the frame loop grows the heap over time');
    process.exit(1);
}

console.log('PASS: no frame threw, and the heap is flat over eight simulated hours');
