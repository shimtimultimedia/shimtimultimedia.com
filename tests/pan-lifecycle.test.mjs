import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = fs.readFileSync(path.join(root, 'assets/scripts/look-around.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'assets/styles/styles.css'), 'utf8');

assert(!/\bscale\s*\(/.test(source), 'gesture transform must never scale the stage');
assert(!/pinchStart|MIN_SCALE|MAX_SCALE/.test(source), 'scripted pinch state must stay removed');
assert(/touch-action:\s*pinch-zoom/.test(styles), 'browser pinch zoom must remain available');
assert(/@media \(pointer: coarse\)[\s\S]*#stage[\s\S]*will-change:\s*transform/.test(styles));
assert(/@media \(pointer: coarse\)[\s\S]*#stage \*[\s\S]*animation:\s*none !important/.test(styles));

const handlers = new Map();
const classes = new Set();
const timers = new Map();
let nextTimer = 0;
const stage = {
  style: {}, setPointerCapture() {},
  classList: {
    add: (...names) => names.forEach(name => classes.add(name)),
    remove: (...names) => names.forEach(name => classes.delete(name)),
  },
  addEventListener: (type, handler) => handlers.set(type, handler),
};
vm.runInNewContext(source, {
  document: { getElementById: () => stage },
  window: { matchMedia: query => ({ matches: query.includes('pointer: coarse') }), addEventListener() {} },
  setTimeout: fn => { timers.set(++nextTimer, fn); return nextTimer; },
  clearTimeout: id => timers.delete(id),
});

const pointer = (type, id, x, y) => handlers.get(type)({
  pointerId: id, pointerType: 'touch', clientX: x, clientY: y,
  target: { closest: () => null },
});
const click = () => {
  let prevented = false;
  handlers.get('click')({ preventDefault() { prevented = true; }, stopPropagation() {} });
  return prevented;
};

pointer('pointerdown', 1, 50, 50);
assert(classes.has('is-gesturing'));
pointer('pointermove', 1, 90, 80);
assert.equal(stage.style.transform, 'translate3d(40px,30px,0)');
pointer('pointerup', 1, 90, 80);
assert.equal(stage.style.transform, 'translate3d(0px,0px,0)', 'release must recenter');
assert(click(), 'drag-generated click must be suppressed');

pointer('pointerdown', 2, 50, 50);
pointer('pointerup', 2, 50, 50);
assert(!click(), 'an intentional tap must navigate');

pointer('pointerdown', 3, 50, 50);
pointer('pointerdown', 4, 100, 50);
pointer('pointermove', 4, 160, 50);
assert.equal(stage.style.transform, 'translate3d(0px,0px,0)', 'second pointer must not transform stage');
pointer('pointercancel', 3, 50, 50);

console.log('  pan-lifecycle: ok (translate only, recenter, tap, drag, second pointer)');
