/*
 * Shimti Multimedia - background worker
 *
 * Drives the background field on its own thread, so the particle simulation and every
 * canvas call it makes stop competing with the main thread for time.
 *
 * That contention was real, not theoretical: dragging a node runs pointer handling, wire
 * routing and layout on the main thread, and the background was asking that same thread
 * for a full canvas repaint 45 times a second in between. Whichever ran first made the
 * other late.
 *
 * There is deliberately almost nothing in this file. It owns no drawing and no
 * simulation - all of that is background-render.js, unchanged and unaware of where it is
 * running. This is only the seam between a message and a method call, and it is kept
 * trivial so that the worker and main-thread paths cannot behave differently.
 *
 * @requires background-render.js (same directory)
 */

'use strict';

importScripts('background-render.js');

let field = null;

self.addEventListener('message', (event) => {
    const message = event.data;
    if (!message) return;

    switch (message.type) {
        case 'init':
            // The canvas arrives transferred, not copied: from here on this thread is the
            // only one that can draw to it.
            field = createBackgroundField(message.canvas);
            field.setReducedMotion(message.reduceMotion);

            /*
             * Every step is reported back, because once the canvas is transferred the host
             * is blind.
             *
             * A worker that starts, answers ready, accepts init and then fails to paint
             * looks identical from the page to one that is working perfectly: the console
             * says the background initialised, the canvas is the right size, and the
             * screen is black. There is no way to tell those apart from outside, which is
             * exactly the position this got into.
             *
             * So the worker says what it actually managed to do. A missing 'painted' is a
             * loud, specific signal instead of silence.
             */
            try {
                field.resize(message.sizing);
                self.postMessage({ type: 'sized', sizing: message.sizing });
            } catch (error) {
                self.postMessage({ type: 'failed', at: 'resize', error: String(error) });
                throw error;
            }

            field.start();
            self.postMessage({ type: 'started' });
            break;

        case 'resize':
            field?.resize(message.sizing);
            break;

        case 'motion':
            field?.setReducedMotion(message.reduceMotion);
            break;

        default:
            break;
    }
});

/*
 * Announced before anything is transferred.
 *
 * The host waits for this. transferControlToOffscreen is a one-way door - once the canvas
 * has been handed over, the main thread can never get a 2D context back from it - so if
 * this script had failed to load AFTER a transfer, there would be no way back to the
 * main-thread renderer and the background would simply be gone. Transferring only once
 * the worker has proven it is alive keeps the fallback genuinely available.
 */
self.postMessage({ type: 'ready' });
