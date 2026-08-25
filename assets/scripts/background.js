/*
 * Shimti Multimedia - background host
 *
 * Owns everything about the background that is tied to the page, and none of the drawing.
 *
 * WHY THE SPLIT
 *
 * The particle field used to run its whole simulation and every canvas call on the main
 * thread, 45 times a second, alongside pointer handling, wire routing and layout. Those
 * are the same milliseconds: whichever ran first made the other late, and dragging a node
 * while the field was busy is exactly when the page felt heavy.
 *
 * The drawing now happens on a worker thread against an OffscreenCanvas. The main thread
 * keeps only what genuinely belongs to the page - measuring the viewport, the lattice, the
 * reduced-motion setting, visibility - and posts those across. A busy main thread can no
 * longer stall the animation, and a busy animation can no longer stall a drag.
 *
 * WHAT STAYS HERE, AND WHY
 *
 *   - The LATTICE. node-panels.js snaps panels and wires to the same grid the pulses run
 *     on, and it reads window.ShimtiGrid synchronously. Computing it in the worker would
 *     make it arrive by message, after the panels had already placed themselves. It is
 *     shared geometry, not a rendering detail, so it is derived once, here, and sent to
 *     the renderer rather than the other way round.
 *   - SIZING. Only the main thread can see window.innerWidth or set the element's CSS size.
 *   - prefers-reduced-motion, visibility, resize. A worker cannot observe any of them.
 *
 * FALLBACK
 *
 * OffscreenCanvas driven from a worker is Baseline Widely available, but this still falls
 * back to running the identical renderer on the main thread when it is missing - and the
 * fallback is the SAME FILE, so it cannot drift into a second implementation.
 *
 * @requires window.ShimtiUtils.Logger
 * @requires assets/scripts/background-render.js, background-worker.js
 * @requires DOM element: canvas#backgroundCanvas
 * @provides window.ShimtiGrid - the lattice, read by node-panels.js
 */

'use strict';

