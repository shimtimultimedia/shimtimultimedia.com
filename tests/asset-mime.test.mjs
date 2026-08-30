/*
 * Guards the MIME table against the site growing past it.
 *
 * WHY THIS EXISTS
 *
 * Three audio masters were added to the Music production instrument and served as
 * application/octet-stream, because dev-server.js had no '.m4a' entry and its lookup fell
 * back to a byte stream without complaint. The same hole had already swallowed every
 * .mp4 and .glb on the site.
 *
 * The bug was never "the table is missing .m4a". It was that a hand-maintained table
 * could fall silently behind the asset tree it describes. This test closes that: add a
 * new kind of asset without teaching dev-mime.js about it and the test names the file and
 * the extension. Fixing it is one line in one obvious place.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TYPES, SEEKABLE } from '../dev-mime.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SKIP_DIRS = new Set(['.git', 'node_modules', 'tests']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/*
 * "Does this file ship?" already has an answer in .gitignore, so it is asked there rather
 * than re-decided here. A second list of exclusions maintained by hand would drift from
 * the first one exactly the way the MIME table drifted from the asset tree.
 */
function shipped(files) {
  if (!files.length) return [];
  let ignored = new Set();
  const collect = (text) => new Set(
    String(text).split('\n').map((line) => line.trim()).filter(Boolean),
  );
  try {
    ignored = collect(execFileSync('git', ['check-ignore', '--stdin'],
      { cwd: ROOT, input: files.join('\n'), encoding: 'utf8' }));
  } catch (err) {
    // git exits 1 when nothing matched, which is a valid answer rather than a failure.
    if (err.status === 1 && typeof err.stdout === 'string') ignored = collect(err.stdout);
    else console.warn('  asset-mime: git check-ignore unavailable, checking every file');
  }
  return files.filter((f) => !ignored.has(f));
}

const failures = [];
const tracked = shipped(
  walk(ROOT).map((f) => path.relative(ROOT, f).split(path.sep).join('/')),
);

// 1. Every extension the site actually ships has a type.
const unmapped = new Map();
for (const file of tracked) {
  const ext = path.extname(file).toLowerCase();
  // Extensionless files (LICENSE and friends) are documentation, not served assets.
  if (!ext || TYPES[ext]) continue;
  if (!unmapped.has(ext)) unmapped.set(ext, file);
}
for (const [ext, example] of unmapped) {
  failures.push(`no MIME type for "${ext}" (e.g. ${example}) - add it to dev-mime.js`);
}

// 2. Audio and video must be declared seekable, or the scrub bar does nothing.
for (const [ext, type] of Object.entries(TYPES)) {
  if (/^(audio|video)\//.test(type) && !SEEKABLE.has(ext)) {
    failures.push(`"${ext}" is ${type} but missing from SEEKABLE - seeking would break`);
  }
}

if (failures.length) {
  console.error('\n  asset-mime: FAIL');
  for (const f of failures) console.error('    - ' + f);
  process.exit(1);
}
console.log(`  asset-mime: ok (${tracked.length} files, ${Object.keys(TYPES).length} types)`);
