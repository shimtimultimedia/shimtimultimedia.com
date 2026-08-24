# Shimti Multimedia

The homepage for Shimti Multimedia — a sci-fi interface built around a radial navigation
menu, an animated particle grid, and a rotating field of concentric rings.

**Status:** alpha. The site is served publicly by GitHub Pages but is marked `noindex`
until launch. See [LAUNCH.md](LAUNCH.md) for the full go-live checklist.

**Live:** https://shimtimultimedia.github.io/shimtimultimedia.com/

## Stack

Plain HTML5, CSS3 and ES6+ JavaScript. **No build step and no dependencies** — what is in
the repository is exactly what is served. This mirrors the `bryant-duhart` setup.

## Running locally

The site fetches `assets/data/languages.json`, which browsers block over `file://`, so it
must be served over HTTP rather than opened directly.

```bash
node dev-server.js
```

Then open <http://localhost:3000>. It reloads the page when a file changes, and swaps
stylesheets in place without a reload - a full reload would restart the particle canvas,
the ring animations and the welcome carousel, throwing away whatever visual state you
were looking at. No dependencies; plain Node.

## Layout

```
.
├── index.html          Homepage
├── 404.html            Error page (noindex)
├── manifest.json       PWA manifest, all paths relative
├── sw.js               Service worker — written but NOT registered (see LAUNCH.md)
├── robots.txt          Allows crawling; indexing is blocked by a meta tag in index.html
├── sitemap.xml
├── favicon.ico         Root copy; browsers request /favicon.ico by convention
├── .nojekyll           Serve files as-is instead of running them through Jekyll
├── dev-server.js       Local dev server with live reload (not used in production)
├── about.html          Section pages, one per radial sector
├── ai.html
├── work.html
├── shop.html
├── media.html
├── contact.html
└── assets/
    ├── data/           languages.json — welcome carousel strings (36 languages)
    ├── fonts/          Orbitron
    ├── images/         Menu icons, logo, favicons
    ├── scripts/        ui-elements.js, title-panel.js, background.js, section-panels.js
    └── styles/         styles.css (homepage), section.css (section pages)
```

## How the homepage is layered

Four stacked layers, back to front:

| z-index | Element | Role |
|--------:|---------|------|
| 0 | `#backgroundCanvas` | Particle grid, drawn on canvas |
| — | `#uiSvg` | Menu chrome — static, so it paints below positioned layers |
| 1 | `#backgroundRings` | Decorative ring field and arced wordmark |
| 5 | `#shimtiPanel`, `#shimtiPanelBottom` | Branding and welcome carousel |
| 1000 | `#radialMenu` | Interactive navigation — always on top |

`#backgroundRings` is inline SVG animated with SMIL, ported from an earlier build. It is
`aria-hidden` and `pointer-events: none`, so it is invisible to screen readers and never
intercepts a click meant for the menu.

### Where the navigation actually lives

Not where it looks like it does. `#radialMenu` is only a **sizing anchor** - an empty
div that `ui-elements.js` measures. The real wheel is drawn into `#uiSvg`, a sibling,
as `g#wheelMenu`.

Two consequences worth knowing before editing either file:

- `g#wheelMenu` is appended directly to `#uiSvg`, **not** into the decorative root
  group. That group carries `aria-hidden="true"` for the rings and connection lines;
  nesting the menu inside it hid all six links from screen readers.
- The wheel is **rebuilt from scratch on every resize**. Anything bound directly to a
  sector, or to `#wheelMenu` itself, stops working the first time the window is
  resized. `section-panels.js` therefore delegates from `document` and re-applies its
  attributes via a `MutationObserver`.

Each sector is a real SVG `<a href>`, so it is focusable, activates on Enter, is
announced as a link, and supports middle-click and "open in new tab".

## Accessibility

The site animates continuously, which can provoke nausea and dizziness in people with
vestibular disorders, so it honours the OS-level *reduce motion* setting (WCAG 2.1
SC 2.3.3). This takes **two** mechanisms, and both are required:

- **CSS animations** — disabled by the `@media (prefers-reduced-motion: reduce)` block in
  `styles.css`.
- **SMIL animations** — ignore CSS entirely, so the SVG animation clock is stopped via
  `pauseAnimations()` in the inline script in `index.html`.

Removing either one leaves half the motion running.

## Deployment

Pushing to `main` publishes the site. There is no build step, so the repository root is
served directly.

## License

MIT — see [LICENSE.txt](LICENSE.txt).
