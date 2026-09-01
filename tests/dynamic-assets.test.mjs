/*
 * Guards assets whose paths are built at runtime.
 *
 * WHY THIS EXISTS
 *
 * Eight SVGs were deleted as unreferenced. They were not: ui-elements.js builds the
 * radial menu's icon paths with
 *
 *     href: `assets/images/${label}.svg`
 *
 * so no search for a filename could ever find them, and every check that mattered - the
 * HTML validator, the link checker, the MIME guard - passed with the home page's
 * navigation showing six broken-image icons. The only thing that caught it was a person
 * looking at the screen.
 *
 * The lesson is not "be more careful". It is that a literal-string search cannot see a
 * computed path, so the computed paths need naming somewhere a test can read. This file
 * is that place: it derives the labels from the same constant the menu builds from, and
 * asserts every file those labels resolve to is on disk.
 *
 * Add another runtime-built asset path and it belongs here too.
 *
 * Run with:  node tests/dynamic-assets.test.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const failures = [];

/* ---- the radial menu's sector icons ------------------------------------------------ */

const ui = fs.readFileSync(path.join(ROOT, 'assets/scripts/ui-elements.js'), 'utf8');

// Read the labels from the source rather than restating them here. A copy kept in this
// file would drift from the menu the first time a section was added or renamed, and the
// test would then be guarding a set nobody uses.
const listed = ui.match(/NAVIGATION_LINKS:\s*\[([^\]]*)\]/);
if (!listed) {
  failures.push('could not find NAVIGATION_LINKS in ui-elements.js - has it been renamed?');
} else {
  const labels = [...listed[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (!labels.length) failures.push('NAVIGATION_LINKS is empty');

  // Confirm the template that consumes them still looks the way this test assumes.
  if (!ui.includes('`assets/images/${label}.svg`')) {
    failures.push('the icon path template in ui-elements.js has changed - update this test');
  }

  for (const label of labels) {
    const file = path.join(ROOT, 'assets/images', `${label}.svg`);
    if (!fs.existsSync(file)) {
      failures.push(`assets/images/${label}.svg is missing - the "${label}" sector would`
        + ' render as a broken image');
    }
  }
  console.log(`  sector icons: ${labels.length} checked (${labels.join(', ')})`);
}

/* ---- nothing else should be building asset paths unnoticed ------------------------- */

const scriptDir = path.join(ROOT, 'assets/scripts');
const built = [];
for (const name of fs.readdirSync(scriptDir).filter((f) => f.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(scriptDir, name), 'utf8');
  for (const m of src.matchAll(/`[^`\n]*assets\/[^`\n]*\$\{[^`\n]*`/g)) {
    built.push(`${name}: ${m[0]}`);
  }
}

// One is known and guarded above. A second appearing means this file needs extending -
// otherwise it is another set of assets that can be deleted without anything noticing.
const KNOWN = 1;
if (built.length > KNOWN) {
  failures.push(`${built.length} runtime-built asset paths found, ${KNOWN} guarded:`);
  for (const b of built) failures.push(`    ${b}`);
}
console.log(`  runtime-built asset paths: ${built.length} found, ${KNOWN} guarded`);

if (failures.length) {
  console.error('\n  dynamic-assets: FAIL');
  for (const f of failures) console.error('    - ' + f);
  process.exit(1);
}
console.log('  dynamic-assets: ok');
