/*
 * Shimti Multimedia - the airlock
 *
 * The doors themselves are CSS. This decides when they should move, which comes down to
 * one question the stylesheet cannot answer on its own: is this navigation crossing
 * between the machinery and a page, or is it just one page to another?
 *
 *   home <-> section    a level change. Shut, pause, open.
 *   section -> section  an ordinary link. Nothing.
 *
 * Leaving is animated here, on the outgoing page, before the navigation is allowed to
 * happen. Arriving is animated by the incoming page on load. The two halves meet while the
 * screen is behind two opaque panels, which is what hides the load itself.
 *
 * Everything degrades to a plain navigation. If this file fails to run, every link still
 * works and every page still rests with its doors open - the ceremony is lost, nothing
 * else is.
 *
 * @requires assets/styles/doors.css
 */

'use strict';

(function () {
    const html = document.documentElement;
    const isHomePage = () => html.dataset.page === 'home';

    /** True when a URL is this site's homepage, whatever path the site is served from. */
    function urlIsHome(href) {
        const url = new URL(href, location.href);
        // The homepage is the only page served from a directory root rather than a
        // filename, on a user site and a project subpath alike.
        return /(^|\/)(index\.html)?$/.test(url.pathname);
    }

    /** True when moving between the machinery and a page, in either direction. */
    const crossesTheAirlock = (destination) => urlIsHome(destination) !== isHomePage();

    /* ------------------------------------------------------------------ arriving */

    function openOnArrival() {
        const from = window.navigation
            && window.navigation.activation
            && window.navigation.activation.from
            && window.navigation.activation.from.url;

        /*
         * Whether this was a level change is decided by comparing where the visitor came
         * FROM against which side this page is on - not against this page's own URL, which
         * would only ever compare a page to itself.
         *
         * No previous entry means the site was entered from outside: a typed URL, a
         * bookmark, a shared link. That is an arrival too, and the most important one to
         * show, so it gets the full airlock.
         */
        if (from && urlIsHome(from) === isHomePage()) return;

        html.setAttribute('data-airlock', 'in');
    }

    /* ------------------------------------------------------------------- leaving */

    function shutThenNavigate(destination) {
        html.setAttribute('data-airlock', 'out');

        const closing = document.querySelector('.door-left');
        const wait = durationMs('--door-close', 460);

        /*
         * Driven off the animation actually finishing, with a timer as the backstop.
         *
         * animationend is the honest signal, but it never fires if the animation could not
         * run - and a navigation that waits forever for it would leave the visitor stuck on
         * a page they asked to leave. The timer guarantees the navigation happens; the
         * event just makes it happen at the right moment when things are working.
         */
        let gone = false;
        const go = () => {
            if (gone) return;
            gone = true;
            location.href = destination;
        };

        if (closing) closing.addEventListener('animationend', go, { once: true });
        setTimeout(go, wait + 120);
    }

    /* -------------------------------------------------------------------- helpers */

    function durationMs(customProperty, fallback) {
        const raw = getComputedStyle(html).getPropertyValue(customProperty).trim();
        if (raw.endsWith('ms')) return parseFloat(raw);
        if (raw.endsWith('s')) return parseFloat(raw) * 1000;
        return fallback;
    }

    /*
     * The doors must never be able to hide the site.
     *
     * An arrival starts from shut, and a CSS animation can be applied and running and
     * still never advance - a frozen document timeline reports playState "running" with
     * currentTime pinned at 0. In that state the first keyframe holds and the page sits
     * behind two opaque panels indefinitely. Not a page that looks broken: a page that
     * cannot be seen.
     *
     * Timers run independently of the animation clock, so one can check the other. If the
     * doors have not actually moved by the time they should have finished, they are put
     * where they belong. The ceremony is lost; the site is not.
     */
    function guardAgainstStuckDoors() {
        const door = document.querySelector('.door-left');
        if (!door) return;

        const total = durationMs('--door-pause', 260) + durationMs('--door-open', 560);

        setTimeout(() => {
            // Still overlapping the viewport means it never moved.
            if (door.getBoundingClientRect().right > 4) {
                html.setAttribute('data-doors-stuck', '');
                const Logger = window.ShimtiUtils && window.ShimtiUtils.Logger;
                if (Logger) {
                    new Logger('Doors').warn('Arrival animation never ran; doors forced open', {
                        afterMs: Math.round(total * 1.6),
                    });
                }
            }
        }, total * 1.6);
    }

    /* --------------------------------------------------------------------- wiring */

    document.addEventListener('click', (event) => {
        // Anything other than a plain left click belongs to the browser: new tabs,
        // downloads, context menus and the like must not be swallowed by scenery.
        if (event.defaultPrevented || event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

        const link = event.target instanceof Element && event.target.closest('a[href]');
        if (!link || link.hasAttribute('download')) return;

        /*
         * Attributes, not properties, because the radial menu is SVG.
         *
         * On an SVG <a> both href and target are SVGAnimatedString objects rather than
         * strings. An object is always truthy, so a property-based `if (link.target)`
         * guard rejects every link in the menu - the entire primary navigation - while
         * looking perfectly correct, and href stringifies to "[object SVGAnimatedString]"
         * instead of a URL. Attributes read the same on both element types.
         */
        if (link.getAttribute('target')) return;

        const href = link.getAttribute('href');
        if (!href || href.startsWith('#')) return;

        const url = new URL(href, location.href);
        if (url.origin !== location.origin) return;
        if (url.href === location.href) return;
        if (!crossesTheAirlock(url.href)) return;

        // Reduced motion means no door movement at all, so there is nothing to wait for
        // and intercepting the navigation would only delay it.
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        event.preventDefault();
        shutThenNavigate(url.href);
    });

    /*
     * The airlock does its own animating, so the browser's transition would be a second
     * opinion on the same navigation. Skipped rather than styled away, because the screen
     * is already behind two opaque panels by then and there is nothing left to conceal.
     */
    window.addEventListener('pageswap', (event) => {
        if (!event.viewTransition) return;
        if (html.getAttribute('data-airlock') === 'out') event.viewTransition.skipTransition();
    });

    /*
     * The arrival is decided NOW, while the document is still parsing.
     *
     * This file is loaded from <head> without defer, which is deliberate and is the whole
     * reason the airlock works in both directions. Deferred, it ran after the document had
     * parsed - by which time the page had already painted with the doors at rest, open. The
     * doors then snapped shut and opened again, so arriving home showed the machinery
     * first and the airlock afterwards, which reads as no airlock at all. Coming from the
     * homepage hid the fault, because the closing half had already played on the page being
     * left.
     *
     * Marking <html> before <body> exists means the first frame the browser paints already
     * has the doors shut. Nothing is ever seen before the doors decide to reveal it.
     */
    /*
     * A prerendered document has not arrived anywhere yet.
     *
     * Prerendering runs a page in full - scripts included - before the visitor has
     * clicked anything. This code would decide it had arrived, play the whole
     * shut-pause-open sequence invisibly, and be finished by the time the page was
     * actually activated, so the visitor would see it appear with the doors already open.
     * That is precisely what the speculation rules used to cause, and why the site's own
     * rules now prefetch rather than prerender.
     *
     * They are not the only way a page can be prerendered, though, so the decision is
     * deferred to activation whenever this document is running ahead of the visitor.
     * activation.from is only meaningful at that point anyway.
     */
    if (document.prerendering) {
        document.addEventListener('prerenderingchange', openOnArrival, { once: true });
    } else {
        openOnArrival();
    }

    /*
     * The rest needs elements, so it waits. The guard measures a door and the click handler
     * is only useful once there is something to click.
     */
    function wireUp() {
        if (html.getAttribute('data-airlock') === 'in') guardAgainstStuckDoors();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wireUp);
    } else {
        wireUp();
    }
}());