(function () {
    const GRID_SPACING = 80;
    const RENDERER_SRC = 'assets/scripts/background-render.js';
    const WORKER_SRC = 'assets/scripts/background-worker.js';

    // How long the worker gets to say hello before the main thread is used instead. The
    // canvas has not been transferred at this point, so falling back is still free.
    const WORKER_READY_TIMEOUT = 4000;

    const bgLogger = new window.ShimtiUtils.Logger('Background');

    function initBackground() {
        const canvas = document.getElementById('backgroundCanvas');
        if (!canvas) {
            bgLogger.error('Failed to initialise background', new Error('backgroundCanvas not found'));
            return;
        }

        const reduceMotionQuery = window.matchMedia
            && window.matchMedia('(prefers-reduced-motion: reduce)');
        const reduceMotion = () => !!(reduceMotionQuery && reduceMotionQuery.matches);

        // Set while a size is being waited for. See measure().
        let pendingMeasure = 0;

        /**
         * Measures the viewport, publishes the lattice, and sizes the element.
         *
         * @returns {?{width:number, height:number, dpr:number, spacing:number,
         *             originX:number, originY:number}} null while the viewport has no area
         */
        function measure() {
            const width = window.innerWidth;
            const height = window.innerHeight;

            /*
             * A viewport with no area is a real state, not an impossible one.
             *
             * A page opened into a background tab - ctrl-clicked, restored with the
             * session, or one of a folder of bookmarks opened at once - can run its
             * scripts before it is ever given a size. So this retries itself until the
             * viewport has an area, rather than waiting to be told: no resize EVENT fires,
             * because the window was never resized, and a ResizeObserver on the document
             * element reports nothing, because that element's box was never the thing at
             * zero. The only reliable fact is that a size arrives eventually.
             *
             * Timers are heavily throttled in a background tab, so the retries are slow
             * there - which is right, because nobody is looking at it.
             */
            if (width < 1 || height < 1) {
                if (!pendingMeasure) {
                    pendingMeasure = setTimeout(() => { pendingMeasure = 0; push(); }, 250);
                }
                return null;
            }

            if (pendingMeasure) {
                clearTimeout(pendingMeasure);
                pendingMeasure = 0;
            }

            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const spacing = GRID_SPACING;
            const cx = width / 2;
            const cy = height / 2;

            // Laid out from the centre so the hole lands on a junction and the field reads
            // as centred rather than arbitrarily cropped.
            const originX = cx - Math.ceil(cx / spacing) * spacing;
            const originY = cy - Math.ceil(cy / spacing) * spacing;

            /*
             * Published so the node panels snap to the same lattice the pulses run on.
             *
             * Defined here and nowhere else. Having node-panels.js recompute the origin
             * from its own copy of the spacing would be two derivations of one fact, and
             * they would drift the moment either changed.
             */
            window.ShimtiGrid = { spacing, originX, originY };

            // The element's CSS size. In worker mode its backing store belongs to the
            // worker and cannot be touched from here; this is the part that never moves.
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;

            return { width, height, dpr, spacing, originX, originY };
        }

        // Whichever renderer won: a worker to post to, or a field object to call.
        let post = null;
        let field = null;
        let lastSizing = null;

        /*
         * Measured NOW, before either renderer is chosen.
         *
         * window.ShimtiGrid has to exist by the time node-panels.js lays out, and that
         * happens on the same DOMContentLoaded as this. Publishing it from the worker's
         * ready handler instead would make it arrive a message later - after the panels
         * had already placed themselves off the lattice, with nothing to tell them to try
         * again. The lattice is not a rendering result; it is shared page geometry, and it
         * is available the moment the viewport is.
         */
        lastSizing = measure();

        function push() {
            const sizing = measure();
            if (!sizing) return;
            // Kept so that a renderer starting later - the worker only reports ready after
            // a round trip - begins from the current size rather than re-measuring.
            lastSizing = sizing;
            if (post) post({ type: 'resize', sizing });
            else if (field) field.resize(sizing);
        }

        /* ------------------------------------------------------------- main thread */

        function startOnMainThread(reason) {
            bgLogger.warn('Background running on the main thread', { reason });

            const begin = () => {
                if (typeof createBackgroundField !== 'function') {
                    bgLogger.error('Failed to initialise background',
                        new Error('background-render.js did not define createBackgroundField'));
                    return;
                }
                field = createBackgroundField(canvas);
                field.setReducedMotion(reduceMotion());
                field.start();
                push();
                bgLogger.log('Background initialised', { thread: 'main' });
            };

            // Loaded on demand rather than with the page: in the common case the worker
            // fetches this file itself and the main thread never needs to parse it.
            const script = document.createElement('script');
            script.src = RENDERER_SRC;
            script.onload = begin;
            script.onerror = () => bgLogger.error('Failed to initialise background',
                new Error('could not load ' + RENDERER_SRC));
            document.head.appendChild(script);
        }

        /* ------------------------------------------------------------------ worker */

        function startInWorker() {
            let worker;
            try {
                worker = new Worker(WORKER_SRC);
            } catch (error) {
                startOnMainThread('worker could not be constructed: ' + error.message);
                return;
            }

            let settled = false;

            const giveUp = (reason) => {
                if (settled) return;
                settled = true;
                worker.terminate();
                startOnMainThread(reason);
            };

            const timer = setTimeout(() => giveUp('worker did not report ready'), WORKER_READY_TIMEOUT);

            worker.onerror = (event) => giveUp('worker error: ' + (event.message || 'unknown'));

            worker.onmessage = (event) => {
                if (!event.data || event.data.type !== 'ready' || settled) return;
                settled = true;
                clearTimeout(timer);

                /*
                 * Errors after this point can no longer be answered by falling back: the
                 * canvas is about to become the worker's and cannot be handed back.
                 *
                 * Reported once, not once per occurrence. A renderer fault tends to
                 * repeat every frame, and logging each one turns a broken background into
                 * a machine that gets slower the longer the page stays open - the console
                 * retains every entry. One report says everything the hundredth would.
                 */
                let reported = false;
                worker.onerror = (e) => {
                    if (reported) return;
                    reported = true;
                    bgLogger.error('Background worker failed after transfer',
                        new Error(e.message || 'unknown'));
                };

                const sizing = lastSizing || measure();
                const offscreen = canvas.transferControlToOffscreen();
                post = (message) => worker.postMessage(message);

                worker.postMessage({
                    type: 'init',
                    canvas: offscreen,
                    // A viewport with no area yet still gets a valid first size; measure()
                    // has already scheduled itself to send the real one once it exists.
                    sizing: sizing || {
                        width: 1, height: 1, dpr: 1, spacing: GRID_SPACING, originX: 0, originY: 0,
                    },
                    reduceMotion: reduceMotion(),
                }, [offscreen]);

                bgLogger.log('Background initialised', { thread: 'worker' });
            };
        }

        /* ------------------------------------------------------------------ wiring */

        let resizeTimer = null;
        const rebuildSoon = () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(push, 150);
        };

        window.addEventListener('resize', rebuildSoon);

        /*
         * Becoming visible is a rebuild too. A tab restored or opened in the background
         * can be laid out at a different size than it was built for, and this is also the
         * point at which throttled timers start running again.
         */
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) rebuildSoon();
        });

        if (reduceMotionQuery && reduceMotionQuery.addEventListener) {
            reduceMotionQuery.addEventListener('change', () => {
                const value = reduceMotion();
                if (post) post({ type: 'motion', reduceMotion: value });
                else if (field) field.setReducedMotion(value);
            });
        }

        const canOffscreen = typeof canvas.transferControlToOffscreen === 'function'
            && typeof window.Worker === 'function';

        if (canOffscreen) startInWorker();
        else startOnMainThread('OffscreenCanvas or Worker unavailable');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initBackground);
    } else {
        initBackground();
    }
}());
