/*
 * Registers the service worker.
 *
 * A separate file rather than an inline <script> on purpose: the site's CSP is
 * script-src 'self', and inlining this would mean either opening it up with
 * 'unsafe-inline' - which defeats most of the point of having a policy - or pinning a
 * hash that silently breaks the registration the next time anyone edits the snippet.
 *
 * Registration waits for load so it never competes with first paint for bandwidth.
 *
 * A failure is reported, not swallowed. It must not break the page - the site works
 * identically without a cache - but silently discarding the error is how a registration
 * that has been broken for weeks goes unnoticed, and it cost real time diagnosing exactly
 * that. Warn and carry on: harmless to a visitor, visible to whoever is looking.
 */

'use strict';

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // Relative on purpose. On a GitHub Pages PROJECT site the app lives under
        // /shimtimultimedia.com/, so an absolute '/sw.js' would resolve to the user-site
        // root and register nothing. This resolves correctly there and on a custom domain
        // later, with no edit.
        navigator.serviceWorker.register('sw.js').catch((error) => {
            const log = window.ShimtiUtils && window.ShimtiUtils.Logger;
            if (log) new log('ServiceWorker').warn('Registration failed', { error: String(error) });
        });
    });
}
