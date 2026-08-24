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
must be served over HTTP rather than opened directly:

```bash
npx serve .
```

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
└── assets/
    ├── data/           languages.json — welcome carousel strings (36 languages)
    ├── fonts/          Orbitron
    ├── images/         Menu icons, logo, favicons
    ├── scripts/        ui-elements.js, title-panel.js, background.js
    └── styles/         styles.css
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
