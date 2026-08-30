/*
 * The one MIME table, shared by the dev server and the test that guards it.
 *
 * WHY THIS IS ITS OWN MODULE
 *
 * It used to live inside dev-server.js as a literal, and it listed no media types at all.
 * Every video, model and audio file the site shipped was therefore served as
 * application/octet-stream - and served *quietly*, because the lookup fell back to that
 * string without a word. Nothing failed at the server; the failure surfaced much later as
 * a browser refusing to play a track, with no indication of why.
 *
 * Pulling the table out here lets tests/asset-mime.test.mjs read it without starting a
 * listener, so a new kind of asset with no mapping now fails a test instead of shipping
 * mislabelled.
 */

export const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',

  // Media. Audio and video are the formats that actually punish a wrong Content-Type:
  // Safari will not decode a track it has been told is a byte stream.
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.vtt': 'text/vtt; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
};

/* Types that must be delivered whole, and types a browser may ask for in pieces. Seeking
   a video or scrubbing a track is a Range request; answering it with a 200 and the entire
   file makes the scrub bar inert. */
export const SEEKABLE = new Set([
  '.m4a', '.mp3', '.wav', '.ogg', '.mp4', '.webm',
]);

/*
 * Repo tooling that lives beside the site but is never part of it.
 *
 * The keepalive scripts tripped the MIME guard, and the tempting fix was to give them a
 * type. That would have been the wrong answer: the question is not "what type is a .cmd",
 * it is "why would a web server hand one to a visitor at all". They are declared
 * unservable instead, the server refuses them, and the guard stops asking for a type it
 * should never need.
 */
export const NEVER_SERVED = new Set([
  '.cmd', '.bat', '.ps1', '.vbs', '.sh', '.exe', '.dll', '.msi',
]);
