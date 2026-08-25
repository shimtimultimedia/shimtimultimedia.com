/*
 * Shimti Multimedia - door transition support
 *
 * The doors are CSS. This exists for one thing the stylesheet cannot know on its own:
 * whether this page load is the end of a view transition or a load in its own right.
 *
 * The homepage opens its doors on load, because arriving directly at the site should show
 * the reveal rather than the aftermath of it. But arriving home FROM a section is a view
 * transition, which is already animating those same doors apart. Both at once animates one
 * element twice - the CSS animation wins, snaps the doors to open, and the transition
 * plays against a target that has already moved.
 *
 * pagereveal fires on the incoming document before its first frame, and carries the
 * transition when there is one. That is the only moment this can be known, and it is early
 * enough to matter.
 *
 * Everything here is an enhancement. Where pagereveal is unsupported, the homepage simply
 * always opens its doors under its own power, which is the correct behaviour anyway - just
 * occasionally doubled with a transition.
 *
 * @requires assets/styles/doors.css
 */

'use strict';

/*
 * The doors must never be able to hide the site.
 *
 * Opening them is a CSS animation, and a CSS animation can be applied and running and
 * still never advance - a frozen document timeline reports exactly that: playState
 * "running", currentTime stuck at 0. In that state the FROM keyframe holds, which is shut,
 * and the homepage sits behind two opaque panels indefinitely. Not a blank-looking page: a
 * blank page.
 *
 * That is not hypothetical either. It is precisely what the browser pane used to develop
 * this does, so it is a real state a real engine can be in.
 *
 * Timers run independently of the animation timeline, so one can check the other. If the
 * doors have not actually moved by the time they should have finished, they are put where
 * they belong. The reveal is lost; the site is not.
 */
function guardAgainstStuckDoors() {
    if (document.documentElement.dataset.doors !== 'open') return;

    const door = document.querySelector('.door-left');
    if (!door) return;

    const declared = getComputedStyle(document.documentElement)
        .getPropertyValue('--door-duration').trim();
    const ms = declared.endsWith('ms') ? parseFloat(declared)
        : declared.endsWith('s') ? parseFloat(declared) * 1000
            : 700;

    setTimeout(() => {
        // Still overlapping the viewport means it never moved.
        if (door.getBoundingClientRect().right > 4) {
            document.documentElement.setAttribute('data-doors-stuck', '');
            const log = window.ShimtiUtils && window.ShimtiUtils.Logger;
            if (log) {
                new log('Doors').warn('Opening animation never ran; doors forced open', {
                    afterMs: ms * 2,
                });
            }
        }
    }, ms * 2);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', guardAgainstStuckDoors);
} else {
    guardAgainstStuckDoors();
}

/**
 * Names the journey, so the stylesheet can time it.
 *
 * All three navigations move the doors correctly on their own, but they do not want the
 * same treatment for the page BEHIND the doors:
 *
 *   shutting  the incoming page must stay hidden until the doors have actually met.
 *             Letting it fade in while they are still closing shows the destination
 *             through the gap and destroys the illusion that the doors are carrying it.
 *   opening   the machinery should be there the moment the doors part, not fade up
 *             afterwards - it is meant to have been behind them all along.
 *   swapping  neither door moves, so the content should simply cross over, quickly.
 *
 * None of that can be expressed without knowing where the navigation came from, and the
 * incoming document only learns that from the navigation entry it is activating.
 *
 * @returns {string} a view-transition type
 */
function journeyType() {
    const arrivingHome = document.documentElement.dataset.doors === 'open';
    if (arrivingHome) return 'opening';

    const from = window.navigation
        && window.navigation.activation
        && window.navigation.activation.from
        && window.navigation.activation.from.url;

    // No previous entry means this document was not reached from within the site, so
    // treat it as a fresh arrival behind shut doors.
    if (!from) return 'shutting';

    // The homepage is the only page served from a directory root rather than a filename.
    const cameFromHome = /\/(index\.html)?(\?|#|$)/.test(new URL(from, location.href).pathname
        + new URL(from, location.href).search);

    return cameFromHome ? 'shutting' : 'swapping';
}

window.addEventListener('pagereveal', (event) => {
    if (!event.viewTransition) return;

    // Types drive :active-view-transition-type() in doors.css. Added here rather than in
    // the outgoing page's pageswap because this is the document whose styles run the
    // transition, so this is where the type has to be true.
    if (event.viewTransition.types) {
        event.viewTransition.types.add(journeyType());
    }

    /*
     * Marked on <html> rather than <body> because the stylesheet needs it while matching
     * the door rules, and body is not guaranteed to be parsed when this fires.
     *
     * Removed once the transition settles, so a later load of this same document - a back
     * navigation restoring it from the cache, say - opens the doors properly again rather
     * than inheriting a flag from a navigation that has long finished.
     */
    document.documentElement.setAttribute('data-vt-arriving', '');

    event.viewTransition.finished.finally(() => {
        document.documentElement.removeAttribute('data-vt-arriving');
    });
});
