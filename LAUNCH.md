# Launch Checklist

The site is launched. Nothing in the repository is gated on development state any more.

This file is kept as the record of what "alpha" meant and how each part of it was
resolved, because the reasoning behind several of these is not obvious from the code
alone and would otherwise be re-litigated later.

Only one optional item is outstanding: the custom domain, which needs DNS changes only
the account owner can make.

---

## 1. Search engine indexing — DONE

The site was crawlable but not indexable. That combination was deliberate: a crawler
blocked by `robots.txt` never fetches the page, so it never sees the `noindex` tag, and
the bare URL can still appear in results. Allowing the fetch is what makes `noindex`
actually take effect.

- [x] `<meta name="robots" content="noindex, follow">` removed from `index.html` and all
      six section pages.
- [x] `robots.txt` unchanged — it already allowed crawling, by design.
- [x] `404.html` **keeps** its `noindex`. An error page is not content, and indexing one
      creates dead search results pointing at nothing.

## 2. Repository visibility — DONE

- [x] Repository is **public**. The user-facing site was always public — GitHub Pages
      serves publicly even from a private repository — so this exposed the *source*,
      matching `bryant-duhart`.
- [x] History scanned for committed secrets. Clean: the only matches were the text of
      this checklist describing the scan.

## 3. Sitemap — DONE

- [x] All seven pages listed.
- [x] `<lastmod>` set to `2026-08-25` across every entry.

## 4. Social preview cards — DONE

- [x] `assets/images/og-card.jpg` — 1200x630, the size every major scraper expects.
- [x] `og:image` / `twitter:image` on all seven pages point at it, with
      `og:image:type`, `og:image:width` and `og:image:height` declared so a scraper can
      lay the card out before the image has downloaded.

Two format traps are worth recording, because both produce a *blank or thumbnail* card
rather than an error:

- **SVG never works.** Facebook, LinkedIn, Discord and iMessage all refuse to render it.
- **WebP is not safe either.** The section pages previously pointed at their own
  640x360 `.webp` preview, which failed on the same scrapers *and* was well under the
  expected size, so it rendered as a small thumbnail instead of a large card.

JPEG at 1200x630 is the format that works everywhere.

A single shared card is used site-wide. Per-section cards would be an improvement; they
are not required for launch.

## 5. Service worker — DONE

- [x] Registered via `assets/scripts/register-sw.js`, loaded with `defer`.
- [x] `CACHE_VERSION` bumped to `v3`.

Registration lives in an external file rather than an inline `<script>` on purpose. The
site's CSP is `script-src 'self'`, and inlining would mean either opening it up with
`'unsafe-inline'` — defeating most of the point of the policy — or pinning a hash that
silently breaks the registration the next time anyone edits the snippet.

Static assets are served **stale-while-revalidate**: the cached copy is returned at once
and a fresh one is fetched and written over it in the background.

The first version was cache-first with no revalidation, which meant an asset, once cached,
was served forever unless someone remembered to bump `CACHE_VERSION`. That shipped a stale
background script to a live browser and the background stopped rendering, with nothing to
indicate why — everything was behaving exactly as written. Correctness must not depend on
a step someone has to remember, so it no longer does. Bumping `CACHE_VERSION` still evicts
everything at once and is useful on a large deploy, but it is now an optimisation rather
than an obligation.

## 6. Custom domain — CODE DONE, DNS OUTSTANDING

Every internal URL is relative, so the move touches no asset path. Only the absolute URLs
in the document heads, the sitemap and robots.txt changed.

### Done in the repository

- [x] `CNAME` at the repository root containing exactly `shimtimultimedia.com`, LF-only.
      Pinned to LF in `.gitattributes`: Pages reads this file as the literal domain, so a
      stray carriage return becomes part of the domain name.
- [x] All 42 absolute URLs rebased to `https://shimtimultimedia.com/` across the seven
      pages (`canonical`, `og:url`, `og:image`, `twitter:image`, and the `url`/`logo`
      fields in the JSON-LD block), `sitemap.xml`, `robots.txt`, `README.md`, and
      `SITE_URL` in the Audit workflow.
- [x] A **Canonical host** job added to the Quality workflow that fails the build if the
      old host appears in any served file, or if `CNAME` is not one clean line.

### ⚠ Deploy order matters

**Do not push this before DNS resolves.** The `CNAME` file is what makes Pages switch to
the custom domain, and it also makes the `github.io` address redirect there. Push it
before DNS is answering and the site is unreachable at *both* addresses — and the
canonical, `og:image` and sitemap URLs would all point at a host that does not exist.

Correct order:

1. **Add the DNS records** at the registrar, and wait for them to propagate.

   Apex `shimtimultimedia.com` — four `A` records:

   ```
   185.199.108.153
   185.199.109.153
   185.199.110.153
   185.199.111.153
   ```

   Optionally the four `AAAA` records for IPv6:

   ```
   2606:50c0:8000::153
   2606:50c0:8001::153
   2606:50c0:8002::153
   2606:50c0:8003::153
   ```

   And for `www`, a `CNAME` record pointing at `shimtimultimedia.github.io` — the account,
   **without** the repository name.

2. **Verify** with `dig shimtimultimedia.com +short` (or `nslookup`) that the A records
   are answering.
3. **Then push this commit.** Pages picks up the `CNAME` file and starts serving the
   domain.
4. Wait for GitHub to issue the TLS certificate — usually minutes, occasionally an hour.
5. Enable **Enforce HTTPS** in Settings → Pages once the certificate exists.
6. Re-run the **Audit** workflow; it now points at the new domain.

If it needs backing out, delete `CNAME` and revert the rebase commit — the `github.io`
address starts serving again as soon as Pages redeploys.

## 7. Development logging — DONE

- [x] `DEBUG_MODE` and `VERBOSE_LOGGING` in `assets/scripts/ui-elements.js` are derived
      from `location.hostname` rather than hard-coded.

Setting them to `false` would only have moved the problem: the next person debugging
locally turns them on, and production staying quiet then depends on nobody forgetting to
turn them back off before pushing. Deriving them makes production quiet by construction
and local development verbose by construction, with nothing to remember either way.
Errors and warnings are deliberately not gated — those are for real faults.

## 8. Lighthouse SEO assertions — DONE

`.lighthouserc.json` used to assert the individual SEO audits rather than the aggregate
score, because while the site carried `noindex` the `is-crawlable` audit held the whole
SEO category at 69, and asserting the aggregate would have needed an alpha-only threshold
someone had to remember to raise.

With `noindex` gone that workaround is no longer needed:

- [x] `"is-crawlable": "error"` asserted.
- [x] `"categories:seo": ["error", { "minScore": 0.95 }]` asserted.
- [ ] Run the **Audit** workflow once against the live site to confirm it passes.
