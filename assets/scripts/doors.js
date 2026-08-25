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

window.addEventListener('pagereveal', (event) => {
    if (!event.viewTransition) return;

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
