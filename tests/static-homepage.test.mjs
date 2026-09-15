import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const styles = read('assets/styles/styles.css');
const panels = read('assets/scripts/node-panels.js');

assert(!html.includes('look-around.js'), 'homepage must not load a stage gesture handler');
assert(/#stage\s*{[\s\S]*?touch-action:\s*none/.test(styles), 'stage must reject browser gestures');
assert(!/is-gesturing|is-recentring/.test(styles), 'gesture-only stage states must stay removed');
assert(/@media \(pointer: coarse\)[\s\S]*?#backgroundRings\s*{[\s\S]*?1388px/.test(styles),
  'phone must retain the measured desktop ring field');
assert(/@media \(pointer: coarse\)[\s\S]*?#ringTitle\s*{[\s\S]*?1388px/.test(styles),
  'phone must retain the desktop-sized wordmark field');
assert(/@media \(pointer: coarse\)[\s\S]*?#radialMenu\s*{[\s\S]*?width:\s*400px/.test(styles),
  'phone must retain the desktop wheel size');
assert(/el\.addEventListener\('pointerdown', \(e\) => startDrag\(node, e\)\)/.test(panels),
  'title and welcome panels must remain draggable');
assert(!panels.includes('document.fonts.ready'),
  'late font loading must not re-home the panels');
const panelSizeObserver = panels.match(/const sizeObserver = new ResizeObserver\([\s\S]*?for \(const node of nodes\) if \(node\.resizes\)/)?.[0] || '';
assert(panelSizeObserver && !/\bplace\(/.test(panelSizeObserver),
  'panel content resizing must update measurements without moving the panel');

console.log('  static-homepage: ok (fixed desktop crop, no stage gestures, stable draggable panels)');
