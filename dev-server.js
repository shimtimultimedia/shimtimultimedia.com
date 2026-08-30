/*
 * Local development server with live reload.
 *
 * Run it with:  node dev-server.js      then open http://localhost:3000
 *
 * Why this exists rather than a dependency:
 * The site fetches assets/data/languages.json, which browsers block over file://, so
 * index.html cannot simply be opened from disk - it has to be served over HTTP.
 * This has no npm dependencies, so it works offline and cannot break when some CLI
 * tool changes its flags.
 *
 * CSS changes are hot-swapped without reloading the page. That matters here: a full
 * reload restarts the particle canvas, the ring animations and the welcome carousel,
 * so a styling tweak would otherwise throw away the visual state you were judging.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { watch } from 'node:fs';
import { join, extname, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { createReadStream } from 'node:fs';
import { TYPES, SEEKABLE } from './dev-mime.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

// The table lives in dev-mime.js so a test can check it without starting a listener.

// Connected browser tabs, held open as Server-Sent Event streams.
const clients = new Set();

// Injected into every HTML response. Kept deliberately small and dependency-free.
const LIVE_RELOAD_SNIPPET = `
<script>
(function () {
  var source = new EventSource('/__dev/reload');
  source.addEventListener('css', function () {
    // Re-request each stylesheet with a fresh query string. Replacing the href
    // swaps the styles in place, leaving canvas and SVG animation state untouched.
    document.querySelectorAll('link[rel="stylesheet"]').forEach(function (link) {
      var url = new URL(link.href, location.href);
      url.searchParams.set('__reload', Date.now());
      link.href = url.pathname + url.search;
    });
    console.log('[dev] styles reloaded');
  });
  source.addEventListener('reload', function () { location.reload(); });
  source.addEventListener('open', function () { console.log('[dev] live reload connected'); });
  source.onerror = function () { /* server restarting; EventSource retries on its own */ };
})();
</script>
`;

function send(res, status, type, body, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store, max-age=0',
    ...extraHeaders,
  });
  res.end(body);
}

const warned = new Set();

/*
 * Byte-range delivery, streamed rather than buffered.
 *
 * readFile() on a 5MB clip pulls the whole thing into memory for every seek; a stream
 * hands over only the slice asked for. An unsatisfiable range gets a 416 rather than a
 * confusing empty 206.
 */
function sendRange(req, res, file, size, type) {
  const header = req.headers.range;
  if (!header || !/^bytes=/.test(header)) {
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store, max-age=0',
    });
    return createReadStream(file).pipe(res);
  }

  const [rawStart, rawEnd] = header.replace('bytes=', '').split('-');
  const start = rawStart ? Number(rawStart) : 0;
  const end = rawEnd ? Math.min(Number(rawEnd), size - 1) : size - 1;

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` });
    return res.end();
  }

  res.writeHead(206, {
    'Content-Type': type,
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store, max-age=0',
  });
  return createReadStream(file, { start, end }).pipe(res);
}

const server = createServer(async (req, res) => {
  // Parsing has to be guarded. A request for "//" - which a browser or a stray link can
  // produce - makes the URL constructor throw ERR_INVALID_URL, and because this ran
  // outside the try/catch below, one such request took down the entire dev server.
  let url;
  try {
    url = new URL(req.url, `http://localhost:${PORT}`);
  } catch {
    return send(res, 400, 'text/plain', 'Bad Request');
  }

  // Live-reload event stream.
  if (url.pathname === '/__dev/reload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('event: open\ndata: connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  try {
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';

    // Strip any leading traversal before joining, so a crafted path cannot escape ROOT.
    const target = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (relative(ROOT, target).startsWith('..')) {
      return send(res, 403, 'text/plain', 'Forbidden');
    }

    const info = await stat(target);
    const file = info.isDirectory() ? join(target, 'index.html') : target;
    const ext = extname(file).toLowerCase();
    const type = TYPES[ext];
    if (!type) {
      // Loud, once per extension. The old silent fallback to octet-stream is precisely
      // what let mislabelled media ship unnoticed.
      if (!warned.has(ext)) {
        warned.add(ext);
        console.warn(`  [dev] no MIME type for "${ext}" (${relative(ROOT, file)})`
          + ' - add it to dev-mime.js; serving as application/octet-stream');
      }
    }

    // Media is requested in pieces. Answering a Range request with the whole file and a
    // 200 leaves the scrub bar inert, which reads as a broken player rather than a
    // broken server.
    if (SEEKABLE.has(ext)) {
      return sendRange(req, res, file, info.size, type);
    }

    if (ext === '.html') {
      const html = await readFile(file, 'utf8');
      const injected = html.includes('</body>')
        ? html.replace('</body>', `${LIVE_RELOAD_SNIPPET}</body>`)
        : html + LIVE_RELOAD_SNIPPET;
      return send(res, 200, type, injected);
    }

    return send(res, 200, type || 'application/octet-stream', await readFile(file));
  } catch {
    // Serve the real 404 page so it can be worked on like any other page.
    try {
      const notFound = await readFile(join(ROOT, '404.html'), 'utf8');
      return send(res, 404, 'text/html; charset=utf-8',
        notFound.replace('</body>', `${LIVE_RELOAD_SNIPPET}</body>`));
    } catch {
      return send(res, 404, 'text/plain', '404 Not Found');
    }
  }
});

function broadcast(event) {
  for (const client of clients) client.write(`event: ${event}\ndata: ${Date.now()}\n\n`);
}

// Coalesce bursts: editors often write a file several times in quick succession, and
// each write would otherwise trigger its own reload.
let timer = null;
let cssOnly = true;

watch(ROOT, { recursive: true }, (_event, filename) => {
  if (!filename) return;
  const name = filename.toString().replace(/\\/g, '/');
  if (name.startsWith('.git/') || name.includes('node_modules/')) return;

  const ext = extname(name).toLowerCase();
  if (!['.html', '.css', '.js', '.json', '.svg', '.xml'].includes(ext)) return;

  if (ext !== '.css') cssOnly = false;

  clearTimeout(timer);
  timer = setTimeout(() => {
    broadcast(cssOnly ? 'css' : 'reload');
    console.log(`  ${cssOnly ? 'styles' : 'page'} changed -> ${clients.size} tab(s) updated`);
    cssOnly = true;
  }, 80);
});

// Last line of defence. A development server that dies on one bad request is worse than
// useless: the page silently stops updating and the cause is off-screen in a log.
server.on('clientError', (_err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

process.on('uncaughtException', (err) => {
  console.error('  [dev] recovered from:', err.message);
});

server.listen(PORT, () => {
  console.log(`\n  Shimti Multimedia - dev server`);
  console.log(`  http://localhost:${PORT}\n`);
  console.log(`  Watching for changes. CSS hot-swaps; everything else reloads.\n`);
});
