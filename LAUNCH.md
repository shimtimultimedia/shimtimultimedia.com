# Launch Checklist

Everything on this site that is deliberately set to "alpha" is listed here. Nothing else
in the repository is gated on development state, so this file is the complete set of
changes needed to go public.

## 1. Allow search engines to index the site

The site is currently crawlable but not indexable. That combination is intentional: a
crawler blocked by `robots.txt` never fetches the page, so it never sees the `noindex`
tag, and the bare URL can still show up in results. Allowing the fetch is what makes the
`noindex` actually work.

- [ ] Delete this line from `index.html`:
      `<meta name="robots" content="noindex, follow">`
- [ ] `robots.txt` needs **no change** — it already allows crawling.
- [ ] Confirm `404.html` keeps its `noindex` tag. Error pages should never be indexed.

## 2. Make the repository public

The user-facing site is already public — GitHub Pages serves publicly even from a private
repository. Making the repo public exposes the *source*, matching `bryant-duhart`.

- [ ] GitHub → repository **Settings** → **General** → **Danger Zone** → *Change
      visibility* → **Public**.
- [ ] Before doing this, confirm no secrets were ever committed:
      `git log -p | Select-String -Pattern "api[_-]?key|secret|token|password"`

## 3. Refresh the sitemap

- [ ] Update `<lastmod>` in `sitemap.xml` to the launch date.
- [ ] Add a `<url>` entry for every page added since launch. Right now the site is a
      single page, so there is one entry.

## 4. Verify social preview cards

`og:image` points at a 512x512 PNG. That renders, but it is square.

- [ ] Produce a 1200x630 PNG preview image (the format Facebook, LinkedIn, Discord and
      iMessage all expect) and point `og:image` / `twitter:image` at it.
- [ ] Update `og:image:width` / `og:image:height` to `1200` / `630`.
- [ ] Test with the official validators before announcing anywhere.

## 5. Optional: enable the service worker

`sw.js` is written and correct but deliberately never registered. Enabling it makes the
site work offline and load faster on repeat visits, at the cost of a caching layer to
reason about during active development.

- [ ] Add before the closing `</body>` in `index.html`:
      ```html
      <script>
        if ('serviceWorker' in navigator) {
          window.addEventListener('load', function () {
            navigator.serviceWorker.register('sw.js');
          });
        }
      </script>
      ```
- [ ] Bump `CACHE_VERSION` in `sw.js` on any deploy that changes precached assets.

## 6. Optional: custom domain

The site currently lives at `https://shimtimultimedia.github.io/shimtimultimedia.com/`.
Every internal URL is relative, so moving to `shimtimultimedia.com` does not require
touching any asset path. Only the absolute URLs in the document head change.

- [ ] Add a `CNAME` file at the repository root containing exactly: `shimtimultimedia.com`
- [ ] Point DNS at GitHub Pages (four `A` records for the apex, or a `CNAME` record for
      `www` → `shimtimultimedia.github.io`).
- [ ] Update the absolute URLs in `index.html`: `canonical`, `og:url`, `og:image`,
      `twitter:image`, and the `url`/`logo` fields in the JSON-LD block.
- [ ] Update the `Sitemap:` line in `robots.txt` and the `<loc>` in `sitemap.xml`.
- [ ] Enable **Enforce HTTPS** in Settings → Pages once the certificate is issued.

## 7. Remove development logging

`assets/scripts/ui-elements.js` and `background.js` log heavily on every page load
(~30 lines per visit). Useful while building, noise in production.

- [ ] Gate the logging behind a debug flag, or strip it, before launch.

## 8. Tighten the Lighthouse SEO assertion

`.lighthouserc.json` asserts the individual SEO audits (title, meta description, link
text, canonical, robots.txt and so on) rather than the aggregate `categories:seo` score.

That is deliberate. While the site carries `noindex`, Lighthouse scores the whole SEO
category at 69 because of the `is-crawlable` audit, so asserting the aggregate would
have required an alpha-only threshold that someone must remember to raise. Asserting
the underlying audits avoids that entirely.

Once the `noindex` tag is removed in step 1:

- [ ] Add `"is-crawlable": "error"` to the assertions in `.lighthouserc.json`.
- [ ] Add `"categories:seo": ["error", { "minScore": 0.95 }]` alongside it.
- [ ] Run the **Audit** workflow manually to confirm it passes before relying on it.
